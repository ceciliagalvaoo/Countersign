# Soroban contracts

| Contract | Role in the platform | Admin |
|---|---|---|
| `fund-token` | **Fund units.** SEP-41 token (transfer, approve/allowance, transfer_from, burn). One instance per approved fund, deployed by the fund wallet from the uploaded Wasm. allowlist set by the issuer (units only reach allowlisted accounts, also via `transfer_from`; onboarding checks are simulated), max supply, pause. Units are minted here when the issuer countersigns an investment. | The fund wallet |
| `receivable-vault` | **Receivables, payments and payouts.** Platform-wide registry of funds, assignors (cedentes), debtors (sacados) and receivables. `pay` moves the receivable's USDC into the vault; `distribute` pays it out in USDC to every unit holder pro rata to their fund unit balance (all holders, exactly once). Mirrors the database through `POST /api/receivables/:id/chain`. | Platform admin (`STELLAR_ADMIN_ADDRESS`); `pay` is signed by the payer |
| `badge-verifier` | **Private investor tiers.** Verifies Groth16 proofs (BN254 host functions) that an attested commitment to an investor's total reaches a tier threshold, without revealing the total. See `zk/badge`. | Platform admin (rotates the attester key) |
| `mandate-wallet` | **The investing agent's wallet** (Countersign). One instance per investor, deployed by her from the uploaded Wasm. Holds her USDC and fund units. The agent can only `subscribe`: pay an allowlisted fund wallet, within the per transaction, per period (ledger timestamp window) and per fund caps she signed, once per policy `decision` hash. The owner sets limits and the allowlist, revokes or replaces the agent, and withdraws (only to herself). No upgrade function, no platform admin, no `__check_auth` (nobody can move its balance from outside). Enforced by our wallet contract on Stellar testnet, not audited. | The investor (owner); no platform admin |

Built with `soroban-sdk` 28 (Stellar Protocol 29). All contracts:

- are initialized by a `__constructor` that runs atomically with the deploy (no front-running of an `initialize` call);
- extend the TTL of their storage on every write, so data is not archived while the contract is in use.

`fund-token` and `receivable-vault` also expose `set_admin(new_admin)`, signed by the current **and** the new admin,
to hand control over to a multisig account.

The API never holds keys for these contracts: it builds and simulates each transaction, the right wallet signs it,
and the API decodes the confirmed transaction to check it is exactly the expected call before updating its database.

## Requirements

- Rust (stable) with the `wasm32v1-none` target: `rustup target add wasm32v1-none`
- [Stellar CLI](https://github.com/stellar/stellar-cli) **v25.2.0 or later** (recommended: 28.1.0). `soroban-sdk` 28 refuses to build to Wasm without it.

## Build and test

Run inside `contracts/fund-token`, `contracts/receivable-vault`, `contracts/badge-verifier` or `contracts/mandate-wallet`:

```bash
cargo test               # unit tests
stellar contract build   # outputs target/wasm32v1-none/release/*.wasm
```

## Deploy to testnet (and redeploy after a testnet reset)

```bash
contracts/scripts/deploy-testnet.sh            # uses/creates the admin CLI identity (default name in the script)
```

The script builds the contracts, uploads the FundToken Wasm, deploys a reference FundToken, the ReceivableVault and
the BadgeVerifier (with the circuit's verification key from `zk/badge/keys`) and writes
`FUND_TOKEN_WASM_HASH`, `FUND_TOKEN_CONTRACT_ID`, `RECEIVABLE_VAULT_CONTRACT_ID`, `BADGE_VERIFIER_CONTRACT_ID`,
`BADGE_ATTESTER_SECRET` and `STELLAR_ADMIN_ADDRESS` into `apps/api/.env`.
Copy the same values to the API's environment on your hosting provider.

It also uploads the MandateWallet Wasm and writes `MANDATE_WALLET_WASM_HASH` (each investor deploys her own wallet
from it). To upload only the MandateWallet Wasm, without redeploying or touching anything else (for example once the
admin account is a multisig):

```bash
contracts/scripts/deploy-testnet.sh --mandate-wallet-only     # same as contracts/scripts/upload-mandate-wallet.sh
```

It runs the contract tests, builds, uploads with the CLI identity `cs-wasm-uploader` (created and funded by friendbot
if missing; it only pays the fee and has no rights over any wallet) and writes only `MANDATE_WALLET_WASM_HASH`.

The testnet is reset periodically. The API logs a warning at startup when a configured contract no longer exists;
when that happens, run the script again.

## Securing the admin key

The CLI identity is a plain key stored on one machine (`~/.config/stellar/identity/`). To avoid a single point of failure:

1. **Back it up** right after creating it: `stellar keys secret <admin identity>`, store it in a password manager, then clear the terminal.
2. **Make the admin account a multisig** so no single key controls the contracts:

   ```bash
   contracts/scripts/secure-admin.sh --threshold 2 G...WALLET1 G...WALLET2 G...WALLET3
   ```

   Each `G...` is the public key of a team member's wallet (Freighter or a hardware wallet). After this, admin
   actions need 2 of the 3 signatures and the local key alone can no longer sign (verified: it gets `TxBadAuth`).
   Double-check the addresses: with a wrong signer set the account is locked (on testnet, just redeploy).
3. Alternatively, move control to a new account later with `set_admin` (needs the current and the new admin's signatures).

### Operating with a multisig admin

- **In the app:** the vault steps signed by the admin (`register`, `distribute`, ...) become shared pending transactions.
  Each signer logs in as a manager, connects their own Freighter on **Receivables → Record on Stellar** and signs; the
  API checks every signature against the account's signers on the network and submits once the threshold is reached
  (`POST /api/multisig/:id/sign`). Pending transactions are valid for 6 hours, then a new one is built. Every signer
  therefore needs a manager account (`npm run create-gestor -- <email>` in `apps/api`).
- **`deploy-testnet.sh`** only works while the local key controls the account. After a **testnet reset** the account is
  wiped and re-created by friendbot with the local key: redeploy, then run `secure-admin.sh` again.
- **CLI admin actions** (e.g. `set_attester` on the BadgeVerifier) need the signers too: build the transaction with
  `stellar contract invoke ... --build-only`, have each signer sign it (e.g. in Stellar Lab), then submit it.
