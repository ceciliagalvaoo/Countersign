---
id: live-demo
title: Live demo
sidebar_position: 2
---

# Live demo

Countersign is deployed on the Stellar test network. The web app, the API and the agent service are built from the `main` branch of this repository by `render.yaml`.

Prefer to watch first? The demo video (4:53, English narration and subtitles) walks through the whole flow: [youtu.be/bo6VPN48SOg](https://youtu.be/bo6VPN48SOg).

| Part | URL |
|---|---|
| Web app | [countersign-web-rt1a.onrender.com](https://countersign-web-rt1a.onrender.com) |
| API health | [countersign-api-zy11.onrender.com/health](https://countersign-api-zy11.onrender.com/health) |
| Agent service health | [countersign-agent.onrender.com/health](https://countersign-agent.onrender.com/health) |

Everything in the live demo uses test USDC and units of demonstration funds on the Stellar test network, with no monetary value. The services run on a free hosting plan: if they have been idle, the first request can take up to a minute.

## What you need

- A browser with the [Freighter](https://www.freighter.app/) extension, set to **Testnet**.
- A testnet account in Freighter, funded with test XLM from [Friendbot](https://friendbot.stellar.org).

## A first purchase, in the live app

1. **Register as an investor.** New accounts are approved by hand by the team, through the platform's manager account, before their first login; until then the account stays pending. Reviewers: ready investor accounts, one per reviewer, are in the submission form.
2. **Open the agent page** (`/agent`) and connect Freighter.
3. **Describe your mandate in one message.** For example: "I live in Brazil. I want to invest 100 USDC over 12 months, keep 20% available within 3 months, low loss tolerance, at most 10 USDC per purchase and 30 USDC per 30 days, sectors agribusiness and services." The typed mandate fills in next to the chat; approve it.
4. **Get test USDC** from the mandate wallet panel. You sign a USDC trustline in Freighter, then the platform sends test USDC to your account.
5. **Create your mandate wallet.** The approval card shows the deploy decoded from the bytes you will sign: owner, agent key, caps and mandate hash. Sign it, then deposit some test USDC into the wallet.
6. **Ask for a purchase**, for example "Please buy 5 USDC of the Agri Receivables Demo Fund (CSAGRI)." It is your first purchase in that fund, so the flow stops at a card with `allow_fund` decoded from the bytes. Read it and sign.
7. **Tell the agent to continue.** The agent's key, held by our server and never seen by the model, signs the `subscribe`. Our wallet contract on Stellar (not audited) checks the allowlist, the caps and the `decision`, then pays the fund wallet.
8. **Open the hash.** The first argument of `subscribe` on stellar.expert is the `decision`; the Evidence panel shows the decision log line with the same hash.
9. **Wait for the issuer.** The status stays "awaiting issuer countersignature" until the fund wallet signs the mint of your units.

The issuer side (approving the order, `whitelist_add` and `mint`, pausing the units) uses the fund's own wallet, so in the live demo it is done by hand by the team, not on a schedule; until then your purchase shows "awaiting issuer countersignature". The [Evidence](evidence.md) page lists every hash we already produced, including the issuer's.

## Each chat message calls Claude

The agent page sends each message to Claude through our Anthropic account. Please keep the conversation to the steps above. What the model receives is stated in [limitation 11](limitations.md).
