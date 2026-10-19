/**
 * Must be the FIRST import of every policy test file: sets the secrets before src/config/env.ts is evaluated and
 * refuses to run against anything but the disposable Postgres (docker container countersign-pg-test, port 55432).
 * dotenv never overrides variables that are already set, so apps/api/.env is not used for these.
 */
import crypto from 'crypto';

const url = process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1):55432\//.test(url)) {
  throw new Error('Policy tests only run against the disposable Postgres on localhost:55432 (set DATABASE_URL and DIRECT_URL)');
}
process.env.DIRECT_URL = url;
process.env.JWT_SECRET = 'test-' + crypto.randomBytes(16).toString('hex');
process.env.AGENT_KEY_ENCRYPTION_SECRET = crypto.randomBytes(32).toString('hex');
