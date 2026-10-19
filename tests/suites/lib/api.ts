// Shared helpers of the benign suite: a disposable API process on the suites database, plain HTTP calls, an RPC
// proxy that can cut the network, and signing of envelopes the API built. Same approach as adversarial/policy.ts
// (kept separate so the adversarial suite is not touched).
import { spawn, type ChildProcess } from 'child_process';
import { openSync } from 'fs';
import net from 'net';
import nodeHttp from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Sdk, PASSPHRASE, RPC_URL, submit, sleep, type Submitted } from './stellar.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const API_DIR = path.join(ROOT, 'apps/api');

export const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });

export interface Api {
  base: string;
  proc: ChildProcess;
  label: string;
}

/** Starts apps/api on a free port (never 3001) with the given env; dotenv does not override variables set here */
export async function startApi(label: string, env: Record<string, string>, logDir: string): Promise<Api> {
  const port = await freePort();
  const out = openSync(path.join(logDir, `api-${label}.log`), 'w');
  const childEnv: Record<string, string | undefined> = { ...process.env, ...env, PORT: String(port), CORS_ORIGIN: '*', NODE_OPTIONS: '--dns-result-order=ipv4first' };
  // The API never needs the Anthropic key (loaded into this process by apps/agent's config)
  delete childEnv.ANTHROPIC_API_KEY;
  delete childEnv.API_BASE_URL;
  const proc = spawn(path.join(API_DIR, 'node_modules/.bin/tsx'), ['src/index.ts'], { cwd: API_DIR, env: childEnv as NodeJS.ProcessEnv, stdio: ['ignore', out, out] });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 300; i++) {
    if (proc.exitCode !== null) throw new Error(`API ${label} exited with code ${proc.exitCode} (see evidence/private/api-${label}.log)`);
    try {
      await fetch(`${base}/health`);
      return { base, proc, label };
    } catch {
      await sleep(1000);
    }
  }
  proc.kill();
  throw new Error(`API ${label} did not answer on ${base}`);
}

export async function stopApi(api: Api | null) {
  if (!api || api.proc.exitCode !== null) return;
  api.proc.kill('SIGTERM');
  await Promise.race([new Promise((r) => api.proc.once('exit', r)), sleep(5000)]);
}

/** node:http (no 300 s fetch limit) */
export function http(api: Api | string, method: string, url: string, token?: string, body?: unknown): Promise<{ status: number; json: any }> {
  const base = typeof api === 'string' ? api : api.base;
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const payload = body === undefined ? undefined : JSON.stringify(body);
  if (payload !== undefined) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(Buffer.byteLength(payload));
  }
  return new Promise((resolve, reject) => {
    const req = nodeHttp.request(`${base}${url}`, { method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json: any;
        try {
          json = JSON.parse(text);
        } catch {
          json = { raw: text.slice(0, 300) };
        }
        resolve({ status: res.statusCode ?? 0, json });
      });
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

export const must = (r: { status: number; json: any }, status: number, what: string) => {
  if (r.status !== status) throw new Error(`${what}: expected HTTP ${status}, got ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json;
};

/** Signs an envelope the API built and submits it; throws unless SUCCESS */
export async function signAndSubmit(xdrB64: string, kp: Sdk.Keypair, label: string): Promise<Submitted> {
  const tx: any = Sdk.TransactionBuilder.fromXDR(xdrB64, PASSPHRASE);
  tx.sign(kp);
  const out = await submit(tx, label);
  if (out.status !== 'SUCCESS') throw new Error(`${label} FAILED on-chain: ${out.hash}`);
  return out;
}

/** Local JSON-RPC proxy: "up" forwards, "cut-after-send" drops everything after a sendTransaction, "down" drops all */
export async function startRpcProxy() {
  let mode: 'up' | 'cut-after-send' | 'down' = 'up';
  const srv = nodeHttp.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', async () => {
      if (mode === 'down') return req.socket.destroy();
      const body = Buffer.concat(chunks);
      let rpcMethod = '';
      try {
        rpcMethod = JSON.parse(body.toString('utf8')).method ?? '';
      } catch {
        /* not JSON-RPC */
      }
      try {
        const up = await fetch(RPC_URL + (req.url && req.url !== '/' ? req.url : ''), {
          method: req.method,
          headers: { 'content-type': req.headers['content-type'] ?? 'application/json' },
          body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
        });
        const text = Buffer.from(await up.arrayBuffer());
        res.writeHead(up.status, { 'content-type': up.headers.get('content-type') ?? 'application/json' });
        res.end(text);
      } catch {
        req.socket.destroy();
      }
      if (mode === 'cut-after-send' && rpcMethod === 'sendTransaction') mode = 'down';
    });
  });
  const port = await new Promise<number>((resolve) => srv.listen(0, '127.0.0.1', () => resolve((srv.address() as net.AddressInfo).port)));
  return {
    url: `http://127.0.0.1:${port}`,
    setMode: (m: typeof mode) => (mode = m),
    getMode: () => mode,
    close: () => new Promise((r) => srv.close(r)),
  };
}
