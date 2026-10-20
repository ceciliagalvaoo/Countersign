// Renders the deliverables: figures to PNG, documents and deck to PDF.
// Usage: node render.mjs [figures|docs|deck|all]   (needs playwright-core and a Chromium; set CHROME_PATH)
import { chromium } from 'playwright-core';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..');
const what = process.argv[2] || 'all';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const url = (f) => pathToFileURL(join(here, f)).href;

if (what === 'figures' || what === 'all') {
  const page = await browser.newPage({ viewport: { width: 1700, height: 1200 }, deviceScaleFactor: 2 });
  await page.goto(url('figures.html'), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  for (const id of await page.evaluate(() => window.FIG_IDS)) {
    await page.locator('#' + id + ' svg').screenshot({ path: join(out, 'figures', id + '.png') });
    console.log('figure', id);
  }
  await page.close();
}
const pdf = async (src, dest, opts) => {
  const page = await browser.newPage();
  await page.goto(url(src), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.pdf({ path: join(out, dest), printBackground: true, ...opts });
  console.log('pdf', dest);
  await page.close();
};
if (what === 'docs' || what === 'all') {
  await pdf('technical-document.html', '01-technical-document/Countersign-Technical-Document.pdf', { format: 'A4' });
  await pdf('security-self-assessment.html', '05-security-self-assessment/Countersign-Security-Self-Assessment.pdf', { format: 'A4' });
  await pdf('execution-evidence.html', '06-execution-evidence/Countersign-Execution-Evidence.pdf', { format: 'A4' });
}
if (what === 'deck' || what === 'all') {
  await pdf('deck.html', '02-presentation-deck/Countersign-Presentation-Deck.pdf', { width: '1920px', height: '1080px' });
}
await browser.close();
