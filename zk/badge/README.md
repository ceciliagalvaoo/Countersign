# ZK investor tier badge

Lets an investor prove their tier (e.g. "invested at least 1,000 USDC") **without revealing how much they invested**,
verified on-chain by the `contracts/badge-verifier` Soroban contract (Groth16 over BN254, Protocol 25 host functions).

## How it works

1. After each verified investment, the API computes `commitment = Poseidon(totalCents, salt)` (fresh random salt) and
   attests it with an ed25519 key: `sign("TSF-BADGE-v1" || commitment || investorAddress)`.
2. The investor fetches the opening (`totalCents`, `salt`) and the attestation (`GET /api/badges/:id/zk-witness`, only
   for themselves) and generates the proof **in the browser** with `circuits/investor_tier.circom`:
   `commitment == Poseidon(totalCents, salt)` and `totalCents >= threshold`. Public signals: `[commitment, threshold]`.
3. The investor's wallet signs `claim(...)` on the BadgeVerifier, which checks the attestation, verifies the proof and
   stores `{threshold, commitment}`. Anyone can check a wallet's tier with `GET /api/badges/verify/:publicKey`.

## Build

```bash
npm ci
npm run build     # compiles the circuit, Groth16 setup, exports the verification key and browser artifacts
npm run fixture   # regenerates the contract test fixture with a real proof
```

Requires `circom` >= 2.1.6. Outputs: `apps/new_web/public/zk/investor_tier.{wasm,zkey}` (served to the browser) and
`keys/vk-soroban.json` (versioned; passed to the contract constructor by `contracts/scripts/deploy-testnet.sh`).
Every build creates a **new** key pair, so redeploy the BadgeVerifier afterwards.

## Trusted setup

- Phase 1: Perpetual Powers of Tau (PSE / Ethereum Foundation, 80 contributions), `ppot_0080_10.ptau`.
  Set `VERIFY_PTAU=1` to verify the whole file (slow).
- Phase 2: `npm run build` makes a single contribution, which is fine for development and testnet.
  **Before mainnet, run the multi-party ceremony** with `scripts/ceremony.sh` (`init` → each participant runs
  `contribute` on their own machine → anyone can `verify` → `finalize` with a public random beacon). The key is
  secure if at least one participant discarded their entropy. Then redeploy the BadgeVerifier with the new key.
