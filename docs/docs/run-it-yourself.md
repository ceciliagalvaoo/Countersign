---
id: run-it-yourself
title: Run it yourself
sidebar_position: 6
---

# Run it yourself

You can verify without running anything: open any hash on the [Evidence](evidence.md) page and read the `subscribe` arguments on stellar.expert, or use the [Live demo](live-demo.md). To reproduce, follow the steps below on a clean machine. Nothing here touches mainnet.

## Requirements

- Linux or macOS (Windows through WSL2); Node.js 24 (npm 11; the web app's dependencies require Node.js 22.12 or later); Docker.
- Rust stable with `rustup target add wasm32v1-none`; Stellar CLI 25.2.0 or later (28.1.0 recommended).
- A browser with the Freighter extension set to Testnet.
- An Anthropic API key for the agent service (the agent tests use a scripted model client and need no key).

Never commit a `.env` file; only the `.env.example` files are in the repository.

## 1. Local databases (disposable)

```bash
docker run -d --name countersign-pg-test -e POSTGRES_PASSWORD=<choose-one> -p 55432:5432 postgres:16-alpine
docker exec countersign-pg-test psql -U postgres -c "CREATE DATABASE countersign_test;"
docker exec countersign-pg-test psql -U postgres -c "CREATE DATABASE countersign_suites;"
cp tests/.env.example tests/.env
# set DATABASE_URL and DIRECT_URL to .../countersign_test and SUITES_DATABASE_URL to .../countersign_suites
```

## 2. Contracts

```bash
cd contracts/mandate-wallet && cargo test && stellar contract build && cd ../..
cd contracts/fund-token && cargo test && stellar contract build && cd ../..
cd contracts/receivable-vault && cargo test && stellar contract build && cd ../..
cd contracts/badge-verifier && cargo test && stellar contract build && cd ../..
cp apps/api/.env.example apps/api/.env
contracts/scripts/deploy-testnet.sh     # deploys on testnet and writes IDs and Wasm hashes into apps/api/.env
```

## 3. API (port 3001)

```bash
cd apps/api
# fill DATABASE_URL, DIRECT_URL, JWT_SECRET and AGENT_KEY_ENCRYPTION_SECRET in apps/api/.env
npm install
npm run db:deploy
npm run create-gestor -- <manager-email>
npm run dev
```

## 4. Demonstration funds and the end to end check

```bash
scripts/e2e/run.sh      # fund wallets, FundTokens, demo catalog seed, then the end to end run on testnet
```

## 5. Agent service (port 3002)

```bash
cd apps/agent
cp .env.example .env    # ANTHROPIC_API_KEY, API_BASE_URL=http://localhost:3001/api
npm install
npm test
npm run dev
```

## 6. Web app (port 5173)

```bash
cd apps/new_web
cp .env.example .env
npm install
npm run test:card
npm run dev
```

Open `http://localhost:5173`, register as an investor, connect Freighter (Testnet) and open `/agent`.

## 7. Suites and evidence

```bash
npm --prefix tests install
npm --prefix tests run suites                 # benign B01 to B12 and adversarial A01 to A12, two tables, two rates
npm --prefix tests run check:m1 -- --subscribe <hash> --mint <hash> --tests-db
npm --prefix tests run evidence               # evidence/EVIDENCE.md and evidence/evidence.json
```

Example, read only, for the purchase made through the UI:

```bash
npm --prefix tests run check:m1 -- \
  --subscribe ca28550282a909fc3d625dc3ef09825bd53a1be100d87f057b4b1d54a6b47bd1 \
  --mint b9d1ad650a9cdafb6f8ae1c488baac57baca1489c57fcb3913fffeb8a016674d
```

Without a log source, only the on-chain part is checked, and the verdict says so.

## Type checks

```bash
cd apps/api && npx tsc --noEmit
cd apps/agent && npx tsc --noEmit
cd apps/new_web && npx tsc --noEmit -p tsconfig.app.json
```

The testnet is reset periodically (next reset 16 Dec 2026, per Stellar Docs, Networks). After a reset, run `contracts/scripts/deploy-testnet.sh` and `scripts/e2e/run.sh` again.

## Deploying your own copy

`render.yaml` at the repository root is a Render Blueprint for the three services: the API and the agent as Node web services, the web app as a static site with every path rewritten to `index.html`. Each secret is entered in the Render dashboard, never in the repository. After the first deploy, set `API_BASE_URL` of the agent and `VITE_API_URL` of the web app to the API's public URL plus `/api`, `VITE_AGENT_URL` to the agent's public URL, and `CORS_ORIGIN` of the API and the agent to the web app's URL. The `VITE_` variables are read at build time, so the web app has to be built again after they change. The documentation site is built and published to GitHub Pages by `.github/workflows/deploy-doc.yaml`.
