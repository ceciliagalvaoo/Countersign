import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as StellarSdkNs from '@stellar/stellar-sdk';
import jwt from 'jsonwebtoken';

import { JWT_SECRET } from '../config/env.js';
import { hasTrustline, isPublicKey } from '../services/stellarVerify.js';
import { STELLAR_CONFIG } from '../config/stellar.js';
import { requireAuth } from '../config/auth.js';
import { appendOnchainEvent, bindDecisionLog } from '../policy/decisionLog.js';
import { bindMandateWallet, decodeInvocation } from '../services/mandateWallet.js';
import {
  EXPLORER_TX_BASE,
  NETWORK_LABEL,
  prepareInvocation,
  getConfirmedCall,
  prepareDeploy,
  readContract,
  toAddressVal,
  toI128Val,
  toShareUnits,
  toStringVal,
} from '../services/soroban.js';

const createFundSchema = z.object({
  name: z.string().min(1),
  // Used as the Stellar asset code of the fund's shares: 1-12 alphanumeric characters
  symbol: z.string().regex(/^[A-Za-z0-9]{1,12}$/, 'Symbol must be 1-12 letters or digits').transform((v) => v.toUpperCase()),
  maxSupply: z.number().int().positive(),
  price: z.number().positive().optional(),
  cnpj: z.string().min(1).optional(),
  fundType: z.enum(['FIDC', 'FIDC_NP']).optional(),
  investorProfile: z.enum(['GERAL', 'QUALIFICADO', 'PROFISSIONAL']).optional(),
  cvmCode: z.string().optional(),
  administratorName: z.string().optional(),
  administratorCnpj: z.string().optional(),
  managerName: z.string().optional(),
  managerCnpj: z.string().optional(),
  custodianName: z.string().optional(),
  auditorName: z.string().optional(),
  fiduciaryAgentName: z.string().optional(),
  sectorFocus: z.string().optional(),
  eligibilityCriteria: z.string().optional(),
  maxCedenteConcentrationPercent: z.number().optional(),
  maxSacadoConcentrationPercent: z.number().optional(),
  sectorConcentrationPercent: z.number().optional(),
  targetPmt: z.number().optional(),
  keyRisks: z.string().optional(),
  administrationFee: z.number().optional(),
  managementFee: z.number().optional(),
  performanceFee: z.number().optional(),
  otherFees: z.string().optional(),
  liquidityType: z.enum(['ABERTO', 'FECHADO', 'RESTRITO']).optional(),
  lockupDays: z.number().int().optional(),
  redemptionTerms: z.string().optional(),
  navPerShare: z.number().optional(),
  aum: z.number().optional(),
  return12m: z.number().optional(),
  returnYtd: z.number().optional(),
  returnSinceInception: z.number().optional(),
  description: z.string().optional(),
  // Metadata used by the recommendation engine
  riskLevel: z.enum(['BAIXO', 'MEDIO', 'ALTO']).optional(),
  sector: z.enum(['AGRO', 'VAREJO', 'INDUSTRIA', 'SERVICOS', 'TECH', 'SAUDE', 'OUTROS']).optional(),
  durationMonths: z.number().int().positive().optional(),
  minTicket: z.number().positive().optional(),
});

const approvalSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  fundWalletPublicKey: z.string().refine(isPublicKey, 'Invalid Stellar public key').optional()
});

function verifyToken(token: string) {
  try {
    return jwt.verify(token, JWT_SECRET) as any;
  } catch {
    throw new Error('Invalid token');
  }
}

async function readPaused(tokenContractId: string | null): Promise<boolean | null> {
  if (!tokenContractId) return null;
  try {
    return Boolean(await readContract<boolean>(tokenContractId, 'is_paused'));
  } catch {
    return null;
  }
}

