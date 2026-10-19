// Full /agent page regression in a fresh headless browser. All API/agent calls
// are fixtures; any purchase, mint, payment, chat or execution request is blocked.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const base = process.env.UI_PREVIEW_URL || 'http://localhost:5173';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-status-ui-'));
const output = path.resolve(__dirname, '../node_modules/.tmp/agent-status-ui'); fs.mkdirSync(output, { recursive: true });
const pay = 'a'.repeat(64), mint = 'b'.repeat(64), decision = 'c'.repeat(64);
const wallet = 'CCFFFHL3FPHZSNVQHIA5OFQY5PTNUA7X4X6CVSVQKTP72WNPCNZKGZYG';
const fund = { id: 'fund', name: 'Agri Receivables Demo Fund', symbol: 'CSAGRI' };
const history = 'Payment confirmed. The issuer still needs to countersign.';
const ids = ['profile', 'perimeter', 'eligibility', 'screening', 'proposal', 'investor_signature', 'agent_purchase', 'issuer_countersign', 'confirmed'];
const session = { sessionId: 'preview_session', turns: 1, updatedAt: '2026-10-18T15:00:00Z',
  mandateDraft: {}, missingFields: [], pendingAction: null, lastToolCalls: [], interrupted: false,
  transcript: [{ role: 'agent', text: history, turn: 1, at: '2026-10-18T15:00:00Z' }],
  plan: { focusFundId: 'fund', purchaseRef: { decisionSeq: 5 }, interrupted: false,
    nodes: ids.map(id => ({ id, label: ({ agent_purchase: 'Agent purchase', issuer_countersign: 'Issuer countersign', confirmed: 'Confirmed' })[id] || id,
      state: id === 'issuer_countersign' ? 'active' : id === 'confirmed' ? 'pending' : 'done', rule: null, detail: null })) } };
