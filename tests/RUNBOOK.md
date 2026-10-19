# Countersign runbook: from zero to the demo (Stellar testnet)

No secret is in this file. Every `.env` below is created from its `.env.example` and is ignored by git.
Everything runs on **Stellar testnet** with test assets. The wallet contract is ours and **not audited**.

## 1. Prerequisites

- Node.js 20 or newer, Rust with the `wasm32v1-none` target, the `stellar` CLI, Docker (for the disposable Postgres used by the tests).
- A Postgres database for the API (any Postgres; the team used a hosted one).
- An Anthropic API key, only for `apps/agent`.
- Freighter browser extension on Testnet, with three accounts: the investor (owner of her mandate wallet), and one fund wallet per demo fund you create.

## 2. Contracts

```bash
cd contracts/mandate-wallet && cargo test           # the wallet contract tests
contracts/scripts/deploy-testnet.sh                 # FundToken Wasm, vault, BadgeVerifier, MandateWallet Wasm; writes IDs to apps/api/.env
contracts/scripts/deploy-testnet.sh --mandate-wallet-only   # only re-uploads the MandateWallet Wasm
```

Run it again after a testnet reset (contracts disappear and the API answers 404 for their reads).

## 3. API, agent and web app

```bash
cp apps/api/.env.example apps/api/.env       # fill in; the deploy script already wrote the contract IDs
cd apps/api && npm install && npx prisma migrate deploy && npm run dev        # port 3001
cp apps/agent/.env.example apps/agent/.env   # ANTHROPIC_API_KEY, API_BASE_URL=http://localhost:3001/api
cd apps/agent && npm install && npm run dev  # port 3002
cd apps/new_web && npm install && VITE_API_URL=http://localhost:3001/api VITE_AGENT_URL=http://localhost:3002 npm run dev   # port 5173
```

On a Windows disk mounted in WSL, restart the API and the agent after pulling changes (file watching does not see them).

## 4. Accounts, test XLM and test USDC

- Test XLM: Freighter "Fund with Friendbot", or `https://friendbot.stellar.org?addr=<G...>`.
- Test USDC (issuer `GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56`): the "Get test USDC" button in the app header calls `POST /api/stellar/test-usdc` (testnet faucet relay) and falls back to a trustline plus `POST /api/stellar/test-usdc-transfer` (testnet operator account, 100 test USDC per account per day).
- Users: register at `/register` as Investor (and as Consultant for creating funds); a manager approves them in Investors and Consultants. The first manager account is created by the operator with `apps/api/scripts/create-gestor.js`.

## 5. Demo funds (manager flow)

For each fund of `apps/api/scripts/countersign-demo-funds.json` (start with CSAGRI):
1. The consultant creates the fund in "Create Fund" with the catalog values.
2. The manager, with the fund wallet connected in Freighter, adds the USDC trustline to that wallet ("Get test USDC"), opens the fund and clicks **Approve**: the fund wallet is recorded and its FundToken is deployed, signed by the fund wallet.
3. The manager clicks **Issue quotas** with the catalog's `totalIssued`.

## 6. Investor flow (what the video shows)

1. `/agent`: describe the mandate in the chat; review the typed mandate; **Approve mandate**.
2. Create the mandate wallet (deploy card, signed in Freighter), deposit test USDC (card).
3. Ask the agent to buy units of a fund. The first purchase in a fund asks for her `allow_fund` signature (card); then the agent buys within her limits (`subscribe`, with the hash of the decision-log line as `decision`).
4. The manager, with the fund wallet connected, approves the order in Investments: `whitelist_add` and `mint` to her mandate wallet (issuer countersignature).
5. Evidence panel: hashes, links, the decision next to its log line, "chain verified".
6. Controls: interrupt, run recurring now (with its interruption window), revoke the agent (last). Manager: pause fund units.

Scene order of the video: mandate in the chat, approve, wallet and deposit, first purchase with `allow_fund`, agent purchase, issuer countersignature, evidence panel, a refusal (policy and contract), pause, revoke.

## 7. Tests and evidence

```bash
npm --prefix tests install
npm --prefix tests run suites                       # adversarial A01 to A12 and benign B01 to B12 (disposable Postgres on 55432)
npm --prefix tests run suites -- --only benign      # benign B01 to B12 with A08 and A09 (SUITES_LLM=live for the real model)
npm --prefix tests run check:m1 -- --subscribe <hash> --mint <hash> --api http://localhost:3001/api
npm --prefix tests run evidence                     # evidence/EVIDENCE.md and evidence/evidence.json
npm --prefix tests run evidence:tamper-check        # alters one log line in a copy and expects the export to fail
```

The suites need `tests/.env` (from `tests/.env.example`) pointing at the disposable Postgres container, and they start their own API on a free port. Never point them at the team database. Do not run them while recording the demo.
