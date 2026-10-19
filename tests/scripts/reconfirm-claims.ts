// One-off (19/10): calls POST /api/badges/:userId/zk-claim/confirm again for the ZK badge claims already confirmed in
// the disposable suites database, so they get the decision-log line the policy-guard added (idempotent by hash).
// Disposable database only (localhost:55432/countersign_suites). The suite users' passwords were random and not kept,
// so each owner gets a new random password in that database, used once to log in. Nothing is printed but the result.
import crypto from 'crypto';
import { createRequire } from 'module';
import path from 'path';
import { ROOT, API_DIR, startApi, stopApi, http, must } from '../suites/lib/api.js';

const requireFromApi = createRequire(path.join(API_DIR, 'package.json'));
const HASHES = process.argv.slice(2).map((h) => h.toLowerCase()).filter((h) => /^[0-9a-f]{64}$/.test(h));

async function main() {
  const url = process.env.SUITES_DATABASE_URL ?? '';
  if (!/@(localhost|127\.0\.0\.1):55432\/countersign_suites(\?|$)/.test(url)) throw new Error('SUITES_DATABASE_URL must be the disposable countersign_suites');
  const { PrismaClient } = requireFromApi('@prisma/client');
  const bcrypt = requireFromApi('bcryptjs');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const api = await startApi('reconfirm-claims', { DATABASE_URL: url, DIRECT_URL: url, JWT_SECRET: 'suite-' + crypto.randomBytes(24).toString('hex'), AGENT_KEY_ENCRYPTION_SECRET: crypto.randomBytes(32).toString('hex') }, path.join(ROOT, 'evidence/private'));
  try {
    for (const h of HASHES) {
      const user = await prisma.user.findFirst({ where: { badgeClaimTxHash: h } });
      if (!user) {
        console.log(`${h}: no user with this claim`);
        continue;
      }
      const password = crypto.randomBytes(18).toString('hex');
      await prisma.user.update({ where: { id: user.id }, data: { password: await bcrypt.hash(password, 10) } });
      const token = must(await http(api, 'POST', '/api/auth/login', undefined, { email: user.email, password }), 200, 'login').token;
      const r = await http(api, 'POST', `/api/badges/${user.id}/zk-claim/confirm`, token, { txHash: h });
      const row = await prisma.decisionLog.findFirst({ where: { payload: { contains: `"txHash":"${h}"` } }, select: { seq: true, payload: true } });
      console.log(`${h}: confirm ${r.status} ${r.json?.tier ?? r.json?.error ?? ''}; log row ${row ? `${row.seq} ${JSON.parse(row.payload).rule}` : 'none'}`);
    }
  } finally {
    await stopApi(api);
    await prisma.$disconnect();
  }
}
main().catch((e) => {
  console.error(`reconfirm-claims: ${(e as Error).message}`);
  process.exit(1);
});
