import { FastifyInstance } from "fastify";
import { z } from "zod";
import jwt from "jsonwebtoken";

import { JWT_SECRET } from '../config/env.js';
import { requireAuth } from '../config/auth.js';
import { STELLAR_CONFIG } from '../config/stellar.js';
import { getConfirmedCall, prepareInvocation, readContract, toAddressVal, toI128Val, toShareUnits } from '../services/soroban.js';
import { isContractAddress, isPublicKey, toStellarAmount, verifyPayment } from '../services/stellarVerify.js';
import { markExecutionConfirmed } from '../policy/execution.js';
import {
  bindMandateWallet,
  buildWalletRefund,
  completeWalletOrder,
  logOrderEvent,
  verifySubscription,
  verifyWalletRefund,
} from '../services/mandateWallet.js';
import { refreshInvestorBadge } from '../services/zkBadge.js';

// An unpaid order reserves its quotas for this long; after that they are available to other investors again.
// A late payment can still be completed (the manager then approves or refunds it), so no investor loses funds.
export const PENDING_ORDER_TTL_MS = 30 * 60 * 1000;

/** Orders that count against a fund's available quotas: paid and not refunded, or recently created and unpaid */
export const reservingOrdersWhere = () => ({
  OR: [
    { status: "COMPLETED", approvalStatus: { not: "REJECTED" } },
    { status: "PENDING", createdAt: { gte: new Date(Date.now() - PENDING_ORDER_TTL_MS) } },
  ],
});

/** Memo the fund wallet must put on an order's refund payment */
const refundMemo = (orderId: string) => `Refund ${orderId.substring(0, 20)}`;

const createOrderSchema = z.object({
  fundId: z.string(),
  quantity: z.number().positive(),
  amount: z.number().positive().optional(), // Optional amount, will calculate from fund price
  publicKey: z.string().refine(isPublicKey, "Invalid Stellar public key").optional(), // Investor's wallet public key
});

function verifyToken(token: string) {
  try {
    return jwt.verify(token, JWT_SECRET) as any;
  } catch {
    throw new Error("Invalid token");
  }
}

