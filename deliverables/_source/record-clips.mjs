// Records the video clips Claude can make on its own: the pitch animations (animations.html) and the public
// web pages (no login). Output: ../03-demo-video/clips/<id>.mp4 at 1920x1080. Needs playwright-core and ffmpeg.
// Usage: CHROME_PATH=... node record-clips.mjs [ids...]
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, readdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', '03-demo-video', 'clips');
const tmp = join(out, '_tmp');
mkdirSync(tmp, { recursive: true });
const only = process.argv.slice(2);
const size = { width: 1920, height: 1080 };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });

async function record(id, run) {
  if (only.length && !only.includes(id)) return;
  rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
  const ctx = await browser.newContext({ viewport: size, recordVideo: { dir: tmp, size } });
  const page = await ctx.newPage();
  const t0 = Date.now();
  const startAt = await run(page, () => (Date.now() - t0) / 1000);
  await ctx.close();
  const webm = readdirSync(tmp).find((f) => f.endsWith('.webm'));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(Math.max(0, startAt - 0.15)), '-i', join(tmp, webm), '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', join(out, `${id}.mp4`)]);
  console.log('clip', id);
}

// Pitch animations: each plays once and holds its last frame
const lab = pathToFileURL(join(here, 'animations.html')).href;
const ALL = ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'PV', 'P12', 'P15', 'P18a', 'P18b', 'P19', 'P21'];
const ids = process.argv.slice(2).length ? ALL.filter((x) => process.argv.slice(2).includes(x)) : ALL;
for (const id of ids) {
  await record(id, async (page, now) => {
    await page.goto(`${lab}?clip=${id}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    const at = now();
    const ms = await page.evaluate((x) => window.lab.play(x), id);
    await page.waitForTimeout(ms + 1000);
    return at;
  });
}

// Public pages, scrolled slowly
const slowScroll = async (page, px, ms) => {
  const steps = Math.round(ms / 40);
  for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, px / steps); await page.waitForTimeout(40); }
};
const tx = (h) => `https://stellar.expert/explorer/testnet/tx/${h}`;
const PURCHASE = process.env.PURCHASE_TX || 'ca28550282a909fc3d625dc3ef09825bd53a1be100d87f057b4b1d54a6b47bd1';
const zoom = (page, z) => page.evaluate((v) => { document.documentElement.style.zoom = String(v); }, z);
await record('W12', async (page, now) => {
  await page.goto(tx(PURCHASE), { waitUntil: 'networkidle' }); await zoom(page, 1.55); await page.waitForTimeout(1500);
  const at = now(); await page.waitForTimeout(3000); await slowScroll(page, 380, 2000); await page.waitForTimeout(3000); return at;
});
await record('W15', async (page, now) => {
  await page.goto(tx('cfff9ced3f87e3ce9ef712fa90a287bd77aad95ba6ea96b17214b328033a3b5c'), { waitUntil: 'networkidle' }); await zoom(page, 1.55); await page.waitForTimeout(1500);
  const at = now(); await page.waitForTimeout(3000); await slowScroll(page, 300, 1500); await page.waitForTimeout(2500); return at;
});
await record('W20', async (page, now) => {
  await page.goto('https://ceciliagalvaoo.github.io/Countersign/limitations', { waitUntil: 'networkidle' });
  // The literal list, items 1 to 14, legible, in two screens
  await zoom(page, 1.3);
  await page.evaluate(() => { const pre = document.querySelector('pre'); pre && pre.scrollIntoView({ block: 'start' }); });
  await page.waitForTimeout(1200);
  const at = now(); await page.waitForTimeout(8500);
  await page.evaluate(() => { const pre = document.querySelector('pre'); const li = [...pre.querySelectorAll('span, div')]; window.scrollBy(0, Math.round(pre.getBoundingClientRect().height * 0.5)); });
  await page.waitForTimeout(8500); return at;
});
await record('W01', async (page, now) => {
  await page.goto('https://countersign-web-rt1a.onrender.com/home', { waitUntil: 'networkidle' });
  const at = now(); await page.waitForTimeout(5000); return at;
});

rmSync(tmp, { recursive: true, force: true });
await browser.close();
