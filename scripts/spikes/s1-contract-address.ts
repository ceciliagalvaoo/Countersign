// Spike S1 (build line 0.2): can a contract address (C...) be a FundToken shareholder and a vault payee?
// On testnet, with disposable identities and our OWN contract instances (demo instances are never touched):
//  1. deploy a fresh FundToken from the existing FUND_TOKEN_WASM_HASH
//  2. deploy a holder contract (C...): any contract address works, the token never calls into it
//  3. whitelist_add(C), mint(C, n), balance(C); same for a classic G holder for a mixed holder list
//  4. a disposable credit asset as payment token (stand-in for USDC), its Stellar Asset Contract,
//     a G to C SAC transfer (the deposit path of the mandate wallet)
//  5. deploy a fresh ReceivableVault (admin = disposable key), register fund, cedente, sacado, receivable,
//     pay it and distribute(receivable, [C, G]); check the C holder received its pro rata USDC
// Env: SPIKE_ADMIN_SECRET, SPIKE_HOLDER_SECRET, SPIKE_ISSUER_SECRET, FUND_TOKEN_WASM_HASH
import fs from 'fs';
import path from 'path';
import {
  Sdk, ROOT, env, server, records, invoke, sendOp, read, deployFromHash, decodeEvents, printRecords, jsonSafe,
  toAddr, toI128, toStr, toSym, toU64, expertContract, PASSPHRASE,
} from './lib.js';

const UNIT = 10_000_000n; // 7 decimals

