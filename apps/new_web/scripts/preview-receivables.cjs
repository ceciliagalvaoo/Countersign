// Local visual regression with a fresh headless Chrome profile and a mocked API.
// All non-Vite requests are intercepted. No database, wallet signatures, or chain calls.
// Start Vite, then: node apps/new_web/scripts/preview-receivables.cjs
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const base = process.env.UI_PREVIEW_URL || 'http://localhost:5173';
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'receivable-ui-'));
const output = path.resolve(__dirname, '../node_modules/.tmp/receivables-ui');
fs.mkdirSync(output, { recursive: true });
const a = 'GCMBNCBWY3BONBVVI6N2KZ2GXOR6YH7RZVOBUYPASGX665DLOUXCVH4R';
const b = 'GCKZRX3QF3CK22RPEAAJFURYVPW3BSZORQKLZDWFSYIO2JE76IZUOOVY';
const item = { id: 'previewreceivable', fundId: 'fund', sacadoId: 'debtor', cedenteId: 'assignor',
  faceValue: 10, dueDate: '2027-01-17T00:00:00.000Z', createdAt: '2026-10-19T00:00:00.000Z',
  paidValue: null, paidAt: null, status: 'PENDING', chainStatus: 'NOT_REGISTERED',
  fund: { name: 'Agri Receivables Demo Fund', symbol: 'CSAGRI' },
  cedente: { name: 'Simulated Grain Cooperative' }, sacado: { name: 'Simulated Food Processor A' } };
