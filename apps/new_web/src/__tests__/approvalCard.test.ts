/**
 * Build line 1.7: "changing one byte of the XDR changes the card".
 *
 *   npm run test:card                     offline: the browser decoder stands in for the API decoder
 *   COUNTERSIGN_API_URL=http://localhost:3001/api COUNTERSIGN_JWT=<investor JWT> npm run test:card
 *                                         also runs the same check through POST /api/tx/decode
 *
 * The keypair below is generated in memory for this run only; it never signs anything.
 */
import assert from 'node:assert/strict';
import * as StellarSdk from '@stellar/stellar-sdk';
import { buildCardModel, type CardContext } from '../components/approvalCardModel';
import { decodeLocally, localToDecodedCall, checkConsistency } from '../utils/localDecode';
import { toDecodedCall } from '../types/decodedCall';

const owner = StellarSdk.Keypair.random().publicKey();
const fundWallet = StellarSdk.Keypair.random().publicKey();
const walletId = StellarSdk.StrKey.encodeContract(new Uint8Array(32).fill(7));
const fundToken = StellarSdk.StrKey.encodeContract(new Uint8Array(32).fill(9));
const CAP = 50_000_000_000n; // 5,000 USDC in 7 decimal units

const tx = new StellarSdk.TransactionBuilder(new StellarSdk.Account(owner, '1'), { fee: '100', networkPassphrase: StellarSdk.Networks.TESTNET })
  .addOperation(
    new StellarSdk.Contract(walletId).call(
      'allow_fund',
      StellarSdk.nativeToScVal(fundWallet, { type: 'address' }),
      StellarSdk.nativeToScVal(fundToken, { type: 'address' }),
      StellarSdk.nativeToScVal(CAP, { type: 'i128' }),
    ),
  )
  .setTimeout(300)
  .build();
const xdr = tx.toXDR();
const ARG_NAMES = ['fund_wallet', 'fund_token', 'fund_cap'];

const ctx: CardContext = {
  userPublicKey: owner,
  walletContractId: walletId,
  funds: [{ id: 'f1', name: 'Demo Agri Fund', symbol: 'AGRI1', fundWalletPublicKey: fundWallet, tokenContractId: fundToken }],
};

function bytesOf(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
function b64Of(bytes: Uint8Array): string {
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
}
function indexOf(hay: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}
function flipAt(b64: string, at: number): string {
  const b = bytesOf(b64);
  b[at] ^= 0x01;
  return b64Of(b);
}

const capLo = new Uint8Array(8);
new DataView(capLo.buffer).setBigUint64(0, CAP);
const raw = bytesOf(xdr);
const capAt = indexOf(raw, capLo);
const contractAt = indexOf(raw, new Uint8Array(32).fill(7));
assert.ok(capAt > 0 && contractAt > 0, 'fixture bytes not found');

const flippedCap = flipAt(xdr, capAt + 7);
const flippedContract = flipAt(xdr, contractAt + 31);

type Decoder = (x: string) => Promise<ReturnType<typeof toDecodedCall>>;

const localDecoder: Decoder = async (x) => localToDecodedCall(decodeLocally(x), ARG_NAMES);

async function apiDecoder(): Promise<Decoder | null> {
  const base = process.env.COUNTERSIGN_API_URL;
  const jwt = process.env.COUNTERSIGN_JWT;
  if (!base || !jwt) return null;
  return async (x) => {
    const r = await fetch(`${base}/tx/decode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ transactionXdr: x }),
    });
    if (!r.ok) throw new Error(`POST /tx/decode ${r.status}: ${await r.text()}`);
    return toDecodedCall(((await r.json()) as { decoded: unknown }).decoded);
  };
}

async function run(name: string, decode: Decoder) {
  const original = await decode(xdr);
  const cardA = buildCardModel(original, ctx);
  assert.equal(cardA.functionName, 'allow_fund');
  assert.equal(cardA.contract.label, 'Your mandate wallet');
  const capLine = cardA.args.find((a) => a.label === 'Cap for this fund');
  assert.ok(capLine && /5,000|5000/.test(capLine.value), `${name}: cap shown as ${capLine?.value}`);
  assert.equal(cardA.network, 'Stellar testnet');
  assert.ok(checkConsistency(original, xdr).ok, `${name}: original must be consistent`);

  // One byte of the amount
  const cardB = buildCardModel(await decode(flippedCap), ctx);
  assert.notDeepEqual(cardB.args, cardA.args, `${name}: flipping an amount byte must change the card`);
  // One byte of the contract address
  const cardC = buildCardModel(await decode(flippedContract), ctx);
  assert.notDeepEqual(cardC.contract, cardA.contract, `${name}: flipping a contract byte must change the card`);
  assert.equal(cardC.contract.recognised, false, `${name}: altered contract must not be recognised`);
  // A card decoded from the original bytes must refuse to sign altered bytes
  assert.equal(checkConsistency(original, flippedCap).ok, false, `${name}: altered amount must block signing`);
  assert.equal(checkConsistency(original, flippedContract).ok, false, `${name}: altered contract must block signing`);
  console.log(`ok  ${name}: one byte changes the card (cap ${capLine!.value} -> ${cardB.args[2]?.value}; contract -> ${cardC.contract.label})`);
}

(async () => {
  await run('browser decoder (offline stand-in)', localDecoder);
  const api = await apiDecoder();
  if (api) await run('API decoder POST /api/tx/decode', api);
  else console.log('skip API decoder: set COUNTERSIGN_API_URL and COUNTERSIGN_JWT to run it');
})().catch((e) => {
  console.error('FAIL', e instanceof Error ? e.message : e);
  process.exit(1);
});
