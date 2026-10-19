import crypto from 'crypto';

/**
 * Encryption at rest of the agent signing seeds: AES-256-GCM with a 12 byte random IV and a 16 byte tag.
 * Key = HKDF-SHA256(AGENT_KEY_ENCRYPTION_SECRET (32 bytes), salt "countersign-agent-key", info "aes-256-gcm v1").
 * Additional authenticated data binds each ciphertext to its row ("agent-key:<userId>:<publicKey>"), so a
 * ciphertext copied to another investor's row does not decrypt.
 * Nothing here logs; plaintext buffers are zeroed by the caller after use.
 */

const SALT = Buffer.from('countersign-agent-key');
const INFO = Buffer.from('aes-256-gcm v1');

function deriveKey(secretHex: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(secretHex)) throw new Error('AGENT_KEY_ENCRYPTION_SECRET must be 64 hex characters');
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secretHex, 'hex'), SALT, INFO, 32));
}

const aad = (userId: string, publicKey: string) => Buffer.from(`agent-key:${userId}:${publicKey}`);

export interface SealedSeed {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export function sealSeed(seed: Buffer, userId: string, publicKey: string, secretHex: string): SealedSeed {
  const key = deriveKey(secretHex);
  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad(userId, publicKey));
    const ciphertext = Buffer.concat([cipher.update(seed), cipher.final()]);
    return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64') };
  } finally {
    key.fill(0);
  }
}

/** Returns the raw 32 byte seed; the caller must zero it after use */
export function openSeed(sealed: SealedSeed, userId: string, publicKey: string, secretHex: string): Buffer {
  const key = deriveKey(secretHex);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
    decipher.setAAD(aad(userId, publicKey));
    decipher.setAuthTag(Buffer.from(sealed.authTag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, 'base64')), decipher.final()]);
  } finally {
    key.fill(0);
  }
}
