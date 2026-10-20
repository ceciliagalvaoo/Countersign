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
// Only a page number, centred at the foot; the margin boxes are painted cream so the page bleeds edge to edge
const foot = (size) => `<style>html,body{margin:0!important;padding:0!important}#header,#footer{padding:0!important;margin:0!important}</style><div style="width:100%;height:calc(100% + 2px);margin:-1px 0 0 0;background:#F4F0E5;-webkit-print-color-adjust:exact;display:flex;align-items:flex-end;justify-content:center;padding-bottom:${size === 'deck' ? '34px' : '7mm'};font-family:'IBM Plex Mono',monospace;font-size:${size === 'deck' ? '15px' : '8px'};color:#5A679E"><span class="pageNumber"></span></div>`;
const head = `<style>html,body{margin:0!important;padding:0!important}#header,#footer{padding:0!important;margin:0!important}</style><div style="width:100%;height:calc(100% + 2px);margin:-1px 0 0 0;background:#F4F0E5;-webkit-print-color-adjust:exact"></div>`;
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
  const a4 = { format: 'A4', preferCSSPageSize: true };   // margins, cream page and page number come from the documents' own @page rule
  await pdf('technical-document.html', '01-technical-document/Countersign-Technical-Document.pdf', a4);
  await pdf('security-self-assessment.html', '05-security-self-assessment/Countersign-Security-Self-Assessment.pdf', a4);
  await pdf('execution-evidence.html', '06-execution-evidence/Countersign-Execution-Evidence.pdf', a4);
}
if (what === 'deck' || what === 'all') {
  await pdf('deck.html', '02-presentation-deck/Countersign-Presentation-Deck.pdf', { width: '1920px', height: '1080px' });
}
await browser.close();