const progress = { chainStatus: 'NOT_REGISTERED', steps: ['fund', 'cedente', 'sacado', 'register', 'pay', 'distribute'].map((stepId, index) => ({
  stepId, label: ['Register fund', 'Register assignor', 'Register debtor', 'Register receivable', 'Pay receivable', 'Distribute payment'][index],
  entity: { id: stepId === 'register' ? item.id : stepId, name: [item.fund.name, item.cedente.name, item.sacado.name, item.id][index] || item.id, kind: index > 2 ? 'receivable' : stepId },
  state: index < 3 ? 'CONFIRMED' : index === 3 ? 'PENDING_SIGNATURES' : 'NOT_STARTED',
  txHash: index < 3 ? String(index + 1).repeat(64) : undefined,
  multisig: index < 4 ? { id: 'request' + index, signers: [{ key: a, weight: 1 }, { key: b, weight: 1 }],
    signedBy: index < 3 ? [a, b] : [b], weight: index < 3 ? 2 : 1, threshold: 2, expiresAt: '2027-01-01T12:00:00.000Z' } : undefined,
})) };
const mutations = [], exceptions = [];
let failNextSave = true;
let browser, socket, send;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions',
    '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  browser.on('error', error => { throw error; });
  const activePort = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; !fs.existsSync(activePort) && i < 100; i++) await delay(100);
  const port = fs.readFileSync(activePort, 'utf8').split('\n')[0];
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let seq = 0; const pending = new Map();
  send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('Chrome command timed out: ' + method)); }, 15000);
    pending.set(id, { resolve, reject, timeout }); socket.send(JSON.stringify({ id, method, params }));
  });
  socket.onclose = () => { for (const call of pending.values()) { clearTimeout(call.timeout); call.reject(new Error('Chrome connection closed')); } pending.clear(); };
  const fulfill = (requestId, value, responseCode = 200) => send('Fetch.fulfillRequest', { requestId, responseCode,
    responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' },
      { name: 'Access-Control-Allow-Headers', value: 'authorization,content-type,ngrok-skip-browser-warning' },
      { name: 'Access-Control-Allow-Methods', value: 'GET,POST,PATCH,OPTIONS' }],
    body: Buffer.from(JSON.stringify(value)).toString('base64') });
  socket.onmessage = async event => {
    const msg = JSON.parse(event.data);
    if (msg.id) { const call = pending.get(msg.id); pending.delete(msg.id); if (call) clearTimeout(call.timeout); if (msg.error) call?.reject(new Error(JSON.stringify(msg.error))); else call?.resolve(msg.result); return; }
    if (msg.method === 'Runtime.exceptionThrown') exceptions.push(msg.params.exceptionDetails.text);
    if (msg.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = msg.params;
    try {
      const url = new URL(request.url);
      // API interception takes precedence even if Vite proxies /api on its own origin.
      if (url.pathname.startsWith('/api/')) {
        let value = {};
        if (request.method !== 'OPTIONS' && !['GET', 'HEAD'].includes(request.method)) {
          mutations.push({ method: request.method, path: url.pathname });
          assert.equal(request.method, 'PATCH'); assert.equal(url.pathname, '/api/receivables/' + item.id + '/mark-paid');
          if (failNextSave) { failNextSave = false; await fulfill(requestId, { error: 'Preview save failed' }, 502); return; }
          const body = JSON.parse(request.postData); item.paidValue = body.paidValue; item.paidAt = new Date().toISOString();
          value = { receivable: item };
        } else if (url.pathname === '/api/auth/me') value = { user: { id: 'preview', email: 'preview@example.invalid', role: 'GESTOR', status: 'APPROVED' } };
        else if (url.pathname === '/api/receivables') value = { receivables: [item] };
        else if (url.pathname === '/api/receivables/' + item.id) value = { receivable: item };
        else if (url.pathname === '/api/receivables/' + item.id + '/chain') value = progress;
        else if (url.pathname === '/api/funds') value = { funds: [{ id: 'fund', name: item.fund.name, status: 'APPROVED' }] };
        else if (url.pathname === '/api/cedentes') value = { cedentes: [] };
        else if (url.pathname === '/api/sacados') value = { sacados: [] };
        await fulfill(requestId, value); return;
      }
      if (url.origin === new URL(base).origin) await send('Fetch.continueRequest', { requestId });
      else await fulfill(requestId, {}); // Never allow external wallet or Stellar requests.
    } catch (error) { exceptions.push(error.message); await send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }); }
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('authToken','offline-preview'); localStorage.setItem('stellarPublicKey'," + JSON.stringify(b) + ');' });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async expression => { for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await delay(200); } throw new Error('Timed out: ' + expression); };
  const screenshot = async name => {
    const value = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(value.data, 'base64'));
  };
  await send('Page.navigate', { url: base + '/receivables' });
  await waitFor("document.body.innerText.includes('View details')");
  assert.equal(await evaluate("document.querySelectorAll('tbody tr').length"), 1);
  assert.ok(await evaluate("document.querySelector('tbody tr').getBoundingClientRect().height < 140"));
  assert.ok(!(await evaluate("document.querySelector('tbody').innerText.includes('Request ID')")));
  await screenshot('list-desktop');
  await evaluate("document.querySelector('a[href=\"/receivables/previewreceivable\"]').click()");
  await waitFor("document.body.innerText.includes('Stellar activity') && document.body.innerText.includes('Weight 1 / 2')");
  assert.equal(await evaluate("document.querySelectorAll('ol > li').length"), 4);
  assert.ok(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"));
  await screenshot('detail-desktop');
  await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.innerText==='Record payment').click()");
  await waitFor("!!document.querySelector('[role=dialog]')");
  assert.ok(await evaluate("document.activeElement === document.querySelector('[role=dialog] input')"));
  await screenshot('payment-desktop');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await waitFor("!document.querySelector('[role=dialog]')");
  assert.equal(mutations.length, 0, 'opening and cancelling the modal cannot record a payment');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.reload');
  await delay(300);
  await waitFor("document.body.innerText.includes('Stellar activity')");
  await delay(400); // allow responsive sidebar transitions to settle
  await screenshot('detail-mobile');
  assert.ok(await evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"), 'detail page must not overflow mobile viewport');
  await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.innerText==='Record payment').click()");
  await waitFor("!!document.querySelector('[role=dialog]')");
  await screenshot('payment-mobile');
  await evaluate("(() => {const i=document.querySelector('[role=dialog] input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'0'); i.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('[role=dialog] form').requestSubmit();})()");
  assert.equal(mutations.length, 0, 'invalid payment cannot reach the API');
  // Only the fixture handles this valid submit. The real API is never called.
  await evaluate("(() => {const i=document.querySelector('[role=dialog] input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'10.5'); i.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await delay(50);
  await evaluate("document.querySelector('[role=dialog] form').requestSubmit()");
  await waitFor("document.querySelector('[role=dialog] [role=alert]')?.innerText.includes('Preview save failed')");
  assert.equal(item.paidValue, null, 'failed save does not update payment or close the dialog');
  assert.ok(await evaluate("!!document.querySelector('[role=dialog]')"));
  await evaluate("document.querySelector('[role=dialog] form').requestSubmit()");
  await waitFor("!document.querySelector('[role=dialog]')");
  assert.equal(mutations.length, 2); assert.equal(item.paidValue, 10.5);
  item.status = 'DISTRIBUTED'; item.chainStatus = 'DISTRIBUTED'; progress.chainStatus = 'DISTRIBUTED';
  for (const step of progress.steps) { step.state = 'CONFIRMED'; step.txHash ||= 'a'.repeat(64); }
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.reload'); await delay(300);
  await waitFor("document.body.innerText.includes('Distribution complete')");
  assert.ok(!(await evaluate("[...document.querySelectorAll('button')].some(b=>b.innerText==='Record payment' || b.innerText==='Record on Stellar')")));
  await screenshot('detail-completed-desktop');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: base + '/receivables' }); await delay(300);
  await waitFor("document.body.innerText.includes('View details')");
  assert.ok(await evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"), 'list must not overflow mobile viewport');
  await screenshot('list-mobile');
  assert.deepEqual(exceptions, []);
  console.log('PASS: compact list, direct detail reload, completed state, desktop/mobile layout, accessible payment dialog, cancel, invalid amount, failed save and one successful mocked save.');
  console.log('Screenshots:', output);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  socket?.close(); browser?.kill();
  await delay(400);
  // Only remove the newly created, verified temporary Chrome profile.
  if (path.dirname(path.resolve(profile)) === path.resolve(os.tmpdir()) && path.basename(profile).startsWith('receivable-ui-')) {
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { /* Chrome may still hold its temporary profile */ }
  }
});
