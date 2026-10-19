import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as StellarSdk from '@stellar/stellar-sdk';
import { STELLAR_CONFIG } from '../config/stellar.js';
import { blendConfig, rpcServerOptions } from '../config/blend.js';
import { isPublicKey, isTxHash } from '../services/stellarVerify.js';
import { requireAuth } from '../config/auth.js';

// Non-custodial by design: these routes only read from the network.
// Every transaction is built and signed in the user's wallet (Freighter / Stellar Wallets Kit);
// secret keys never reach this server.

const server = new StellarSdk.Horizon.Server(STELLAR_CONFIG.HORIZON_URL);
const sorobanRpc = new StellarSdk.rpc.Server(blendConfig.rpc, rpcServerOptions);

const publicKeySchema = z.string().refine(isPublicKey, 'Invalid Stellar public key');
const contractIdSchema = z.string().refine((id) => StellarSdk.StrKey.isValidContract(id), 'Invalid contract ID');

export async function stellarRoutes(fastify: FastifyInstance) {
  // Configured network and contract IDs
  fastify.get('/config', async () => ({
    network: STELLAR_CONFIG.NETWORK,
    horizonUrl: STELLAR_CONFIG.HORIZON_URL,
    rpcUrl: blendConfig.rpc,
    contracts: {
      fundToken: STELLAR_CONFIG.CONTRACTS.FUND_TOKEN || null,
      receivableVault: STELLAR_CONFIG.CONTRACTS.RECEIVABLE_VAULT || null,
    },
    adminAddress: STELLAR_CONFIG.ADMIN_ADDRESS || null,
    paymentAsset: STELLAR_CONFIG.PAYMENT_ASSET,
  }));

  // Testnet only: relays Blend's faucet, which returns a transaction (signed by the USDC issuer) that adds
  // trustlines and sends test USDC. The user signs and submits it with their own wallet.
  // The faucet blocks browser requests from other origins, hence the relay.
  fastify.post('/test-usdc', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    try {
      const user = requireAuth(request, reply);
      if (!user) return reply;
      if (STELLAR_CONFIG.NETWORK !== 'testnet') {
        return reply.status(400).send({ error: 'Test USDC is only available on testnet' });
      }
      const { publicKey } = z.object({ publicKey: publicKeySchema }).parse(request.body);

      const response = await fetch(`${STELLAR_CONFIG.TESTNET_FAUCET_URL}?userId=${encodeURIComponent(publicKey)}`);
      if (!response.ok) {
        return reply.status(502).send({ error: 'Faucet unavailable, try again later' });
      }
      const transactionXdr = (await response.text()).trim();

      // Never hand the user a transaction we have not inspected: it must come from the asset issuer,
      // and the user's account may only appear as the source of trustline operations.
      const tx = new StellarSdk.Transaction(transactionXdr, blendConfig.passphrase);
      const issuer = STELLAR_CONFIG.PAYMENT_ASSET.issuer;
      const safe =
        tx.source === issuer &&
        tx.operations.every((op: any) =>
          op.source === publicKey
            ? op.type === 'changeTrust'
            : (op.source ?? tx.source) === issuer && op.type === 'payment' && op.destination === publicKey
        );
      if (!safe) {
        fastify.log.warn('Faucet returned an unexpected transaction; refusing to relay it');
        return reply.status(502).send({ error: 'Faucet returned an unexpected transaction' });
      }

      return { transactionXdr };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to get test USDC' });
    }
  });

  // Builds a plain USDC trustline (changeTrust, source = the user's own account) for the user to sign.
  // Fallback for wallets that cannot sign the faucet transaction, whose source is the asset issuer.
  fastify.post('/usdc-trustline', async (request, reply) => {
    try {
      const user = requireAuth(request, reply);
      if (!user) return reply;
      const { publicKey } = z.object({ publicKey: publicKeySchema }).parse(request.body);
      const asset = new StellarSdk.Asset(STELLAR_CONFIG.PAYMENT_ASSET.code, STELLAR_CONFIG.PAYMENT_ASSET.issuer);

      const account = await server.loadAccount(publicKey);
      const hasTrustline = account.balances.some(
        (b: any) => b.asset_code === asset.getCode() && b.asset_issuer === asset.getIssuer()
      );
      if (hasTrustline) return { hasTrustline: true, transactionXdr: null };

      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: blendConfig.passphrase,
      })
        .addOperation(StellarSdk.Operation.changeTrust({ asset }))
        .setTimeout(300)
        .build();
      return { hasTrustline: false, transactionXdr: tx.toXDR() };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(404).send({ error: 'Account not found on the network' });
    }
  });

  // Testnet only: sends TEST USDC (no monetary value) from an operator account of ours to the caller's own account,
  // for wallets that cannot sign the faucet transaction. TESTNET_USDC_FUNDER_SECRET is a testnet-only key that holds
  // only test XLM and test USDC; it is never a user's key and never used on mainnet. One transfer of up to
  // 25 test USDC per account per UTC day (in memory: a restart resets the counter, acceptable for a test asset).
  // The account must already have the USDC trustline (POST /usdc-trustline).
  const TEST_USDC_DAILY_UNITS = 25n * 10_000_000n;
  const testUsdcSent = new Map<string, string>(); // publicKey -> UTC day of the last transfer
  let funderQueue: Promise<unknown> = Promise.resolve();
  fastify.post('/test-usdc-transfer', { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } }, async (request, reply) => {
    try {
      const user = requireAuth(request, reply);
      if (!user) return reply;
      const funderSecret = process.env.TESTNET_USDC_FUNDER_SECRET?.trim();
      if (STELLAR_CONFIG.NETWORK !== 'testnet' || blendConfig.passphrase !== StellarSdk.Networks.TESTNET || !funderSecret) {
        return reply.status(404).send({ error: 'Test USDC transfer is not configured' });
      }
      const { publicKey } = z.object({ publicKey: publicKeySchema }).parse(request.body);
      const day = new Date().toISOString().slice(0, 10);
      if (testUsdcSent.get(publicKey) === day) {
        return reply.status(429).send({ error: 'This account already received test USDC today' });
      }
      const asset = new StellarSdk.Asset(STELLAR_CONFIG.PAYMENT_ASSET.code, STELLAR_CONFIG.PAYMENT_ASSET.issuer);
      let account;
      try {
        account = await server.loadAccount(publicKey);
      } catch {
        return reply.status(404).send({ error: 'Account not found on the network' });
      }
      const trusts = account.balances.some((b: any) => b.asset_code === asset.getCode() && b.asset_issuer === asset.getIssuer());
      if (!trusts) {
        return reply.status(400).send({ error: 'Add the USDC trustline first (POST /api/stellar/usdc-trustline)' });
      }
      testUsdcSent.set(publicKey, day);
      const funder = StellarSdk.Keypair.fromSecret(funderSecret);
      if (funder.publicKey() === publicKey) {
        return reply.status(400).send({ error: 'Not for the operator account' });
      }
      const amount = (Number(TEST_USDC_DAILY_UNITS) / 1e7).toFixed(7);
      // One submission at a time from the operator account (sequence numbers)
      const job = funderQueue.catch(() => undefined).then(async () => {
        const source = await server.loadAccount(funder.publicKey());
        const tx = new StellarSdk.TransactionBuilder(source, { fee: StellarSdk.BASE_FEE, networkPassphrase: blendConfig.passphrase })
          .addOperation(StellarSdk.Operation.payment({ destination: publicKey, asset, amount }))
          .setTimeout(60)
          .build();
        tx.sign(funder);
        const res = await server.submitTransaction(tx);
        return (res as { hash: string }).hash;
      });
      funderQueue = job;
      let txHash: string;
      try {
        txHash = await job;
      } catch (e) {
        testUsdcSent.delete(publicKey);
        const codes = (e as any)?.response?.data?.extras?.result_codes;
        fastify.log.warn({ codes }, 'test USDC transfer failed');
        return reply.status(502).send({ error: 'Test USDC transfer failed', ...(codes ? { resultCodes: codes } : {}) });
      }
      return { txHash, amount, asset: STELLAR_CONFIG.PAYMENT_ASSET, network: 'Stellar testnet', label: 'test USDC on Stellar testnet; no monetary value' };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to send test USDC' });
    }
  });

  // Get account balances
  fastify.post('/balance', async (request, reply) => {
    try {
      const { publicKey } = z.object({ publicKey: publicKeySchema }).parse(request.body);
      const account = await server.loadAccount(publicKey);

      const balances = account.balances.map((balance: any) => ({
        asset_type: balance.asset_type,
        asset_code: balance.asset_code || (balance.asset_type === 'native' ? 'XLM' : undefined),
        asset_issuer: balance.asset_issuer,
        balance: balance.balance,
      }));

      return { balances };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(404).send({ error: 'Account not found on the network' });
    }
  });

  // Fund account with friendbot (testnet only)
  fastify.post('/fund-account', async (request, reply) => {
    try {
      if (STELLAR_CONFIG.NETWORK !== 'testnet') {
        return reply.status(400).send({ error: 'Friendbot is only available on testnet' });
      }
      const { publicKey } = z.object({ publicKey: publicKeySchema }).parse(request.body);

      const response = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`);
      if (!response.ok) {
        return reply.status(502).send({ error: 'Friendbot could not fund the account (it may already be funded)' });
      }

      return { success: true };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to fund account' });
    }
  });

  // Get transaction details
  fastify.get('/transaction/:hash', async (request, reply) => {
    try {
      const { hash } = request.params as { hash: string };
      if (!isTxHash(hash)) {
        return reply.status(400).send({ error: 'Invalid transaction hash' });
      }

      const transaction = await server.transactions().transaction(hash).call();
      return { transaction };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(404).send({ error: 'Transaction not found' });
    }
  });

  // Read a FundToken balance by simulating `balance(addr)` (read-only, nothing is signed or submitted)
  fastify.post('/contract-balance', async (request, reply) => {
    try {
      const { contractId, accountPublicKey } = z.object({
        contractId: contractIdSchema.optional(),
        accountPublicKey: publicKeySchema,
      }).parse(request.body);

      const id = contractId || STELLAR_CONFIG.CONTRACTS.FUND_TOKEN;
      if (!id) {
        return reply.status(400).send({ error: 'No contract ID provided or configured' });
      }

      // Simulation only needs a syntactically valid source account
      const source = new StellarSdk.Account(accountPublicKey, '0');
      const tx = new StellarSdk.TransactionBuilder(source, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: blendConfig.passphrase,
      })
        .addOperation(
          new StellarSdk.Contract(id).call('balance', StellarSdk.nativeToScVal(accountPublicKey, { type: 'address' }))
        )
        .setTimeout(30)
        .build();

      const simulation = await sorobanRpc.simulateTransaction(tx);
      if (StellarSdk.rpc.Api.isSimulationError(simulation) || !simulation.result) {
        return reply.status(400).send({ error: 'Contract call failed', details: (simulation as any).error });
      }

      const balance = StellarSdk.scValToNative(simulation.result.retval) as bigint;
      return { contractId: id, account: accountPublicKey, balance: balance.toString() };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to get contract balance' });
    }
  });
}