const originalSession = JSON.stringify(session);
let mode = 'awaiting', logUnavailable = false, purchaseReads = 0;
const exceptions = [], forbidden = [];
let browser, socket, send;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  browser = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--disable-extensions', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });
  const file = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; !fs.existsSync(file) && i < 100; i++) await delay(100);
  const port = fs.readFileSync(file, 'utf8').split('\n')[0];
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const pending = new Map(); let seq = 0;
  send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq, timeout = setTimeout(() => { pending.delete(id); reject(new Error('Chrome timeout: ' + method)); }, 15000);
    pending.set(id, { resolve, reject, timeout }); socket.send(JSON.stringify({ id, method, params }));
  });
  socket.onclose = () => { for (const c of pending.values()) { clearTimeout(c.timeout); c.reject(new Error('Chrome closed')); } pending.clear(); };
  const fulfill = (id, value, code = 200) => send('Fetch.fulfillRequest', { requestId: id, responseCode: code,
    responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' },
      { name: 'Access-Control-Allow-Headers', value: 'authorization,content-type,ngrok-skip-browser-warning' }, { name: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' }],
    body: Buffer.from(JSON.stringify(value)).toString('base64') });
  socket.onmessage = async event => {
    const m = JSON.parse(event.data);
    if (m.id) { const c = pending.get(m.id); pending.delete(m.id); if (c) clearTimeout(c.timeout); if (m.error) c?.reject(new Error(JSON.stringify(m.error))); else c?.resolve(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.text);
    if (m.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = m.params;
    try {
      const url = new URL(request.url), route = url.pathname;
      if (route.startsWith('/api/') || route.startsWith('/session/')) {
        if (request.method === 'OPTIONS') { await fulfill(requestId, {}); return; }
        if (request.method !== 'GET' && route !== '/api/agent/session-token') { forbidden.push(route); await fulfill(requestId, { error: 'Forbidden in fixture' }, 500); return; }
        let value = {};
        if (route === '/api/auth/me') value = { user: { id: 'previewInvestor', email: 'preview@example.invalid', role: 'INVESTIDOR', status: 'APPROVED' } };
        else if (route === '/api/agent/session-token') value = { token: 'fixture-agent-token', expiresIn: 3600, userId: 'previewInvestor' };
        else if (route.startsWith('/session/')) value = session;
        else if (route === '/api/mandates') value = { draft: {}, approved: null, active: false, missing: [], complete: false };
        else if (route === '/api/mandate-wallet') value = { wallet: { contractId: wallet, usdcBalanceUnits: '250000000', funds: [], revoked: false } };
        else if (route === '/api/mandate-wallet/purchases') {
          purchaseReads++;
          if (mode === 'unavailable') { await fulfill(requestId, { error: 'Fixture API unavailable' }, 502); return; }
          value = { network: 'Stellar testnet', inFlight: [], purchases: [{ orderId: 'order5', decisionSeq: 5, decision, fund,
            status: mode === 'completed' ? 'COUNTERSIGNED' : mode === 'failed' ? 'FAILED' : mode === 'pending' ? 'PENDING_NETWORK' : 'CONFIRMED_AWAITING_ISSUER',
            subscribeTxHash: pay, mintTxHash: ['completed', 'pending'].includes(mode) ? mint : null, refundTxHash: null,
            payer: wallet, amountUsdc: '5', units: '5', createdAt: '2026-10-18T15:00:00Z', updatedAt: '2026-10-19T08:00:00Z' }] };
        } else if (route === '/api/decision-log') {
          if (logUnavailable) { await fulfill(requestId, { error: 'Fixture log unavailable' }, 502); return; }
          value = { entries: [] };
        } else if (route === '/api/decision-log/verify') value = { ok: true, checked: 0 };
        else if (route.startsWith('/api/funds/')) value = { fund };
        await fulfill(requestId, value); return;
      }
      if (url.origin === new URL(base).origin) await send('Fetch.continueRequest', { requestId });
      else await fulfill(requestId, {}); // Never allow network/wallet requests outside fixture.
    } catch (error) { exceptions.push(error.message); await send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }); }
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('authToken','fixture'); localStorage.setItem('countersign.agentSession.previewInvestor','preview_session');" });
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
  const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; };
  const waitFor = async expression => { for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await delay(200); } throw new Error('Timed out: ' + expression); };
  const node = id => `document.querySelector('[aria-label="Plan"] [data-node="${id}"]')?.dataset.state`;
  const card = state => `!!document.querySelector('[aria-label="Latest purchase"] [data-tx-state="${state}"]')`;
  const refresh = async () => evaluate("[...document.querySelector('[aria-label=Plan]').querySelectorAll('button')].find(b=>b.innerText==='Refresh status').click()");
  await send('Page.navigate', { url: base + '/agent' });
  await waitFor(node('issuer_countersign') + "==='active' && " + card('awaiting_issuer'));
  assert.equal(await evaluate(node('confirmed')), 'pending');
  mode = 'completed'; logUnavailable = true; // A failing log must not block current order refresh.
  await waitFor(node('confirmed') + "==='done' && " + card('completed')); // polling, without another chat turn
  assert.ok(purchaseReads >= 2);
  assert.equal(await evaluate(node('issuer_countersign')), 'done');
  assert.ok(await evaluate("document.querySelector('[aria-label=Chat]').innerText.includes(" + JSON.stringify(history) + ')'));
  assert.equal(JSON.stringify(session), originalSession);
  logUnavailable = false;
  await send('Page.reload'); await delay(300);
  await waitFor(node('confirmed') + "==='done' && " + card('completed'));
  const picture = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(output, 'agent-completed.png'), Buffer.from(picture.data, 'base64'));
  mode = 'unavailable'; await refresh();
  await waitFor("document.querySelector('[aria-label=Plan]').innerText.includes('could not be refreshed')");
  assert.ok(await evaluate("document.querySelector('[aria-label=\"Latest purchase\"]').innerText.includes('could not be refreshed')"));
  mode = 'pending'; await refresh();
  await waitFor(node('agent_purchase') + "==='active' && " + card('pending'));
  assert.equal(await evaluate(node('confirmed')), 'pending', 'a mint hash with pending status is not completion');
  mode = 'failed'; await refresh();
  await waitFor(node('agent_purchase') + "==='refused' && " + card('failed'));
  assert.equal(await evaluate(node('confirmed')), 'pending');
  assert.deepEqual(forbidden, []); assert.deepEqual(exceptions, []);
  console.log('PASS: full /agent page pending issuer, later mint via polling despite log failure, final state after reload, refresh failure and no false success from pending/failed payment. Only fixture authentication POSTs; no operations executed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  socket?.close(); browser?.kill(); await delay(400);
  if (path.dirname(path.resolve(profile)) === path.resolve(os.tmpdir()) && path.basename(profile).startsWith('agent-status-ui-')) {
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { /* temporary profile still closing */ }
  }
});
