// Bundles the card test with esbuild (already a Vite dependency) and runs it with Node.
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

mkdirSync('node_modules/.tmp', { recursive: true });
const outfile = 'node_modules/.tmp/approvalCard.test.mjs';
await build({
  entryPoints: ['src/__tests__/approvalCard.test.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  packages: 'external',
  logLevel: 'error',
});
const r = spawnSync(process.execPath, [outfile], { stdio: 'inherit' });
process.exit(r.status ?? 1);
