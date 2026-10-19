import * as Sdk from '@stellar/stellar-sdk';
import type { PrismaClient } from '@prisma/client';
import { AGENT_KEY_ENCRYPTION_SECRET } from '../config/env.js';
import { STELLAR_CONFIG } from '../config/stellar.js';
import { blendConfig } from '../config/blend.js';
import { getChainReader, type ChainReader } from '../policy/chain.js';
import { appendEntry, getEntry } from '../policy/decisionLog.js';
import { openSeed, sealSeed } from './keyCrypto.js';
import { checkSubscribeXdr } from './verifyXdr.js';

/**
 * Agent signer (our server). It holds one agent key per investor mandate wallet, encrypted at rest, and signs
 * only a subscribe call that matches an APPROVED, not yet executed decision of the policy log.
 *
 * Honest boundary: the key lives on our server, separate from the language model, which never sees it. If the
 * server were compromised, the attacker could only make purchases the wallet contract allows (fund wallets the
 * investor approved, within limits she signed, each decision once). Keep only an operational XLM balance on the
 * agent account (fees); it never holds the investor's USDC.
 *
 * This module never logs, prints or returns the secret: only public keys and signed envelopes leave it.
 */

let prismaRef: PrismaClient | null = null;
export function bindAgentSigner(prisma: PrismaClient) {
  prismaRef = prisma;
}
function db(prisma?: PrismaClient) {
  const p = prisma ?? prismaRef;
  if (!p) throw new Error('agent signer is not bound to a database (call bindAgentSigner)');
  return p;
}

export class SignerRefusedError extends Error {
  constructor(public readonly field: string, reason: string) {
    super(`signer refused (${field}): ${reason}`);
    this.name = 'SignerRefusedError';
  }
}

async function friendbot(publicKey: string): Promise<boolean> {
  if (STELLAR_CONFIG.NETWORK !== 'testnet') return false;
  try {
    const res = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Creates (once) the agent key of this investor and returns only its public key. Idempotent: an existing key is
 * returned as is (rotation goes through set_agent on the wallet, signed by the owner). On testnet the account is
 * funded by friendbot so it can pay fees.
 */
export async function createAgentKey(
  userId: string,
  opts: { prisma?: PrismaClient; fundAccount?: boolean } = {}
): Promise<{ publicKey: string; created: boolean; funded: boolean }> {
  const prisma = db(opts.prisma);
  const existing = await prisma.agentKey.findUnique({ where: { userId }, select: { publicKey: true } });
  if (existing) return { publicKey: existing.publicKey, created: false, funded: false };

  const kp = Sdk.Keypair.random();
  const publicKey = kp.publicKey();
  const seed = kp.rawSecretKey();
  let sealed;
  try {
    sealed = sealSeed(seed, userId, publicKey, AGENT_KEY_ENCRYPTION_SECRET);
  } finally {
    seed.fill(0);
  }
  try {
    await prisma.agentKey.create({ data: { userId, publicKey, ...sealed } });
  } catch (e) {
    // Concurrent creation for the same investor: keep the row that won
    const winner = await prisma.agentKey.findUnique({ where: { userId }, select: { publicKey: true } });
    if (winner) return { publicKey: winner.publicKey, created: false, funded: false };
    throw new Error('Could not store the agent key');
  }
  const funded = opts.fundAccount === false ? false : await friendbot(publicKey);
  return { publicKey, created: true, funded };
}

export async function getAgentPublicKey(userId: string, prisma?: PrismaClient): Promise<string | null> {
  const row = await db(prisma).agentKey.findUnique({ where: { userId }, select: { publicKey: true } });
  return row?.publicKey ?? null;
}

/**
 * Signs `xdrB64` with the agent key only if it is exactly subscribe(hash of row seq, fund wallet of the decision's
 * fund from the database, amountUnits of the decision) on this investor's wallet, with the agent key as source,
 * and the decision is APPROVED and claimed for execution (DecisionExecution PENDING). Otherwise refuses, writes a
 * `signer_refused` row to the decision log and throws SignerRefusedError. Returns the signed envelope (base64).
 */
export async function signSubscription(
  seq: number,
  xdrB64: string,
  opts: { prisma?: PrismaClient; chain?: ChainReader; networkPassphrase?: string } = {}
): Promise<string> {
  const prisma = db(opts.prisma);
  const chain = opts.chain ?? getChainReader();
  const entry = await getEntry(seq, prisma);
  if (!entry) throw new SignerRefusedError('decision', 'no such decision');
  const p = entry.payload;

  const refuse = async (field: string, reason: string): Promise<never> => {
    await appendEntry(
      {
        kind: 'decision',
        userId: p.userId,
        origin: p.origin,
        fundId: p.fundId,
        amountUnits: p.amountUnits,
        rule: 'signer_refused',
        outcome: 'REJECTED',
        mandateHash: p.mandateHash,
        toolCallId: p.toolCallId,
      },
      prisma
    );
    throw new SignerRefusedError(field, reason);
  };

  if (p.kind !== 'decision' || p.outcome !== 'APPROVED' || !p.fundId) return refuse('decision', 'decision is not APPROVED');
  const execution = await prisma.decisionExecution.findUnique({ where: { seq } });
  if (!execution || execution.status !== 'PENDING') return refuse('decision', 'decision is not claimed for execution or was already signed');

  const key = await prisma.agentKey.findUnique({ where: { userId: p.userId } });
  if (!key) return refuse('source', 'no agent key for this investor');
  const wallet = await chain.walletFor(p.userId).catch(() => null);
  if (!wallet) return refuse('contract', 'no mandate wallet for this investor');
  const fund = await prisma.fund.findUnique({ where: { id: p.fundId }, select: { fundWalletPublicKey: true } });
  if (!fund?.fundWalletPublicKey) return refuse('destination', 'fund has no wallet in the database');

  const check = checkSubscribeXdr(
    xdrB64,
    {
      source: key.publicKey,
      walletContractId: wallet,
      decisionHashHex: entry.hash,
      fundWallet: fund.fundWalletPublicKey,
      amountUnits: BigInt(p.amountUnits),
    },
    opts.networkPassphrase ?? blendConfig.passphrase
  );
  if (!check.ok) return refuse(check.field, check.reason);

  // Claim the signature atomically: one signature per execution attempt
  const claimed = await prisma.decisionExecution.updateMany({ where: { seq, status: 'PENDING' }, data: { status: 'SIGNED' } });
  if (claimed.count !== 1) return refuse('decision', 'decision was signed concurrently');

  const seed = openSeed(key, p.userId, key.publicKey, AGENT_KEY_ENCRYPTION_SECRET);
  try {
    const kp = Sdk.Keypair.fromRawEd25519Seed(seed);
    if (kp.publicKey() !== key.publicKey) throw new SignerRefusedError('source', 'stored key does not match its public key');
    check.tx.sign(kp);
    return check.tx.toEnvelope().toXDR('base64');
  } finally {
    seed.fill(0);
  }
}
