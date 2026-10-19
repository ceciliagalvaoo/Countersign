// Transpile in memory with the installed TypeScript; works with Windows or WSL.
// No database, dotenv secrets, native esbuild, generated files, or network.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
process.env.JWT_SECRET = 'receivable-offline-test-only';
process.env.AGENT_KEY_ENCRYPTION_SECRET = '0'.repeat(64);
process.env.DOTENV_CONFIG_PATH = path.join(__dirname, '.no-test-env');
process.env.RECEIVABLE_VAULT_CONTRACT_ID = 'CDZCBEGYZKYP3MH6SHF3FOE4HUTQFX52KPVAYH5YBCOWB2ECS5PHJSMK';
globalThis.fetch = async () => { throw new Error('Network disabled in receivable tests'); };
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) {
  if (name.startsWith('.') && name.endsWith('.js') && parent?.filename) {
    const tsFile = path.resolve(path.dirname(parent.filename), name.slice(0, -3) + '.ts');
    if (fs.existsSync(tsFile)) return tsFile;
  }
  return resolve.call(this, name, parent, ...rest);
};
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
require('../src/services/__tests__/receivableFlow.test.ts');
