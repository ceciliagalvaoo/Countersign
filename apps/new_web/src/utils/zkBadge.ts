// Generates the investor tier proof in the browser (Groth16, circuit zk/badge/circuits/investor_tier.circom).
// The opening of the commitment (total invested + salt) never leaves the device: only the proof is sent.

export interface ZkWitness {
  investor: string;
  totalCents: number;
  salt: string;
  commitment: string;
  threshold: number;
  tier: string;
  circuit: { wasm: string; zkey: string };
}

export interface SorobanProof {
  a: string;
  b: string;
  c: string;
}

const fe = (dec: string) => BigInt(dec).toString(16).padStart(64, '0');

/** snarkjs proof -> BN254 encoding of soroban-sdk (G1: X||Y, G2: X.c1||X.c0||Y.c1||Y.c0) */
function toSorobanProof(proof: { pi_a: string[]; pi_b: string[][]; pi_c: string[] }): SorobanProof {
  return {
    a: fe(proof.pi_a[0]) + fe(proof.pi_a[1]),
    b: fe(proof.pi_b[0][1]) + fe(proof.pi_b[0][0]) + fe(proof.pi_b[1][1]) + fe(proof.pi_b[1][0]),
    c: fe(proof.pi_c[0]) + fe(proof.pi_c[1]),
  };
}

export async function proveTier(witness: ZkWitness): Promise<SorobanProof> {
  // Loaded on demand: snarkjs is large and only needed here
  const snarkjs = await import('snarkjs');
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    {
      totalCents: witness.totalCents.toString(),
      salt: witness.salt,
      commitment: BigInt('0x' + witness.commitment).toString(),
      threshold: witness.threshold.toString(),
    },
    witness.circuit.wasm,
    witness.circuit.zkey
  );
  if (fe(publicSignals[0]) !== witness.commitment) {
    throw new Error('Proof does not match the attested commitment');
  }
  return toSorobanProof(proof);
}
