import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name} (see apps/api/.env.example)`);
  }
  return value;
}

export const JWT_SECRET = required('JWT_SECRET');

// Encrypts the agent signing keys at rest (AES-256-GCM, see src/agentSigner). 32 bytes as 64 hex characters.
// Required: the API does not start without it, like JWT_SECRET.
export const AGENT_KEY_ENCRYPTION_SECRET = (() => {
  const value = required('AGENT_KEY_ENCRYPTION_SECRET');
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error('AGENT_KEY_ENCRYPTION_SECRET must be 32 bytes as 64 hex characters (see apps/api/.env.example)');
  }
  return value;
})();

export const PORT = Number(process.env.PORT) || 3001;

// Comma-separated list of allowed origins, or "*" to allow any origin
export const CORS_ORIGIN = (process.env.CORS_ORIGIN || '*')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
