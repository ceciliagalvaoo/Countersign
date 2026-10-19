// Offline tests with TypeScript transpiled in memory; no esbuild, DB or keystore.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
process.env.JWT_SECRET = 'agent-status-offline-only';
process.env.AGENT_KEY_ENCRYPTION_SECRET = '0'.repeat(64);
process.env.DOTENV_CONFIG_PATH = path.join(__dirname, '.no-test-env');
globalThis.fetch = async () => { throw new Error('Network disabled in agent status tests'); };
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) {
  if (name.startsWith('.') && name.endsWith('.js') && parent?.filename) {
    for (const ext of ['.ts', '.tsx']) {
      const source = path.resolve(path.dirname(parent.filename), name.slice(0, -3) + ext);
      if (fs.existsSync(source)) return source;
    }
  }
  return resolve.call(this, name, parent, ...rest);
};
const compile = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, file);
require.extensions['.ts'] = compile; require.extensions['.tsx'] = compile;
require('../src/__tests__/agentPurchaseStatus.test.ts');