export async function fundRoutes(fastify: FastifyInstance) {
  // Create fund (Gestor only)
  fastify.post('/', async (request, reply) => {
    try {
      const token = request.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return reply.status(401).send({ error: 'No token provided' });
      }

      const payload = verifyToken(token);
      if (payload.role !== 'GESTOR' && payload.role !== 'CONSULTOR') {
        return reply.status(403).send({ error: 'Only gestors and consultors can create funds' });
      }

      // If it's a consultor, check if they are approved
      if (payload.role === 'CONSULTOR') {
        // Ensure payload.id is defined (the JWT contains 'id', not 'userId')
        if (!payload.id) {
          return reply.status(400).send({ error: 'Invalid token payload. Missing user ID.' });
        }
        
        const consultor = await fastify.prisma.user.findUnique({
          where: { id: payload.id }
        });
        
        if (!consultor || consultor.status !== 'APPROVED') {
          return reply.status(403).send({ error: 'Consultor must be approved to create funds' });
        }
      }

      const body = createFundSchema.parse(request.body);

      // Check if symbol already exists
      const existingFund = await fastify.prisma.fund.findUnique({
        where: { symbol: body.symbol }
      });

      if (existingFund) {
        return reply.status(400).send({ error: 'Symbol already exists' });
      }

      // Prepare fund data
      const fundData = {
        name: body.name,
        symbol: body.symbol,
        maxSupply: body.maxSupply,
        price: body.price ?? undefined,
        cnpj: body.cnpj,
        fundType: body.fundType,
        investorProfile: body.investorProfile,
        cvmCode: body.cvmCode,
        administratorName: body.administratorName,
        administratorCnpj: body.administratorCnpj,
        managerName: body.managerName,
        managerCnpj: body.managerCnpj,
        custodianName: body.custodianName,
        auditorName: body.auditorName,
        fiduciaryAgentName: body.fiduciaryAgentName,
        sectorFocus: body.sectorFocus,
        eligibilityCriteria: body.eligibilityCriteria,
        maxCedenteConcentrationPercent: body.maxCedenteConcentrationPercent,
        maxSacadoConcentrationPercent: body.maxSacadoConcentrationPercent,
        sectorConcentrationPercent: body.sectorConcentrationPercent,
        targetPmt: body.targetPmt,
        keyRisks: body.keyRisks,
        administrationFee: body.administrationFee,
        managementFee: body.managementFee,
        performanceFee: body.performanceFee,
        otherFees: body.otherFees,
        liquidityType: body.liquidityType,
        lockupDays: body.lockupDays,
        redemptionTerms: body.redemptionTerms,
        navPerShare: body.navPerShare,
        aum: body.aum,
        return12m: body.return12m,
        returnYtd: body.returnYtd,
        returnSinceInception: body.returnSinceInception,
        description: body.description,
        riskLevel: body.riskLevel,
        sector: body.sector,
        durationMonths: body.durationMonths,
        minTicket: body.minTicket,
        // Every fund starts PENDING: approval is where the manager sets the fund wallet (USDC trustline checked),
        // which then deploys the share token. A fund approved without a wallet could never be deployed.
        status: 'PENDING',
        // Associate consultor if applicable
        ...(payload.role === 'CONSULTOR' && { consultorId: payload.id })
      };

      const fund = await fastify.prisma.fund.create({
        data: fundData
      });

      return { fund };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // List funds
  fastify.get('/', async (request, reply) => {
    try {
      const isGestor = request.user?.role === 'GESTOR';
      const { page = '1', limit = '50' } = request.query as { page?: string; limit?: string };
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const take = parseInt(limit);

      const [funds, total] = await Promise.all([
        fastify.prisma.fund.findMany({
          select: {
            id: true,
            name: true,
            symbol: true,
            status: true,
            maxSupply: true,
            totalIssued: true,
            price: true,
            fundType: true,
            description: true,
            cvmCode: true,
            riskLevel: true,
            sector: true,
            durationMonths: true,
            minTicket: true,
            tokenContractId: true,
            createdAt: true,
            // Contact data of the consultant is only for managers
            ...(isGestor && { consultor: { select: { email: true, publicKey: true } } }),
          },
          skip,
          take,
          orderBy: { createdAt: 'desc' }
        }),
        fastify.prisma.fund.count()
      ]);

      // Fetch metrics only for the funds on the current page
      const fundIds = funds.map(f => f.id);
      const [receivablesData, ordersData] = await Promise.all([
        fastify.prisma.receivable.groupBy({
          by: ['fundId'],
          where: { fundId: { in: fundIds } },
          _sum: { faceValue: true }
        }),
        fastify.prisma.order.groupBy({
          by: ['fundId'],
          // Refunded orders no longer hold quotas
          where: { fundId: { in: fundIds }, status: 'COMPLETED', approvalStatus: { not: 'REJECTED' } },
          _sum: { quantity: true }
        })
      ]);

      const receivablesMap = new Map(receivablesData.map(r => [r.fundId, r._sum.faceValue || 0]));
      const ordersMap = new Map(ordersData.map(o => [o.fundId, o._sum.quantity || 0]));

      // Issuer freeze state read from each FundToken (is_paused); null when there is no token or the read fails
      const pausedById = new Map(
        await Promise.all(funds.map(async (f) => [f.id, await readPaused(f.tokenContractId)] as const))
      );

      const fundsWithMetrics = funds.map(fund => {
        const totalSold = ordersMap.get(fund.id) || 0;
        const totalReceivables = receivablesMap.get(fund.id) || 0;
        
        return {
          ...fund,
          paused: pausedById.get(fund.id) ?? null,
          totalSold,
          totalReceivables,
          availableQuotas: fund.totalIssued - totalSold
        };
      });

      return { 
        funds: fundsWithMetrics, 
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit))
        }
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Get fund by id
  fastify.get('/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      // Investors' identities and debtors' documents are only visible to managers
      const isGestor = request.user?.role === 'GESTOR';

      const [fund, receivables, orders] = await Promise.all([
        fastify.prisma.fund.findUnique({
          where: { id }
        }),
        fastify.prisma.receivable.findMany({
          where: { fundId: id },
          select: {
            id: true,
            faceValue: true,
            status: true,
            dueDate: true,
            ...(isGestor && { sacado: { select: { name: true, document: true } } }),
          },
          take: 100,
          orderBy: { createdAt: 'desc' }
        }),
        fastify.prisma.order.findMany({
          where: { fundId: id, status: 'COMPLETED', approvalStatus: { not: 'REJECTED' } },
          select: {
            id: true,
            quantity: true,
            total: true,
            createdAt: true,
            ...(isGestor && { investor: { select: { email: true, publicKey: true } } }),
          },
          take: 100,
          orderBy: { createdAt: 'desc' }
        })
      ]);

      if (!fund) {
        return reply.status(404).send({ error: 'Fund not found' });
      }

      const totalSold = orders.reduce((sum, order) => sum + order.quantity, 0);
      const totalReceivables = receivables.reduce((sum, rec) => sum + rec.faceValue, 0);

      return {
        fund: {
          ...fund,
          receivables,
          orders: isGestor ? orders : [],
          totalSold,
          totalReceivables,
          availableQuotas: fund.totalIssued - totalSold,
          paused: await readPaused(fund.tokenContractId)
        }
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Update fund contract address (after Soroban deployment)
  fastify.patch('/:id/contract', async (request, reply) => {
    try {
      const token = request.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return reply.status(401).send({ error: 'No token provided' });
      }

      const payload = verifyToken(token);
      if (payload.role !== 'GESTOR') {
        return reply.status(403).send({ error: 'Only gestors can update contracts' });
      }

      const { id } = request.params as { id: string };
      const { contractAddress } = z.object({ contractAddress: z.string() }).parse(request.body);

      const fund = await fastify.prisma.fund.update({
        where: { id },
        data: { contractAddress }
      });

      return { fund };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Issue quotas (mint tokens) - Gestor only
  fastify.post('/:id/issue', async (request, reply) => {
    try {
      const token = request.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return reply.status(401).send({ error: 'No token provided' });
      }

      const payload = verifyToken(token);
      if (payload.role !== 'GESTOR') {
        return reply.status(403).send({ error: 'Only gestors can issue quotas' });
      }

      const { id } = request.params as { id: string };
      const { amount } = z.object({ amount: z.number().positive() }).parse(request.body);

      const fund = await fastify.prisma.fund.findUnique({ where: { id } });
      if (!fund) {
        return reply.status(404).send({ error: 'Fund not found' });
      }

      if (fund.totalIssued + amount > fund.maxSupply) {
        return reply.status(400).send({ error: 'Amount exceeds max supply' });
      }

      const updatedFund = await fastify.prisma.fund.update({
        where: { id },
        data: { totalIssued: fund.totalIssued + amount }
      });

      return { fund: updatedFund };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Build the deploy of this fund's share token (FundToken contract), signed by the fund wallet, which becomes its admin
  fastify.post('/:id/token/build-deploy', async (request, reply) => {
    try {
      const user = requireAuth(request, reply, ['GESTOR']);
      if (!user) return reply;
      const { id } = request.params as { id: string };
      const { deployer } = z.object({ deployer: z.string().refine(isPublicKey, 'Invalid Stellar public key') }).parse(request.body);

      const fund = await fastify.prisma.fund.findUnique({ where: { id } });
      if (!fund) {
        return reply.status(404).send({ error: 'Fund not found' });
      }
      if (fund.status !== 'APPROVED') {
        return reply.status(400).send({ error: 'Fund must be approved first' });
      }
      if (fund.tokenContractId) {
        return reply.status(409).send({ error: 'Fund share token already deployed', tokenContractId: fund.tokenContractId });
      }
      if (!fund.fundWalletPublicKey || deployer !== fund.fundWalletPublicKey) {
        return reply.status(400).send({ error: 'Connect the fund wallet: it deploys and administers the share token' });
      }
      if (!STELLAR_CONFIG.FUND_TOKEN_WASM_HASH) {
        return reply.status(500).send({ error: 'FUND_TOKEN_WASM_HASH is not configured on the server' });
      }

      const transactionXdr = await prepareDeploy(deployer, STELLAR_CONFIG.FUND_TOKEN_WASM_HASH, [
        toAddressVal(deployer),
        toStringVal(fund.name),
        toStringVal(fund.symbol),
        toI128Val(toShareUnits(fund.maxSupply)),
      ]);
      return { transactionXdr, message: 'Sign with the fund wallet to deploy the share token' };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to build token deploy' });
    }
  });

  // Confirm the share token deploy: verified on-chain before the contract ID is stored
  fastify.post('/:id/token/confirm', async (request, reply) => {
    try {
      const user = requireAuth(request, reply, ['GESTOR']);
      if (!user) return reply;
      const { id } = request.params as { id: string };
      const { txHash } = z.object({ txHash: z.string() }).parse(request.body);

      const fund = await fastify.prisma.fund.findUnique({ where: { id } });
      if (!fund) {
        return reply.status(404).send({ error: 'Fund not found' });
      }
      if (fund.tokenContractId) {
        return reply.status(409).send({ error: 'Fund share token already deployed' });
      }

      let call;
      try {
        call = await getConfirmedCall(txHash);
      } catch (e) {
        return reply.status(400).send({ error: 'Token deploy verification failed', reason: (e as Error).message });
      }
      if (
        call.kind !== 'deploy' ||
        call.source !== fund.fundWalletPublicKey ||
        call.wasmHash !== STELLAR_CONFIG.FUND_TOKEN_WASM_HASH ||
        !call.contractId
      ) {
        return reply.status(400).send({ error: 'Transaction is not a FundToken deploy by the fund wallet' });
      }

      // The constructor arguments are read back from the new contract itself
      const [admin, symbol] = await Promise.all([
        readContract<string>(call.contractId, 'admin'),
        readContract<string>(call.contractId, 'symbol'),
      ]);
      if (admin !== fund.fundWalletPublicKey || symbol !== fund.symbol) {
        return reply.status(400).send({ error: 'Deployed token does not match this fund' });
      }

      const updated = await fastify.prisma.fund.update({
        where: { id },
        data: { tokenContractId: call.contractId },
      });
      return { fund: updated, tokenContractId: call.contractId };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to confirm token deploy' });
    }
  });

  // ---------- Issuer freeze (Countersign S14): set_pause on the fund's FundToken, signed by the fund wallet ----------
  bindDecisionLog(fastify.prisma);
  bindMandateWallet(fastify.prisma);
  const pauseBody = z.object({ paused: z.boolean() });

  fastify.post('/:id/pause/build', async (request, reply) => {
    try {
      const user = requireAuth(request, reply, ['GESTOR']);
      if (!user) return reply;
      const { id } = request.params as { id: string };
      const { paused } = pauseBody.parse(request.body);
      const fund = await fastify.prisma.fund.findUnique({ where: { id } });
      if (!fund) return reply.status(404).send({ error: 'Fund not found' });
      if (!fund.tokenContractId || !fund.fundWalletPublicKey) {
        return reply.status(400).send({ error: 'Fund share token not deployed yet' });
      }
      const transactionXdr = await prepareInvocation(fund.fundWalletPublicKey, fund.tokenContractId, 'set_pause', [
        StellarSdkNs.xdr.ScVal.scvBool(paused),
      ]);
      const decoded = await decodeInvocation(transactionXdr, {});
      return { transactionXdr, decoded, signer: fund.fundWalletPublicKey, network: NETWORK_LABEL };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to build the pause transaction' });
    }
  });

  fastify.post('/:id/pause/confirm', async (request, reply) => {
    try {
      const user = requireAuth(request, reply, ['GESTOR']);
      if (!user) return reply;
      const { id } = request.params as { id: string };
      const { txHash, paused } = z.object({ txHash: z.string(), paused: z.boolean() }).parse(request.body);
      const fund = await fastify.prisma.fund.findUnique({ where: { id } });
      if (!fund) return reply.status(404).send({ error: 'Fund not found' });
      if (!fund.tokenContractId || !fund.fundWalletPublicKey) {
        return reply.status(400).send({ error: 'Fund share token not deployed yet' });
      }
      let call;
      try {
        call = await getConfirmedCall(txHash);
      } catch (e) {
        return reply.status(400).send({ error: 'Pause verification failed', reason: (e as Error).message });
      }
      const ok =
        call.kind === 'invoke' &&
        call.contractId === fund.tokenContractId &&
        call.method === 'set_pause' &&
        call.source === fund.fundWalletPublicKey &&
        call.args?.length === 1 &&
        call.args[0] === paused;
      if (!ok) {
        return reply.status(400).send({ error: 'Pause verification failed', reason: 'Transaction is not set_pause on this fund token by the fund wallet' });
      }
      // The effect is read back from the contract, not assumed
      const isPaused = await readContract<boolean>(fund.tokenContractId, 'is_paused');
      const row = await appendOnchainEvent({ userId: user.id, action: 'set_pause', txHash, fundId: fund.id });
      return {
        verified: true,
        paused: isPaused,
        txHash: txHash.toLowerCase(),
        txUrl: `${EXPLORER_TX_BASE}${txHash.toLowerCase()}`,
        network: NETWORK_LABEL,
        logSeq: row.seq,
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to confirm the pause' });
    }
  });

  // Approve/reject fund (Gestor only)
  fastify.patch('/:id/approval', async (request, reply) => {
    try {
      const token = request.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return reply.status(401).send({ error: 'No token provided' });
      }

      const user = verifyToken(token);
      const params = request.params as { id: string };
      
      if (user.role !== 'GESTOR') {
        return reply.status(403).send({ error: 'Access denied' });
      }

      const body = approvalSchema.parse(request.body);
      
      const fund = await fastify.prisma.fund.findUnique({
        where: { id: params.id }
      });

      if (!fund) {
        return reply.status(404).send({ error: 'Fund not found' });
      }
      // Approval is a one-time decision: re-approving could swap the wallet that administers a deployed share token
      if (fund.status !== 'PENDING') {
        return reply.status(400).send({ error: `Only pending funds can be approved or rejected (current: ${fund.status})` });
      }

      // If approving, require fund wallet
      if (body.status === 'APPROVED' && !body.fundWalletPublicKey && !fund.fundWalletPublicKey) {
        return reply.status(400).send({ error: 'Fund wallet public key is required for approval' });
      }

      // The fund wallet receives investments in the payment asset, so it must already trust it
      const walletToUse = body.fundWalletPublicKey || fund.fundWalletPublicKey;
      if (body.status === 'APPROVED' && walletToUse && !(await hasTrustline(walletToUse, STELLAR_CONFIG.PAYMENT_ASSET))) {
        return reply.status(400).send({
          error: `Fund wallet must exist on the network and have a ${STELLAR_CONFIG.PAYMENT_ASSET.code} trustline before approval`,
        });
      }

      const updateData: any = { status: body.status };
      if (body.fundWalletPublicKey) {
        updateData.fundWalletPublicKey = body.fundWalletPublicKey;
      }

      const updatedFund = await fastify.prisma.fund.update({
        where: { id: params.id },
        data: updateData,
        include: {
          consultor: {
            select: {
              email: true
            }
          }
        }
      });

      // Create the Blend pool automatically when the fund is approved
      if (body.status === 'APPROVED') {
        try {
          // Import the Blend configuration
          const { BLEND_CONTRACTS } = await import('../config/blend.js');
          
          // Check whether this fund already has a pool
          const existingPool = await fastify.prisma.pool.findFirst({
            where: { fundId: params.id }
          });

          if (!existingPool) {
            // Create the pool
            const pool = await fastify.prisma.pool.create({
              data: {
                name: `${fund.name} - Yield Pool`,
                fundId: params.id,
                blendPoolAddress: BLEND_CONTRACTS.USDC_POOL,
                assetAddress: BLEND_CONTRACTS.USDC,
                totalDeposited: 0,
                currentBalance: 0,
                yieldEarned: 0,
                status: 'ACTIVE',
              }
            });

            fastify.log.info(`Pool created for fund ${fund.name}: ${pool.id}`);
          }
        } catch (poolError) {
          fastify.log.error(poolError);
          fastify.log.error('Error creating the pool');
          // A pool error does not fail the approval
        }
      }

      return { fund: updatedFund };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Deactivate fund (Gestor only)
  fastify.patch('/:id/deactivate', async (request, reply) => {
    try {
      const token = request.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return reply.status(401).send({ error: 'No token provided' });
      }

      const user = verifyToken(token);
      const params = request.params as { id: string };
      
      if (user.role !== 'GESTOR') {
        return reply.status(403).send({ error: 'Access denied' });
      }
      
      const fund = await fastify.prisma.fund.findUnique({
        where: { id: params.id }
      });

      if (!fund) {
        return reply.status(404).send({ error: 'Fund not found' });
      }

      const updatedFund = await fastify.prisma.fund.update({
        where: { id: params.id },
        data: { status: 'CLOSED' },
        include: {
          consultor: {
            select: {
              email: true
            }
          }
        }
      });

      return { fund: updatedFund };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
