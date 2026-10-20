// Screenshots each slide (or page) of an HTML deliverable for review: node preview.mjs deck.html outdir [scale]
import { chromium } from 'playwright-core';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
const here = dirname(fileURLToPath(import.meta.url));
const [file, outdir, sel = '.slide', w = '1920'] = process.argv.slice(2);
mkdirSync(outdir, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const p = await b.newPage({ viewport: { width: Number(w), height: 1080 }, deviceScaleFactor: 0.5 });
await p.goto(pathToFileURL(join(here, file)).href, { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(500);
const n = await p.locator(sel).count();
for (let i = 0; i < n; i++) await p.locator(sel).nth(i).screenshot({ path: join(outdir, `${String(i + 1).padStart(2, '0')}.png`) });
console.log('shots', n); await b.close();
