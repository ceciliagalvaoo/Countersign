import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import jwt from 'jsonwebtoken';

import { JWT_SECRET } from '../config/env.js';
import { requireAuth } from '../config/auth.js';
import { STELLAR_CONFIG } from '../config/stellar.js';
import {
  getConfirmedCall,
  prepareInvocation,
  readContract,
  toAddressVal,
  toI128Val,
  toShareUnits,
  toStringVal,
  toSymbolVal,
  NETWORK_PASSPHRASE,
} from '../services/soroban.js';
import * as StellarSdk from '@stellar/stellar-sdk';
import { appendOnchainEvent, bindDecisionLog, ONCHAIN_ACTIONS, type OnchainAction } from '../policy/decisionLog.js';
import crypto from 'crypto';
import { describeReceivableStep } from '../services/receivableSteps.js';
import {
  getOrCreatePending,
  loadSignerSet,
  MULTISIG_TX_TIMEOUT_SECONDS,
  needsMultipleSignatures,
  signedWeight,
} from '../services/multisig.js';

const createReceivableSchema = z.object({
  fundId: z.string(),
  sacadoId: z.string(),
  cedenteId: z.string(),
  faceValue: z.number().positive(),
  dueDate: z.string().datetime()
});

const markPaidSchema = z.object({
  paidValue: z.number().positive()
});

function verifyToken(token: string) {
  try {
    return jwt.verify(token, JWT_SECRET) as any;
  } catch {
    throw new Error('Invalid token');
  }
}

