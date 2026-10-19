---
id: overview
title: Overview
slug: /
sidebar_position: 1
---

# Countersign

**An investing agent that cannot buy a fund unit unless the investor's mandate, the fund's issuer and the network agree.**

*Sign only what you can read.*

2026 Shenzhen FinTechathon, International AI Track, Topic F (Agent Wallet). Team: [PENDING: team name]. Demo video: [PENDING: demo video URL]. Repository: [PENDING: GitHub repository URL].

All USDC and fund units in this submission are test assets on the Stellar public test network, with no monetary value, except the mainnet transactions described in limitation 14 (one mandate wallet, less than US$5 in USDC, one agent purchase). Transaction hashes prove the mechanism, not a market.

## What it is

Countersign is an AI agent (Claude, by Anthropic) with its own mandate wallet on Stellar. It buys units of receivables funds for an investor who already holds USDC. Every first purchase in a new fund waits for a card she can read and sign.

> The agent's wallet is a contract on Stellar: it can only pay fund wallets the investor approved, within limits she signed, and it cannot change those limits. Nobody holds a fund unit unless the fund's issuer signs the mint.

Those limits are enforced by our wallet contract on Stellar, not audited. Who enforces each limit is listed in the [Security model](security-model.md).

## The problem

| Fact | Number | Source |
|---|---|---|
| People who already hold digital dollars on this network | USDC: 2,481,283 trustlines on Stellar mainnet | stellar.expert API |
| Retail investors are entering receivables funds (Brazil, as an example) | Net assets of FIDCs R$741.1 billion, +22.5% in 12 months to Nov 2025; "general" investor accounts from 2.4 thousand to 34.3 thousand (+1,329.2%) | [ANBIMA, 24 Dec 2025](https://www.anbima.com.br/pt_br/imprensa/fidcs-ampliam-base-de-investidores-com-destaque-para-o-varejo.htm) |
| The risk of a receivables fund is existence and concentration | Credit Suisse closed 4 funds linked to Greensill with "around ten billion US dollars" of client money | [FINMA, 28 Feb 2023](https://www.finma.ch/en/news/2023/02/20230228-mm-greensill/) |
| A language model refusing does not protect money | Freysa: 482 messages, 13.19 ETH (about US$47 thousand) | [Simon Willison](https://simonwillison.net/2024/Nov/29/0xfreysaagent/) |
| The operator's panel is an attack surface | AIXBT: 55.5 ETH (about US$106,200) | [AIID 1003](https://incidentdatabase.ai/cite/1003) |
| The human approves what the screen shows | Bybit: about US$1.5 billion, tampered signing interface | [Bloomberg](https://www.bloomberg.com/news/articles/2025-02-21/bybit-says-exchange-wallet-hacked-1-5-billion-estimated-loss) |

The person we design for (composite persona, built from public data; not validated by interviews) keeps part of her savings in USDC, lives under the rules of two countries, and gives up at the confirmation screen of her first purchase, in front of something irreversible she cannot read. In most agent wallet designs the language model proposes and a policy on the server decides; if the server falls, the policy falls with it. Countersign puts the limits where our server cannot reach: in the agent's wallet contract, and in the fund issuer's signature on every mint.

## Why Stellar

Without Stellar's USDC being the same asset as a trustline and as a contract (the Stellar Asset Contract), with authorization done by the host for any address, the investor's existing USDC could not sit in an agent wallet contract and be paid to a fund wallet in one contract call; the caps would move back to our server. Protocol 25 made BN254 and Poseidon native, which lets our `badge-verifier` check a Groth16 eligibility proof on chain. Every hash opens in a public explorer. This is an advantage of cost and simplicity, not exclusivity: the same rules could be written as a smart account on another chain.

## Where to read next

- [How it works](how-it-works.md): the purchase, step by step (Figure 1 and Figure 2).
- [Security model](security-model.md): tiers, who enforces what, and the two suites.
- [Evidence](evidence.md): real testnet hashes and the mainnet slice, with links.
- [Limitations](limitations.md): the literal list, identical in every document.
- [Run it yourself](run-it-yourself.md): from a clean machine.

## Roadmap

Countersign will add regulated on and off ramps and currency conversion; real KYC and suitability per jurisdiction through licensed partners; an external audit of the contracts; a multi party ZK ceremony and third party credentials; a real scheduler for recurring purchases; redemptions and a secondary market; and real value on mainnet. None of this exists today.
