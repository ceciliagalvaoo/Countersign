// Converts a snarkjs Groth16 verification key into the BN254 encoding used by Soroban (soroban-sdk crypto::bn254):
//   G1: be(X) || be(Y)                           (64 bytes)
//   G2: be(X.c1) || be(X.c0) || be(Y.c1) || be(Y.c0) (128 bytes)
// Usage: node export-vk.mjs keys/verification_key.json keys/vk-soroban.json
import { readFileSync, writeFileSync } from 'node:fs';

const [input, output] = process.argv.slice(2);
const vk = JSON.parse(readFileSync(input, 'utf8'));

const fe = (dec) => BigInt(dec).toString(16).padStart(64, '0');
const g1 = (p) => fe(p[0]) + fe(p[1]);
const g2 = (p) => fe(p[0][1]) + fe(p[0][0]) + fe(p[1][1]) + fe(p[1][0]);

if (vk.protocol !== 'groth16' || vk.curve !== 'bn128') {
  throw new Error(`Unsupported key: ${vk.protocol}/${vk.curve}`);
}

const out = {
  nPublic: vk.nPublic,
  alpha: g1(vk.vk_alpha_1),
  beta: g2(vk.vk_beta_2),
  gamma: g2(vk.vk_gamma_2),
  delta: g2(vk.vk_delta_2),
  ic: vk.IC.map(g1),
};
writeFileSync(output, JSON.stringify(out, null, 2));
console.log(`Wrote ${output} (${out.ic.length} IC points, ${out.nPublic} public inputs)`);