async function main() {
  const admin = Sdk.Keypair.fromSecret(env('SPIKE_ADMIN_SECRET'));
  const gHolder = Sdk.Keypair.fromSecret(env('SPIKE_HOLDER_SECRET'));
  const issuer = Sdk.Keypair.fromSecret(env('SPIKE_ISSUER_SECRET'));
  const fundWasm = env('FUND_TOKEN_WASM_HASH');
  const A = admin.publicKey();
  const G = gHolder.publicKey();
  console.log(`admin ${A}\nG holder ${G}\nissuer ${issuer.publicKey()}`);

  // 1. Fresh FundToken
  const ft = await deployFromHash(admin, fundWasm, [toAddr(A), toStr('Spike Fund S1'), toStr('SPK1'), toI128(1_000_000n * UNIT)], 'deploy FundToken');
  console.log(`FundToken ${ft.id}`);

  // 2. Holder contract: a second FundToken instance, used only as an address that is a contract
  const holder = await deployFromHash(admin, fundWasm, [toAddr(A), toStr('Spike Holder'), toStr('HOLD'), toI128(1n)], 'deploy holder contract (C)');
  const C = holder.id;
  console.log(`holder contract C ${C} isValidContract=${Sdk.StrKey.isValidContract(C)}`);

  // 3. Whitelist and mint to C and to G
  const wlC = await invoke(admin, ft.id, 'whitelist_add', [toAddr(C)], 'whitelist_add(C)');
  await invoke(admin, ft.id, 'whitelist_add', [toAddr(G)], 'whitelist_add(G)');
  const mintC = await invoke(admin, ft.id, 'mint', [toAddr(C), toI128(60n * UNIT)], 'mint(C, 60)');
  await invoke(admin, ft.id, 'mint', [toAddr(G), toI128(40n * UNIT)], 'mint(G, 40)');
  const balC = await read(ft.id, 'balance', [toAddr(C)]);
  const wl = await read(ft.id, 'is_whitelisted', [toAddr(C)]);
  const supply = await read(ft.id, 'total_supply');
  console.log(`balance(C)=${balC} is_whitelisted(C)=${wl} total_supply=${supply}`);
  console.log(`  whitelist_add(C) events ${jsonSafe(decodeEvents(wlC.res))}`);
  console.log(`  mint(C) events ${jsonSafe(decodeEvents(mintC.res))}`);

  // Decode the confirmed mint the way services/soroban.ts getConfirmedCall does, to check the C address round-trips
  const env1 = new Sdk.Transaction(mintC.res.envelopeXdr, PASSPHRASE);
  const call = env1.operations[0].func.invokeContract();
  const decodedArgs = call.args().map((a: any) => Sdk.scValToNative(a));
  console.log(`  decoded mint args ${jsonSafe(decodedArgs)} (to === C: ${decodedArgs[0] === C})`);

  // 4. Payment asset: disposable credit asset + its SAC (stand-in for USDC: same SAC code path, credit asset with issuer)
  const asset = new Sdk.Asset('SPKUSD', issuer.publicKey());
  const sacId = asset.contractId(PASSPHRASE);
  await sendOp(admin, Sdk.Operation.changeTrust({ asset }), 'changeTrust admin SPKUSD');
  await sendOp(gHolder, Sdk.Operation.changeTrust({ asset }), 'changeTrust G holder SPKUSD');
  await sendOp(issuer, Sdk.Operation.payment({ destination: A, asset, amount: '1000' }), 'issue 1000 SPKUSD to admin');
  try {
    await sendOp(admin, Sdk.Operation.createStellarAssetContract({ asset }), 'deploy SAC SPKUSD');
  } catch (e) {
    console.log(`  SAC deploy: ${(e as Error).message} (continuing if it already exists)`);
  }
  console.log(`SAC ${sacId}`);
  // G to C transfer through the SAC (the deposit path of the mandate wallet): no trustline for C, no memo
  const g2c = await invoke(admin, sacId, 'transfer', [toAddr(A), toAddr(C), toI128(5n * UNIT)], 'SAC transfer G to C (5)');
  console.log(`  SAC transfer events ${jsonSafe(decodeEvents(g2c.res))}`);
  console.log(`  SAC balance(C) after deposit = ${await read(sacId, 'balance', [toAddr(C)])}`);

  // 5. Fresh vault
  const vaultWasmPath = path.join(ROOT, 'contracts/receivable-vault/target/wasm32v1-none/release/receivable_vault.wasm');
  const wasm = fs.readFileSync(vaultWasmPath);
  const vaultHash = Sdk.hash(wasm).toString('hex');
  try {
    await sendOp(admin, Sdk.Operation.uploadContractWasm({ wasm }), 'upload vault Wasm');
  } catch (e) {
    console.log(`  upload: ${(e as Error).message}`);
  }
  const vault = await deployFromHash(admin, vaultHash, [toAddr(A), toAddr(ft.id), toAddr(sacId)], 'deploy ReceivableVault');
  console.log(`vault ${vault.id} (wasm ${vaultHash})`);
  await invoke(admin, vault.id, 'admin_register_entity', [toSym('cedente'), toStr('CED-S1'), toStr('Spike Cedente')], 'register cedente');
  await invoke(admin, vault.id, 'admin_register_entity', [toSym('sacado'), toStr('SAC-S1'), toStr('Spike Sacado')], 'register sacado');
  await invoke(admin, vault.id, 'admin_register_fund', [toStr('FUND-S1'), toStr('Spike Fund S1'), toAddr(ft.id)], 'register fund');
  const due = BigInt(Math.floor(Date.now() / 1000) + 30 * 86400);
  await invoke(admin, vault.id, 'register_receivable',
    [toStr('RCV-S1'), toStr('FUND-S1'), toStr('CED-S1'), toStr('SAC-S1'), toI128(100n * UNIT), toU64(due), toAddr(A)], 'register_receivable');
  await invoke(admin, vault.id, 'pay', [toStr('RCV-S1'), toAddr(A), toI128(100n * UNIT)], 'pay(100)');

  const cBefore = BigInt(await read(sacId, 'balance', [toAddr(C)]));
  const holders = Sdk.nativeToScVal([Sdk.Address.fromString(C), Sdk.Address.fromString(G)]);
  const dist = await invoke(admin, vault.id, 'distribute', [toStr('RCV-S1'), holders], 'distribute(RCV-S1, [C, G])');
  const cAfter = BigInt(await read(sacId, 'balance', [toAddr(C)]));
  const gAfter = await read(sacId, 'balance', [toAddr(G)]);
  const status = await read(vault.id, 'get_receivable', [toStr('RCV-S1')]);
  console.log(`  distribute events ${jsonSafe(decodeEvents(dist.res))}`);
  console.log(`SAC balance(C): before ${cBefore}, after ${cAfter}, delta ${cAfter - cBefore} (expected ${60n * UNIT})`);
  console.log(`SAC balance(G) after ${gAfter} (expected ${40n * UNIT})`);
  console.log(`receivable status ${jsonSafe(status)}`);

  const pass = BigInt(balC) === 60n * UNIT && wl === true && cAfter - cBefore === 60n * UNIT && BigInt(gAfter) === 40n * UNIT;
  printRecords('S1');
  console.log(`\nContracts: FundToken ${expertContract(ft.id)}\n  holder C ${expertContract(C)}\n  SAC ${expertContract(sacId)}\n  vault ${expertContract(vault.id)}`);
  console.log(`\nS1 VERDICT: ${pass ? 'PASS' : 'FAIL'}`);
  if (!pass) process.exitCode = 1;
}

main().catch((e) => {
  console.error('S1 ERROR', e?.message ?? e);
  printRecords('S1 (partial)');
  process.exitCode = 1;
});
void server;