export async function orderRoutes(fastify: FastifyInstance) {
  // Orders paid by a mandate wallet (C...) are created only by executeSubscription (services/mandateWallet.ts),
  // never by POST /orders; they carry payerAddress (the wallet) and decisionHash (the approved log row).
  bindMandateWallet(fastify.prisma);
  const isWalletOrder = (o: { payerAddress: string | null }) => !!o.payerAddress && isContractAddress(o.payerAddress);
  // Create buy order with payment transaction (Investidor only)
  fastify.post("/", async (request, reply) => {
    try {
      const token = request.headers.authorization?.replace("Bearer ", "");
      if (!token) {
        return reply.status(401).send({ error: "No token provided" });
      }

      const payload = verifyToken(token);
      if (payload.role !== "INVESTIDOR") {
        return reply
          .status(403)
          .send({ error: "Only investors can create orders" });
      }

      const body = createOrderSchema.parse(request.body);

      // Check fund availability
      const fund = await fastify.prisma.fund.findUnique({
        where: { id: body.fundId },
        include: {
          orders: {
            where: reservingOrdersWhere(),
            select: { quantity: true },
          },
        },
      });

      if (!fund) {
        return reply.status(404).send({ error: "Fund not found" });
      }

      if (fund.status !== "APPROVED") {
        return reply.status(400).send({
          error: "Fund not available for investment",
          details: { fundStatus: fund.status },
        });
      }

      const totalSold = fund.orders.reduce(
        (sum: number, order: any) => sum + order.quantity,
        0
      );
      const availableQuotas = fund.totalIssued - totalSold;

      if (body.quantity > availableQuotas) {
        return reply.status(400).send({
          error: "Not enough quotas available",
          details: {
            requested: body.quantity,
            available: availableQuotas,
            totalIssued: fund.totalIssued,
            totalSold: totalSold,
          },
        });
      }

      const price = fund.price;
      // Shares and Stellar amounts both support at most 7 decimals
      const quantity = Number(toStellarAmount(body.quantity));
      const total = Number(toStellarAmount(quantity * price));

      if (!fund.fundWalletPublicKey) {
        return reply.status(400).send({
          error:
            "Fund wallet not configured. Please contact the administrator.",
        });
      }
      if (!fund.tokenContractId) {
        return reply.status(400).send({ error: "Fund share token not deployed yet" });
      }

      // Save investor's publicKey if provided
      if (body.publicKey) {
        await fastify.prisma.user.update({
          where: { id: payload.id },
          data: { publicKey: body.publicKey },
        });
      }

      // Create order in PENDING status
      const order = await fastify.prisma.order.create({
        data: {
          fundId: body.fundId,
          quantity,
          price: price,
          total,
          investorId: payload.id,
          status: "PENDING",
        },
        include: {
          fund: {
            select: {
              name: true,
              symbol: true,
              fundWalletPublicKey: true,
              tokenContractId: true,
              consultor: {
                select: { publicKey: true },
              },
            },
          },
          investor: {
            select: { email: true, publicKey: true },
          },
        },
      });

      return {
        order,
        payment: {
          destination: fund.fundWalletPublicKey,
          amount: toStellarAmount(total),
          asset: STELLAR_CONFIG.PAYMENT_ASSET,
          memo: order.id.substring(0, 28), // Stellar memo limit is 28 bytes
          // Shares are minted by this Soroban contract after approval (no trustline needed)
          shareTokenContractId: fund.tokenContractId,
        },
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply
          .status(400)
          .send({ error: "Invalid input", details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: "Internal server error" });
    }
  });

  // Investor's share balances read from each fund's FundToken contract (the on-chain source of truth)
  fastify.get("/holdings", async (request, reply) => {
    try {
      const user = requireAuth(request, reply, ["INVESTIDOR"]);
      if (!user) return reply;

      const investor = await fastify.prisma.user.findUnique({ where: { id: user.id }, select: { publicKey: true } });
      const approved = await fastify.prisma.order.findMany({
        where: { investorId: user.id, approvalStatus: "APPROVED", fund: { tokenContractId: { not: null } } },
        select: { shareHolder: true, fund: { select: { id: true, name: true, symbol: true, tokenContractId: true } } },
      });

      // Shares live in the wallet(s) they were minted to, plus the currently connected one
      const byFund = new Map<string, { fund: (typeof approved)[number]["fund"]; wallets: Set<string> }>();
      for (const o of approved) {
        const entry = byFund.get(o.fund.id) ?? { fund: o.fund, wallets: new Set<string>() };
        if (o.shareHolder) entry.wallets.add(o.shareHolder);
        if (investor?.publicKey) entry.wallets.add(investor.publicKey);
        byFund.set(o.fund.id, entry);
      }

      const holdings = await Promise.all(
        [...byFund.values()].map(async ({ fund, wallets }) => {
          try {
            const balances = await Promise.all(
              [...wallets].map((w) => readContract<bigint>(fund.tokenContractId!, "balance", [toAddressVal(w)]))
            );
            const units = balances.reduce((sum, b) => sum + BigInt(b), 0n);
            return { ...fund, shares: Number(units) / 1e7, wallets: [...wallets] };
          } catch {
            return { ...fund, shares: null, wallets: [...wallets] };
          }
        })
      );
      return { holdings };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Internal server error" });
    }
  });

  // List orders
  fastify.get("/", async (request, reply) => {
    try {
      const token = request.headers.authorization?.replace("Bearer ", "");
      if (!token) {
        return reply.status(401).send({ error: "No token provided" });
      }

      const payload = verifyToken(token);

      // Investors see only their orders, Gestors see all
      const where =
        payload.role === "INVESTIDOR" ? { investorId: payload.id } : {};

      // Otimizado: select apenas os campos necessários
      const orders = await fastify.prisma.order.findMany({
        where,
        select: {
          id: true,
          quantity: true,
          price: true,
          total: true,
          status: true,
          approvalStatus: true,
          txHash: true,
          tokenMintTxHash: true,
          refundTxHash: true,
          payerAddress: true,
          decisionHash: true,
          createdAt: true,
          updatedAt: true,
          fund: {
            select: {
              id: true,
              name: true,
              symbol: true,
              price: true,
            },
          },
          investor: {
            select: {
              id: true,
              email: true,
              publicKey: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 100, // Limita a 100 orders mais recentes
      });

      return { orders };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Internal server error" });
    }
  });

  // Complete order: the investor reports the payment tx, which is verified on-chain before completing
  fastify.patch("/:id/complete", async (request, reply) => {
    try {
      const user = requireAuth(request, reply, ["INVESTIDOR"]);
      if (!user) return reply;

      const { id } = request.params as { id: string };
      const { txHash } = z.object({ txHash: z.string() }).parse(request.body);

      const existingOrder = await fastify.prisma.order.findUnique({
        where: { id },
        include: {
          fund: { select: { fundWalletPublicKey: true } },
          investor: { select: { publicKey: true } },
        },
      });

      if (!existingOrder) {
        return reply.status(404).send({ error: "Order not found" });
      }
      if (existingOrder.investorId !== user.id) {
        return reply.status(403).send({ error: "You can only complete your own orders" });
      }
      if (existingOrder.status !== "PENDING") {
        return reply.status(400).send({ error: "Only pending orders can be completed" });
      }

      // Mandate wallet order: the payment is subscribe on the wallet contract, decoded from the confirmed transaction
      if (isWalletOrder(existingOrder)) {
        const check = await verifySubscription(existingOrder, txHash);
        if (!check.ok) {
          return reply.status(400).send({ error: "Payment verification failed", reason: check.reason });
        }
        const done = await completeWalletOrder(id, txHash);
        if (!done.completed) {
          return reply.status(409).send({ error: "Order was already processed" });
        }
        // An execution left PENDING_NETWORK (RPC unavailable) is closed now that the purchase verified on-chain.
        // invalid_status is the normal case: most executions were confirmed directly and never passed through it.
        const logRow = await fastify.prisma.decisionLog.findUnique({ where: { hash: existingOrder.decisionHash! }, select: { seq: true } });
        if (logRow) {
          const mark = await markExecutionConfirmed(logRow.seq, txHash, fastify.prisma);
          if (!mark.ok && mark.reason !== "invalid_status") {
            fastify.log.warn({ seq: logRow.seq, reason: mark.reason }, "decision execution not marked confirmed");
          }
        }
        const order = await fastify.prisma.order.findUniqueOrThrow({
          where: { id },
          include: { fund: { select: { name: true, symbol: true, id: true } } },
        });
        return { order };
      }

      if (!existingOrder.investor.publicKey || !existingOrder.fund.fundWalletPublicKey) {
        return reply.status(400).send({ error: "Investor or fund wallet not configured" });
      }

      const reused = await fastify.prisma.order.findFirst({
        where: { OR: [{ txHash }, { refundTxHash: txHash }, { tokenMintTxHash: txHash }] },
      });
      if (reused) {
        return reply.status(409).send({ error: "Transaction already used by another order" });
      }

      const payment = await verifyPayment({
        hash: txHash,
        from: existingOrder.investor.publicKey,
        to: existingOrder.fund.fundWalletPublicKey,
        amount: existingOrder.total,
        memo: id.substring(0, 28),
        asset: STELLAR_CONFIG.PAYMENT_ASSET,
      });
      if (!payment.ok) {
        return reply.status(400).send({ error: "Payment verification failed", reason: payment.reason });
      }

      // Atomic transition: protects against two concurrent completions of the same order
      const transitioned = await fastify.prisma.order.updateMany({
        where: { id, status: "PENDING" },
        data: { status: "COMPLETED", txHash },
      });
      if (transitioned.count === 0) {
        return reply.status(409).send({ error: "Order was already processed" });
      }

      const order = await fastify.prisma.order.findUniqueOrThrow({
        where: { id },
        include: {
          fund: {
            select: {
              name: true,
              symbol: true,
              id: true,
            },
          },
          investor: {
            select: { email: true, publicKey: true },
          },
        },
      });

      // The USDC now sits in the fund wallet; the manager supplies it to the Blend pool explicitly
      // (POST /pools/build-deposit + /pools/deposit), so pool balances always mirror the chain.

      // The investor's badge counts approved orders only, so it is refreshed when the manager approves or rejects

      return { order };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply
          .status(400)
          .send({ error: "Invalid input", details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: "Internal server error" });
    }
  });

  // Cancel order
  fastify.patch("/:id/cancel", async (request, reply) => {
    try {
      const token = request.headers.authorization?.replace("Bearer ", "");
      if (!token) {
        return reply.status(401).send({ error: "No token provided" });
      }

      const payload = verifyToken(token);
      const { id } = request.params as { id: string };

      // Find order
      const existingOrder = await fastify.prisma.order.findUnique({
        where: { id },
      });

      if (!existingOrder) {
        return reply.status(404).send({ error: "Order not found" });
      }

      // Only the investor who placed the order, or a manager, can cancel it
      const isOwner = payload.role === "INVESTIDOR" && existingOrder.investorId === payload.id;
      if (!isOwner && payload.role !== "GESTOR") {
        return reply
          .status(403)
          .send({ error: "You can only cancel your own orders" });
      }

      if (existingOrder.status !== "PENDING") {
        return reply
          .status(400)
          .send({ error: "Only pending orders can be canceled" });
      }

      // Atomic: a concurrent completion (verified payment) wins over the cancellation
      const canceled = await fastify.prisma.order.updateMany({
        where: { id, status: "PENDING" },
        data: { status: "FAILED" },
      });
      if (canceled.count === 0) {
        return reply.status(409).send({ error: "Order was already processed" });
      }

      const order = await fastify.prisma.order.findUniqueOrThrow({
        where: { id },
        include: {
          fund: {
            select: { name: true, symbol: true },
          },
          investor: {
            select: { email: true, publicKey: true },
          },
        },
      });

      return { order };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Internal server error" });
    }
  });

  // Approve or reject order (Gestor only) - with automatic refund on rejection
  fastify.patch("/:id/approve", async (request, reply) => {
    try {
      const token = request.headers.authorization?.replace("Bearer ", "");
      if (!token) {
        return reply.status(401).send({ error: "No token provided" });
      }

      const payload = verifyToken(token);
      if (payload.role !== "GESTOR") {
        return reply
          .status(403)
          .send({ error: "Only gestors can approve orders" });
      }

      const { id } = request.params as { id: string };
      const { action, refundTxHash, tokenMintTxHash, whitelistTxHash } = z
        .object({
          action: z.enum(["approve", "reject"]),
          refundTxHash: z.string().optional(),
          tokenMintTxHash: z.string().optional(),
          // Optional: the whitelist_add hash, verified and logged for mandate wallet orders (the UI may omit it)
          whitelistTxHash: z.string().optional(),
        })
        .parse(request.body);

      // Get order with fund and investor details
      const existingOrder = await fastify.prisma.order.findUnique({
        where: { id },
        include: {
          fund: {
            select: {
              name: true,
              symbol: true,
              fundWalletPublicKey: true,
              tokenContractId: true,
              consultor: {
                select: { publicKey: true },
              },
            },
          },
          investor: {
            select: { email: true, publicKey: true },
          },
        },
      });

      if (!existingOrder) {
        return reply.status(404).send({ error: "Order not found" });
      }

      if (existingOrder.status !== "COMPLETED") {
        return reply.status(400).send({
          error: "Order must be completed before approval",
          details: { currentStatus: existingOrder.status },
        });
      }

      if (existingOrder.approvalStatus !== "PENDING_APPROVAL") {
        return reply.status(400).send({
          error: "Order already processed",
          details: { currentApprovalStatus: existingOrder.approvalStatus },
        });
      }

      const walletOrder = isWalletOrder(existingOrder);

      if (action === "approve") {
        // Shares go to the paying wallet: the mandate wallet contract (C...) for agent orders, else the investor's G...
        const investorKey = walletOrder ? existingOrder.payerAddress! : existingOrder.investor.publicKey;
        if (!investorKey) {
          return reply.status(400).send({
            error: "Investor wallet not configured. Cannot mint tokens.",
          });
        }

        // Shares are minted by the fund's FundToken contract, whose admin is the fund wallet
        const tokenContractId = existingOrder.fund.tokenContractId;
        const issuer = existingOrder.fund.fundWalletPublicKey;
        if (!tokenContractId || !issuer) {
          return reply.status(400).send({ error: "Fund share token not deployed yet" });
        }
        if (existingOrder.shareHolder && existingOrder.shareHolder !== investorKey) {
          return reply.status(409).send({
            error: "Investor changed wallet during approval",
            reason: `Shares for this order are being minted to ${existingOrder.shareHolder}; reconnect that wallet or reject the order`,
          });
        }
        const units = toShareUnits(existingOrder.quantity);

        // A late payment (after the reservation expired) can still complete: never mint beyond the issued quotas
        if (!tokenMintTxHash) {
          const [fundQuota, minted] = await Promise.all([
            fastify.prisma.fund.findUniqueOrThrow({ where: { id: existingOrder.fundId }, select: { totalIssued: true } }),
            fastify.prisma.order.aggregate({
              where: { fundId: existingOrder.fundId, approvalStatus: "APPROVED" },
              _sum: { quantity: true },
            }),
          ]);
          const available = fundQuota.totalIssued - (minted._sum.quantity ?? 0);
          if (existingOrder.quantity > available + 1e-7) {
            return reply.status(409).send({
              error: "Not enough issued quotas to approve this order",
              reason: `Order needs ${existingOrder.quantity}, only ${Math.max(0, available)} left. Issue more quotas or reject and refund it.`,
            });
          }
        }

        // A reported whitelist_add for a mandate wallet order is verified and logged (no hash without a log row)
        if (whitelistTxHash && walletOrder && !tokenMintTxHash) {
          let wl;
          try {
            wl = await getConfirmedCall(whitelistTxHash);
          } catch (e) {
            return reply.status(400).send({ error: "Whitelist verification failed", reason: (e as Error).message });
          }
          const wlOk =
            wl.kind === "invoke" &&
            wl.source === issuer &&
            wl.contractId === tokenContractId &&
            wl.method === "whitelist_add" &&
            wl.args?.[0] === investorKey;
          if (!wlOk) {
            return reply.status(400).send({ error: "Whitelist verification failed", reason: "Transaction is not whitelist_add(wallet) on the fund token by the fund wallet" });
          }
          const already = await fastify.prisma.decisionLog.findFirst({
            where: { payload: { contains: `"txHash":"${whitelistTxHash.toLowerCase()}"` } },
            select: { seq: true },
          });
          if (!already) await logOrderEvent(existingOrder, "whitelist_add", whitelistTxHash);
        }

        // Step 1 (repeated until the mint): returns the next transaction for the fund wallet to sign:
        // whitelist_add (KYC) when the investor is not whitelisted yet, then mint
        if (!tokenMintTxHash) {
          // A frozen fund token (set_pause by the issuer) refuses mints: say so instead of failing the simulation
          if (await readContract<boolean>(tokenContractId, "is_paused").catch(() => false)) {
            return reply.status(409).send({ error: "The fund token is paused by the issuer", reason: "Unpause it (set_pause false) before minting" });
          }
          // Record where the shares go before anything is signed, so distributions always include this wallet
          await fastify.prisma.order.update({ where: { id }, data: { shareHolder: investorKey } });
          const whitelisted = await readContract<boolean>(tokenContractId, "is_whitelisted", [toAddressVal(investorKey)]);
          const step = whitelisted ? "mint" : "whitelist";
          const transactionXdr = whitelisted
            ? await prepareInvocation(issuer, tokenContractId, "mint", [toAddressVal(investorKey), toI128Val(units)])
            : await prepareInvocation(issuer, tokenContractId, "whitelist_add", [toAddressVal(investorKey)]);
          return {
            requiresTransaction: true,
            step,
            signer: issuer,
            transactionXdr,
            mintDetails: {
              contractId: tokenContractId,
              destination: investorKey,
              amount: toStellarAmount(existingOrder.quantity),
              fundSymbol: existingOrder.fund.symbol,
              fundName: existingOrder.fund.name,
            },
          };
        }

        // Step 2: the mint must be exactly mint(investor, quantity) on this fund's token, sent by the fund wallet
        const reusedMint = await fastify.prisma.order.findFirst({ where: { tokenMintTxHash } });
        if (reusedMint) {
          return reply.status(409).send({ error: "Mint transaction already used by another order" });
        }
        let call;
        try {
          call = await getConfirmedCall(tokenMintTxHash);
        } catch (e) {
          return reply.status(400).send({ error: "Token mint verification failed", reason: (e as Error).message });
        }
        const mintOk =
          call.kind === "invoke" &&
          call.source === issuer &&
          call.contractId === tokenContractId &&
          call.method === "mint" &&
          call.args?.[0] === investorKey &&
          String(call.args?.[1]) === units.toString();
        if (!mintOk) {
          return reply.status(400).send({
            error: "Token mint verification failed",
            reason: "Transaction is not mint(investor, quantity) on the fund token by the fund wallet",
          });
        }

        const approvedNow = await fastify.prisma.order.updateMany({
          where: { id, approvalStatus: "PENDING_APPROVAL" },
          data: { approvalStatus: "APPROVED", tokenMintTxHash, shareHolder: investorKey },
        });
        if (approvedNow.count === 0) {
          return reply.status(409).send({ error: "Order already processed" });
        }
        if (walletOrder) await logOrderEvent(existingOrder, "mint", tokenMintTxHash, units);
        await refreshInvestorBadge(fastify.prisma, existingOrder.investorId);

        const order = await fastify.prisma.order.findUniqueOrThrow({
          where: { id },
          include: {
            fund: {
              select: { name: true, symbol: true },
            },
            investor: {
              select: { email: true, publicKey: true },
            },
          },
        });

        return {
          order,
          message: "Order approved and tokens minted successfully",
        };
      } else {
        // Mandate wallet order: refund is a USDC transfer to the wallet contract through the SAC (no memo exists
        // for a contract destination); verified by decoding the confirmed call, not by Horizon
        if (walletOrder) {
          const fundWallet = existingOrder.fund.fundWalletPublicKey;
          if (!fundWallet) {
            return reply.status(400).send({ error: "Fund wallet not configured" });
          }
          if (!refundTxHash) {
            let built;
            try {
              built = await buildWalletRefund(existingOrder, fundWallet);
            } catch (e) {
              return reply.status(400).send({ error: "Could not build the refund", reason: (e as Error).message });
            }
            return {
              requiresRefund: true,
              refundDetails: {
                method: "sac_transfer",
                destination: existingOrder.payerAddress,
                amount: toStellarAmount(existingOrder.total),
                asset: STELLAR_CONFIG.PAYMENT_ASSET,
                source: fundWallet,
                transactionXdr: built.transactionXdr,
                decoded: built.decoded,
              },
            };
          }
          const reusedWalletRefund = await fastify.prisma.order.findFirst({
            where: { OR: [{ refundTxHash }, { txHash: refundTxHash }, { tokenMintTxHash: refundTxHash }] },
            select: { id: true },
          });
          if (reusedWalletRefund) {
            return reply.status(409).send({ error: "Transaction already used by another order" });
          }
          const check = await verifyWalletRefund(existingOrder, fundWallet, refundTxHash);
          if (!check.ok) {
            return reply.status(400).send({ error: "Refund verification failed", reason: check.reason });
          }
          const rejected = await fastify.prisma.order.updateMany({
            where: { id, approvalStatus: "PENDING_APPROVAL" },
            data: { approvalStatus: "REJECTED", refundTxHash },
          });
          if (rejected.count === 0) {
            return reply.status(409).send({ error: "Order already processed" });
          }
          await logOrderEvent(existingOrder, "refund", refundTxHash, toShareUnits(existingOrder.total));
          await refreshInvestorBadge(fastify.prisma, existingOrder.investorId);
          const order = await fastify.prisma.order.findUniqueOrThrow({
            where: { id },
            include: { fund: { select: { name: true, symbol: true } }, investor: { select: { email: true, publicKey: true } } },
          });
          return { order, message: "Order rejected and refunded successfully" };
        }

        // Reject - requires refund transaction hash
        if (!refundTxHash) {
          // Return refund details for frontend to build the transaction
          return {
            requiresRefund: true,
            refundDetails: {
              destination: existingOrder.investor.publicKey,
              amount: toStellarAmount(existingOrder.total),
              asset: STELLAR_CONFIG.PAYMENT_ASSET,
              memo: refundMemo(id),
              // The refund must come from the fund wallet, which received the payment
              source: existingOrder.fund.fundWalletPublicKey,
            },
          };
        }

        if (!existingOrder.investor.publicKey) {
          return reply.status(400).send({ error: "Investor wallet not configured" });
        }
        if (!existingOrder.fund.fundWalletPublicKey) {
          return reply.status(400).send({ error: "Fund wallet not configured" });
        }
        // A transaction hash proves one payment only
        const reusedRefund = await fastify.prisma.order.findFirst({
          where: { OR: [{ refundTxHash }, { txHash: refundTxHash }, { tokenMintTxHash: refundTxHash }] },
          select: { id: true },
        });
        if (reusedRefund) {
          return reply.status(409).send({ error: "Transaction already used by another order" });
        }
        // The refund must send the order total in USDC from the fund wallet to the investor, tagged with this order
        const refundCheck = await verifyPayment({
          hash: refundTxHash,
          from: existingOrder.fund.fundWalletPublicKey,
          to: existingOrder.investor.publicKey,
          amount: existingOrder.total,
          memo: refundMemo(id),
          asset: STELLAR_CONFIG.PAYMENT_ASSET,
        });
        if (!refundCheck.ok) {
          return reply.status(400).send({ error: "Refund verification failed", reason: refundCheck.reason });
        }

        const rejectedNow = await fastify.prisma.order.updateMany({
          where: { id, approvalStatus: "PENDING_APPROVAL" },
          data: { approvalStatus: "REJECTED", refundTxHash },
        });
        if (rejectedNow.count === 0) {
          return reply.status(409).send({ error: "Order already processed" });
        }
        await refreshInvestorBadge(fastify.prisma, existingOrder.investorId);

        const order = await fastify.prisma.order.findUniqueOrThrow({
          where: { id },
          include: {
            fund: {
              select: { name: true, symbol: true },
            },
            investor: {
              select: { email: true, publicKey: true },
            },
          },
        });

        return { order, message: "Order rejected and refunded successfully" };
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply
          .status(400)
          .send({ error: "Invalid input", details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: "Internal server error" });
    }
  });
}