export async function receivableRoutes(fastify: FastifyInstance, overrides: Partial<{
  readContract: typeof readContract; prepareInvocation: typeof prepareInvocation;
  getConfirmedCall: typeof getConfirmedCall; loadSignerSet: typeof loadSignerSet;
  getOrCreatePending: typeof getOrCreatePending; appendOnchainEvent: typeof appendOnchainEvent;
}> = {}) {
  const chain = { readContract, prepareInvocation, getConfirmedCall, loadSignerSet, getOrCreatePending, appendOnchainEvent, ...overrides };
  bindDecisionLog(fastify.prisma);
  // Create receivable (Gestor only)
  fastify.post('/', async (request, reply) => {
    try {
      const token = request.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return reply.status(401).send({ error: 'No token provided' });
      }

      const payload = verifyToken(token);
      if (payload.role !== 'GESTOR') {
        return reply.status(403).send({ error: 'Only gestors can create receivables' });
      }

      const body = createReceivableSchema.parse(request.body);

      // Cedente and sacado must be approved and belong to the receivable's fund
      const [cedente, sacado] = await Promise.all([
        fastify.prisma.cedente.findUnique({ where: { id: body.cedenteId } }),
        fastify.prisma.sacado.findUnique({ where: { id: body.sacadoId } }),
      ]);
      if (!cedente || !sacado || cedente.fundId !== body.fundId || sacado.fundId !== body.fundId) {
        return reply.status(400).send({ error: 'Cedente and sacado must belong to the fund' });
      }
      if (cedente.status !== 'APPROVED' || sacado.status !== 'APPROVED') {
        return reply.status(400).send({ error: 'Cedente and sacado must be approved' });
      }

      const receivable = await fastify.prisma.receivable.create({
        data: {
          ...body,
          dueDate: new Date(body.dueDate)
        },
        include: {
          fund: {
            select: { name: true, symbol: true }
          },
          sacado: {
            select: { name: true, document: true }
          }
        }
      });

      return { receivable };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // List receivables
  fastify.get('/', async (request, reply) => {
    try {
      const authUser = requireAuth(request, reply, ['GESTOR', 'CONSULTOR']);
      if (!authUser) return reply;

      const receivables = await fastify.prisma.receivable.findMany({
        // Consultants only see the receivables of the funds they structure
        where: authUser.role === 'CONSULTOR' ? { fund: { consultorId: authUser.id } } : {},
        include: {
          fund: {
            select: { name: true, symbol: true }
          },
          sacado: {
            select: { name: true, document: true }
          },
          cedente: {
            select: { name: true, document: true }
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      return { receivables };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Direct, reload-safe detail page. Reading it never prepares or sends a call.
  fastify.get('/:id', async (request, reply) => {
    if (!requireAuth(request, reply, ['GESTOR'])) return reply;
    try {
      const { id } = request.params as { id: string };
      const receivable = await fastify.prisma.receivable.findUnique({ where: { id }, include: {
        fund: { select: { name: true, symbol: true } },
        cedente: { select: { name: true, document: true } },
        sacado: { select: { name: true, document: true } },
      } });
      if (!receivable) return reply.status(404).send({ error: 'Receivable not found' });
      return { receivable };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Unable to load receivable' });
    }
  });

  // Mark receivable as paid (Gestor only)
  fastify.patch('/:id/mark-paid', async (request, reply) => {
    try {
      const token = request.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return reply.status(401).send({ error: 'No token provided' });
      }

      const payload = verifyToken(token);
      if (payload.role !== 'GESTOR') {
        return reply.status(403).send({ error: 'Only gestors can mark as paid' });
      }

      const { id } = request.params as { id: string };
      const body = markPaidSchema.parse(request.body);

      const existing = await fastify.prisma.receivable.findUnique({ where: { id }, select: { status: true, paidValue: true } });
      if (!existing) {
        return reply.status(404).send({ error: 'Receivable not found' });
      }
      // Records the amount the debtor paid. The status only becomes PAID when the vault `pay` (USDC moved into the
      // ReceivableVault) is verified on-chain through POST /:id/chain, and DISTRIBUTED after the vault `distribute`.
      if (existing.status !== 'PENDING' || existing.paidValue !== null) {
        return reply.status(400).send({ error: 'Payment already recorded for this receivable' });
      }

      const receivable = await fastify.prisma.receivable.update({
        where: { id },
        data: {
          paidValue: body.paidValue,
          paidAt: new Date()
        },
        include: {
          fund: {
            select: { name: true, symbol: true }
          },
          sacado: {
            select: { name: true, document: true }
          }
        }
      });

      return { receivable };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // ---------- On-chain audit trail (ReceivableVault) ----------
  // The vault's state is read from the chain; this computes the next vault call needed to mirror the database.
  const CHAIN_ORDER = ['NOT_REGISTERED', 'PENDING', 'PAID', 'DISTRIBUTED'];
  const ON_CHAIN_STATUS = ['PENDING', 'PAID', 'DISTRIBUTED']; // ReceivableStatus discriminants in the contract

  async function chainStatusOf(vault: string, id: string): Promise<string> {
    try {
      const rec = await chain.readContract<{ status: number }>(vault, 'get_receivable', [toStringVal(id)]);
      return ON_CHAIN_STATUS[Number(rec.status)] ?? 'PENDING';
    } catch (error) {
      // A transport failure is not evidence that the receivable is absent.
      if (!/Error\(Contract,\s*#5\)/.test((error as Error).message)) throw error;
      return 'NOT_REGISTERED';
    }
  }

  type VaultCall = { method: string; args: StellarSdk.xdr.ScVal[]; signer: string };

  // Every vault call in a receivable's lifecycle, built from the database (the working copy)
  async function loadVaultContext(receivableId: string) {
    const vault = STELLAR_CONFIG.CONTRACTS.RECEIVABLE_VAULT;
    if (!vault) throw Object.assign(new Error('RECEIVABLE_VAULT_CONTRACT_ID is not configured'), { status: 500 });

    const rec = await fastify.prisma.receivable.findUnique({
      where: { id: receivableId },
      include: { fund: true, sacado: true, cedente: true },
    });
    if (!rec) throw Object.assign(new Error('Receivable not found'), { status: 404 });
    if (!rec.cedente) throw Object.assign(new Error('Receivable has no cedente'), { status: 400 });
    if (!rec.fund.tokenContractId) throw Object.assign(new Error('Fund share token not deployed yet'), { status: 400 });
    if (!rec.fund.fundWalletPublicKey) throw Object.assign(new Error('Fund wallet not configured'), { status: 400 });

    const admin = await chain.readContract<string>(vault, 'get_admin');
    const fundWallet = rec.fund.fundWalletPublicKey;
    // Every wallet shares were (or are being) minted to, recorded per order before signing. Wallets with a zero
    // balance are skipped by the vault, so this superset stays valid if an investor later connects another wallet.
    const orders = await fastify.prisma.order.findMany({
      where: { fundId: rec.fundId, shareHolder: { not: null } },
      select: { shareHolder: true },
    });
    const holders = [...new Set(orders.map((o) => o.shareHolder!))].sort();

    const calls: Record<string, VaultCall> = {
      fund: {
        method: 'admin_register_fund',
        args: [toStringVal(rec.fundId), toStringVal(rec.fund.name), toAddressVal(rec.fund.tokenContractId)],
        signer: admin,
      },
      cedente: {
        method: 'admin_register_entity',
        args: [toSymbolVal('cedente'), toStringVal(rec.cedente.id), toStringVal(rec.cedente.name)],
        signer: admin,
      },
      sacado: {
        method: 'admin_register_entity',
        args: [toSymbolVal('sacado'), toStringVal(rec.sacadoId), toStringVal(rec.sacado.name)],
        signer: admin,
      },
      register: {
        method: 'register_receivable',
        args: [
          toStringVal(rec.id),
          toStringVal(rec.fundId),
          toStringVal(rec.cedente.id),
          toStringVal(rec.sacadoId),
          toI128Val(toShareUnits(rec.faceValue)),
          StellarSdk.nativeToScVal(BigInt(Math.floor(rec.dueDate.getTime() / 1000)), { type: 'u64' }),
          toAddressVal(rec.sacado.publicKey || admin),
        ],
        signer: admin,
      },
      // The fund wallet, which collected the debtor's payment, moves the USDC into the vault
      pay: {
        method: 'pay',
        args: [toStringVal(rec.id), toAddressVal(fundWallet), toI128Val(toShareUnits(rec.paidValue ?? 0))],
        signer: fundWallet,
      },
      // Pro-rata distribution computed by the vault from the investors' balances in the fund's share token
      distribute: {
        method: 'distribute',
        args: [toStringVal(rec.id), StellarSdk.nativeToScVal(holders.map((h) => StellarSdk.Address.fromString(h)))],
        signer: admin,
      },
    };
    return { vault, admin, rec, calls, holders };
  }

  // Reads the vault's actual state and returns the next call needed to mirror the database (or done)
  async function nextVaultCall(receivableId: string) {
    const ctx = await loadVaultContext(receivableId);
    const { vault, rec, calls } = ctx;
    const onChain = await chainStatusOf(vault, rec.id);
    // Once the debtor's payment is recorded the receivable goes all the way: vault pay, then distribute
    const target = rec.paidValue !== null ? 'DISTRIBUTED' : 'PENDING';
    if (CHAIN_ORDER.indexOf(onChain) >= CHAIN_ORDER.indexOf(target)) {
      return { ...ctx, onChain, done: true as const };
    }

    let call: VaultCall;
    if (onChain === 'NOT_REGISTERED') {
      // Fund, cedente and sacado were approved off-chain by the manager; register them first
      const reg = (kind: string, id: string) => chain.readContract<boolean>(vault, 'is_registered', [toSymbolVal(kind), toStringVal(id)]);
      if (!(await reg('fund', rec.fundId))) call = calls.fund;
      else if (!(await reg('cedente', rec.cedente!.id))) call = calls.cedente;
      else if (!(await reg('sacado', rec.sacadoId))) call = calls.sacado;
      else call = calls.register;
    } else if (onChain === 'PENDING') {
      call = calls.pay;
    } else {
      // The vault requires the listed balances to add up to the share token's supply: check it first to fail clearly
      const token = rec.fund.tokenContractId!;
      const [supply, ...balances] = await Promise.all([
        chain.readContract<bigint>(token, 'total_supply'),
        ...ctx.holders.map((h) => chain.readContract<bigint>(token, 'balance', [toAddressVal(h)])),
      ]);
      const listed = balances.reduce((sum, b) => sum + BigInt(b), 0n);
      if (listed !== BigInt(supply)) {
        throw Object.assign(
          new Error(
            `Known shareholders hold ${listed} of ${supply} share units: some shares were moved to a wallet the platform does not know`
          ),
          { status: 409 }
        );
      }
      call = calls.distribute;
    }
    const stepId = Object.keys(calls).find(key => calls[key] === call)!;
    return { ...ctx, onChain, done: false as const, ...call, ...describeReceivableStep(rec, stepId) };
  }

  const nativeKey = (v: unknown) =>
    JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));

  // Read-only progress: never prepares a transaction or requests a signature.
  async function progressFor(id: string) {
    const ctx = await loadVaultContext(id);
    const onChain = await chainStatusOf(ctx.vault, id);
    const registered = await Promise.all(['fund', 'cedente', 'sacado'].map((kind, i) =>
      chain.readContract<boolean>(ctx.vault, 'is_registered', [toSymbolVal(kind), toStringVal([ctx.rec.fundId, ctx.rec.cedente!.id, ctx.rec.sacadoId][i])])));
    const rows = await fastify.prisma.multisigTransaction.findMany({
      where: { purpose: { startsWith: `receivable:${id}:` } }, orderBy: { createdAt: 'desc' },
    });
    const steps = [];
    for (const [stepId, call] of Object.entries(ctx.calls)) {
      const row = rows.find(row => {
        const tx = new StellarSdk.Transaction(row.xdr, NETWORK_PASSPHRASE);
        if (tx.source !== call.signer || tx.operations.length !== 1 || tx.operations[0].type !== 'invokeHostFunction') return false;
        const f = tx.operations[0].func;
        if (f.switch().name !== 'hostFunctionTypeInvokeContract') return false;
        const c = f.invokeContract();
        return StellarSdk.Address.fromScAddress(c.contractAddress()).toString() === ctx.vault &&
          c.functionName().toString() === call.method && nativeKey(c.args().map(a => StellarSdk.scValToNative(a))) === nativeKey(call.args.map(a => StellarSdk.scValToNative(a)));
      });
      const logged = row && await fastify.prisma.decisionLog.findFirst({
        where: { payload: { contains: `"txHash":"${row.txHash.toLowerCase()}"` } }, select: { seq: true },
      });
      const confirmed = stepId === 'fund' ? registered[0] : stepId === 'cedente' ? registered[1] : stepId === 'sacado' ? registered[2] :
        stepId === 'register' ? onChain !== 'NOT_REGISTERED' : stepId === 'pay' ? ['PAID', 'DISTRIBUTED'].includes(onChain) : onChain === 'DISTRIBUTED';
      const set = row && await chain.loadSignerSet(row.account);
      steps.push({ ...describeReceivableStep(ctx.rec, stepId), method: call.method,
        state: confirmed ? 'CONFIRMED' : row?.status === 'SUBMITTED' ? 'SUBMITTED_UNVERIFIED' : row ?
          (row.expiresAt <= new Date() || row.status === 'EXPIRED' ? 'EXPIRED' : 'PENDING_SIGNATURES') : 'NOT_STARTED',
        txHash: logged ? row!.txHash : undefined,
        verificationHash: row?.status === 'SUBMITTED' && !logged ? row.txHash : undefined,
        multisig: row && set ? { id: row.id, signedBy: row.signedBy, signers: set.signers,
          threshold: set.threshold, weight: signedWeight(set, row.signedBy), expiresAt: row.expiresAt } : undefined,
      });
    }
    return { chainStatus: onChain, steps };
  }

  fastify.get('/:id/chain', async (request, reply) => {
    if (!requireAuth(request, reply, ['GESTOR'])) return reply;
    try { return await progressFor((request.params as { id: string }).id); }
    catch (e) { return reply.status((e as any).status || 502).send({ error: 'Unable to read vault progress', reason: (e as Error).message }); }
  });

  // Without txHash: returns the next vault transaction for the vault admin to sign (or done).
  // With txHash: verifies it is exactly that call, signed by the vault admin, and records the progress.
  fastify.post('/:id/chain', async (request, reply) => {
    try {
      const user = requireAuth(request, reply, ['GESTOR']);
      if (!user) return reply;
      const { id } = request.params as { id: string };
      const { txHash, expectedStepId } = z.object({ txHash: z.string().optional(),
        expectedStepId: z.enum(['fund', 'cedente', 'sacado', 'register', 'pay', 'distribute']).optional(),
      }).parse(request.body ?? {});

      if (!txHash) {
        const progress = await progressFor(id);
        const unverified = progress.steps.find(s => s.verificationHash);
        if (unverified) return { ...unverified, done: false, verificationRequired: true, txHash: unverified.verificationHash };
        const next = await nextVaultCall(id);
        if (next.done) {
          // Self-healing: keep the database in step with the vault if a previous confirmation was interrupted
          const status = next.onChain === 'PAID' || next.onChain === 'DISTRIBUTED' ? next.onChain : 'PENDING';
          if (next.rec.chainStatus !== next.onChain || next.rec.status !== status) {
            await fastify.prisma.receivable.update({ where: { id }, data: { chainStatus: next.onChain, status } });
          }
          return { done: true, chainStatus: next.onChain };
        }
        if (expectedStepId && next.stepId !== expectedStepId)
          return { done: false, reviewRequired: true, step: next.method, ...describeReceivableStep(next.rec, next.stepId) };
        // A multisig signer (e.g. the admin after secure-admin.sh) collects signatures on one shared pending transaction
        const signerSet = await chain.loadSignerSet(next.signer);
        if (needsMultipleSignatures(signerSet)) {
          const argsHash = crypto
            .createHash('sha256')
            .update(nativeKey(next.args.map((a) => StellarSdk.scValToNative(a))))
            .digest('hex')
            .slice(0, 16);
          const pending = await chain.getOrCreatePending(
            fastify.prisma,
            `receivable:${id}:${next.method}:${argsHash}`,
            next.signer,
            () => chain.prepareInvocation(next.signer, next.vault, next.method, next.args, MULTISIG_TX_TIMEOUT_SECONDS)
          );
          return {
            done: false,
            step: next.method,
            ...describeReceivableStep(next.rec, next.stepId),
            signer: next.signer,
            transactionXdr: pending.xdr,
            multisig: {
              id: pending.id,
              signers: signerSet.signers,
              threshold: signerSet.threshold,
              signedBy: pending.signedBy,
              weight: signedWeight(signerSet, pending.signedBy),
              expiresAt: pending.expiresAt,
            },
          };
        }

        const transactionXdr = await chain.prepareInvocation(next.signer, next.vault, next.method, next.args);
        return { done: false, step: next.method, ...describeReceivableStep(next.rec, next.stepId), signer: next.signer, transactionXdr };
      }

      // Confirm the completed call independently of prerequisites for the next
      // step. In particular, holders/supply are still checked before preparing
      // distribute, but cannot hide an already confirmed pay transaction.
      const next = await loadVaultContext(id);
      let call;
      try {
        call = await chain.getConfirmedCall(txHash);
      } catch (e) {
        return reply.status(400).send({ error: 'Vault transaction verification failed', reason: (e as Error).message });
      }
      // The tx already executed, so the chain may have moved past `next`: accept exactly one of this
      // receivable's lifecycle calls, sent by the vault admin to the vault, then re-read the chain state.
      const lifecycle = Object.values(next.calls).map((c) => ({
        method: c.method,
        signer: c.signer,
        args: nativeKey(c.args.map((a) => StellarSdk.scValToNative(a))),
      }));
      const matched = Object.entries(next.calls).find(([, c]) => c.method === call.method && c.signer === call.source && nativeKey(c.args.map(a => StellarSdk.scValToNative(a))) === nativeKey(call.args));
      const matches =
        call.kind === 'invoke' &&
        call.contractId === next.vault &&
        lifecycle.some((c) => c.method === call.method && c.signer === call.source && c.args === nativeKey(call.args));
      if (!matches) {
        return reply.status(400).send({
          error: 'Vault transaction verification failed',
          reason: "Not one of this receivable's vault calls signed by the expected wallet",
        });
      }

      // The database status follows the verified vault state: PAID / DISTRIBUTED only exist once they happened on-chain
      const chainStatus = await chainStatusOf(next.vault, id);
      await fastify.prisma.receivable.update({
        where: { id },
        data: {
          chainStatus,
          chainTxHash: txHash,
          status: chainStatus === 'PAID' || chainStatus === 'DISTRIBUTED' ? chainStatus : 'PENDING',
        },
      });
      // Every verified vault transaction gets a decision log row (no hash without a log line). pay and distribute
      // map to existing actions; registrations use 'vault_register' once the policy log accepts it.
      const action = call.method === 'pay' ? 'pay' : call.method === 'distribute' ? 'distribute' : 'vault_register';
      if ((ONCHAIN_ACTIONS as readonly string[]).includes(action)) {
        const logged = await fastify.prisma.decisionLog.findFirst({
          where: { payload: { contains: `"txHash":"${txHash.toLowerCase()}"` } },
          select: { seq: true },
        });
        if (!logged) {
          await chain.appendOnchainEvent({
            userId: user.id,
            action: action as OnchainAction,
            txHash,
            fundId: next.rec.fundId,
            ...(action !== 'vault_register' && next.rec.paidValue !== null ? { amountUnits: toShareUnits(next.rec.paidValue).toString() } : {}),
          });
        }
      } else {
        fastify.log.warn({ method: call.method }, 'vault registration verified but the decision log has no vault_register action yet');
      }

      const target = next.rec.paidValue !== null ? 'DISTRIBUTED' : 'PENDING';
      const done = CHAIN_ORDER.indexOf(chainStatus) >= CHAIN_ORDER.indexOf(target);
      return { done, chainStatus, verifiedStep: call.method, txHash, verified: true,
        ...describeReceivableStep(next.rec, matched![0]) };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      const status = (error as { status?: number }).status;
      if (status) {
        return reply.status(status).send({ error: (error as Error).message });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to sync receivable on-chain' });
    }
  });
}
