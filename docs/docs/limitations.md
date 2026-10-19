---
id: limitations
title: Limitations
sidebar_position: 5
---

# Limitations

Each limitation on this page is a scope decision, written into our design together with what bounds it and what would lift it. Most were set while designing the prototype; item 13 was added during the build, when a spike showed where contract error codes come from, and the wording of the others was updated to match what the build confirmed. We publish them because a judge, an investor or a regulator should be able to see exactly where the prototype stops.

The page has two parts:

1. **The literal list.** It is identical in the README, the technical document and the security self-assessment, and is shown in full in the video and the submission form. It is copied, not rewritten.
2. **[Why each limitation is there](#why-each-limitation-is-there).** For each item: the decision we took, why, what bounds it in this prototype, and what would lift it.

```text
Known limitations (identical in every document, the video and the submission form)

1. Test assets. All USDC and fund units in this submission are test assets on the Stellar
   public test network and have no monetary value, except the mainnet
   transactions described in item 14. Transaction hashes prove the mechanism, not a market.
2. Our contract, not audited. The mandate wallet is a contract we wrote. It is public and
   has no upgrade function, but it has not been audited. A bug in it would be our bug.
3. Agent key custody. The agent's signing key is held by our server, separate from the
   language model, which never sees it. If the server were compromised, the attacker could
   only make payments our wallet contract allows: to fund wallets the investor approved,
   within the per purchase, per period and per fund caps she signed. The contract refuses a
   decision value it has already used, but it cannot check that a new value matches our
   decision log; that check is made afterwards by our verification script.
4. Within the mandate, the agent chooses. Our wallet contract enforces where money can go
   and how much; it does not judge whether a purchase inside those limits was wise.
5. Simulated compliance. KYC/KYB, suitability and the jurisdiction perimeter are simulated
   checks, designed with reference to FINRA 2111, ESMA35-43-3172 and CSRC suitability
   measures. Funds and debtors are simulated; concentration and default data are synthetic.
6. Zero-knowledge eligibility. The tier proof shows that the total an investor has invested
   on this platform reaches a threshold, without revealing it. It is not a regulatory
   investor status. The platform attests the committed total, and the circuit's phase 2
   trusted setup has a single contribution, so whoever controls the setup or the
   attestation could forge a tier.
7. Perimeter. The system is not offered to, and is not designed for, persons or entities in
   Mainland China. We are aware of the February 2026 notice (Yinfa [2026] No. 42) that
   prohibits RWA tokenization onshore except on designated financial infrastructure with
   approval. Nothing in this submission is an offer or solicitation to buy or sell securities
   or fund units in any jurisdiction.
8. Discretionary management and key custody without a licence. Executing within a mandate
   is discretionary portfolio management, and holding the agent's signing key is a form of
   custody. This prototype holds no licence; a production deployment would require licensed
   partners (fund administrator, custodian, regulated on/off-ramp, key custody) and local
   authorisation in each target market.
9. Recurring purchases. Recurring purchases are pre-authorised within the investor's mandate
   and started by a manual "run recurring now" trigger for the demo. The time trigger is
   simulated; the on-chain transactions are real.
10. No return promise. The agent never states or implies a guaranteed or expected return.
    The demonstration funds state no return figure; every fund is shown with a loss
    scenario.
11. What the language model sees. Our agent service sends the LLM provider (Anthropic,
    Claude) the investor's chat messages and typed tool results: mandate fields, including
    countries of residence; fund facts; policy outcomes; transaction hashes. Fund texts
    written by third parties are sent marked as untrusted data. Before every call the
    service removes Stellar account and contract addresses, secret keys, email addresses
    and access tokens, and aborts the call if any remain. No private key and no identity
    document is sent; amounts the investor types in the chat are sent as she typed them.
12. Composite persona. The investor persona is a composite persona, built from public data.
    It was not validated by interviews.
13. Contract refusals. When our wallet contract refuses a transaction, the error code we
    show (Error(Contract, #N)) comes from the RPC's diagnostic events, which are not part of
    consensus. What the ledger guarantees is the transaction hash, the FAILED result and the
    fee charged.
14. Mainnet slice. One mandate wallet was deployed on Stellar mainnet
    and funded with less than US$5 in USDC; the agent made one purchase from it to a fund
    wallet controlled by the team. These are the only mainnet transactions of the
    mechanism; the team's other mainnet operations were account setup (XLM funding and
    USDC trustlines). Everything else runs on the Stellar test network. The fund unit token on
    mainnet is a test asset issued by the team; the purchase proposal there was entered by
    the operator and decided by our policy code.
```

## Why each limitation is there

Each row below matches the item with the same number. "What bounds it today" points to something you can check in this repository or on chain; "What would lift it" is future work, and none of it exists today.

| # | Decision we took | Why | What bounds it today | What would lift it |
|---|---|---|---|---|
| 1 | Run the mechanism on the Stellar test network, with test USDC and units of demonstration funds, plus one mainnet slice of less than US$5 | Real fund units sold to the public would be an offer of securities (items 7 and 8). Proving the mechanism needs real transactions, not real money | Every hash opens on stellar.expert; the [mainnet slice](evidence.md#mainnet-slice) shows the same wallet contract running with real USDC (same Wasm hash on testnet and mainnet, `79c76789...f087`) | Real value on mainnet, through licensed partners |
| 2 | Write a short wallet contract of our own instead of adopting a general smart account library | We preferred a short contract we could test rule by rule over a general smart account library whose policies we could not fully review within the build window. With no upgrade function, its code cannot change after deploy | 23 contract tests covering each rule with passing and refusing cases; no upgrade function and no platform admin; four bypass attacks refused on chain (A03, A04, A06, A07); the most a bug can reach is the wallet's balance | An external audit and formal verification of the rules |
| 3 | Keep the agent's signing key on our server, apart from the language model | The agent has to act when the investor is offline (purchases within her mandate, recurring purchases), and the model must never hold a key. We chose to bound the key with the contract rather than trust the server | Our wallet contract only pays fund wallets she approved, within her caps; the issuer still has to countersign every mint; she revokes the agent with one signature; the evidence script detects afterwards any on-chain `decision` without a matching log line (0 divergences in the last export) | Agent key in an HSM or a secure enclave; signing limited per session |
| 4 | Let the contract enforce where money goes and how much, and leave the choice inside those limits to the agent | Judging whether a purchase is wise needs market data and opinion, which do not belong in a contract with no upgrade function. The investor keeps the decisions that matter: which funds, and how much | The first purchase in every fund needs her signature on a decoded card; a per fund cap; our policy refuses a destination or an amount taken from third party text (A01, A02); an interrupt window; revocation | Stricter separation of control and data for the agent; a limit on approval requests per period |
| 5 | Simulate KYC/KYB, suitability and the perimeter, written with reference to FINRA 2111, ESMA35-43-3172 and CSRC suitability measures | Real KYC needs a licensed provider and real identity documents; a prototype should not collect them. The funds and debtors are simulated for the same reason | Suitability is deterministic policy code with named rules (`risk_above_tolerance`, `liquidity_mismatch`, `sector_not_allowed`, `sector_concentration`) written to the hash chained decision log; KYC/KYB is simulated by the platform's account approval and the issuer's `whitelist_add`; the interface labels the data as simulated and synthetic | Real KYC and suitability per jurisdiction, through licensed partners |
| 6 | Prove a tier (total invested on this platform reaches a threshold) in zero knowledge, attested by the platform, with a single contribution to the phase 2 setup | The proof shows eligibility without revealing the amount, which is the data minimisation we wanted. A multi party ceremony needs independent participants and was out of reach for this build | The proof is verified on chain by `badge-verifier`; the agent only learns "eligible" or "not eligible"; the interface never calls it a regulatory status | A multi party ceremony; attestation by an independent licensed party |
| 7 | Exclude Mainland China from the perimeter and name the notice | The February 2026 notice prohibits RWA tokenization onshore except on designated financial infrastructure with approval. We would rather state it than leave it unsaid | The policy refuses a residence in Mainland China with the rule `perimeter_mainland_china`, and the reply names Yinfa [2026] No. 42 (benign case B04: no wallet, no order) | Local authorisation and licensed partners in each target market |
| 8 | Build a prototype without a licence | Licences are granted to regulated firms, not to a competition prototype. Test assets keep it from managing any investor's real money | Test assets only; the mainnet slice uses the team's own USDC, paid to a fund wallet controlled by the team | Licensed fund administrator, custodian, on and off ramp and key custody, with local authorisation |
| 9 | Start recurring purchases with a manual "run recurring now" trigger | A demo, and a judge, cannot wait 30 days for the next period. Only the trigger is simulated; the purchase follows the same path as any other | Pre-authorised within her mandate; the same policy, caps and contract checks; a window to interrupt before execution (benign case B10) | A real scheduler |
| 10 | Show no return figure at all | Promising or implying a return is a common form of mis-selling, and the funds are simulated, so any figure would be invented | Every fund is shown with a loss scenario; benign case B12 checks that the agent answers "what will I earn?" without a figure | Historical data from real funds, labelled as historical |
| 11 | Send the model the investor's messages and typed tool results, and remove identifiers before every call | The agent needs her messages, the mandate and the fund facts to plan; it does not need addresses, keys, email addresses or tokens | Data minimisation runs before every call and aborts it if anything remains; the model holds no key; adversarial cases A08 and A09 | A model hosted under a data processing contract |
| 12 | Design for a composite persona built from public data | The build window did not allow interviews; the public data we used is cited in the problem table of the [Overview](overview.md) | The persona is labelled as composite and not validated wherever it appears | Interviews with investors who hold USDC |
| 13 | Show the contract's error code, and say where it comes from | The ledger records that a transaction failed and the fee charged, not the reason. Showing nothing would hide useful information; showing it without the source would overstate it | The transaction hash, the FAILED result and the fee are consensus and open on stellar.expert; anyone can simulate the same call against the current state to read the code, which may differ if the state changed | Nothing on our side: this is how the network reports failures |
| 14 | Run one mainnet slice: one wallet, less than US$5 in USDC, one agent purchase to a fund wallet the team controls, with a fund unit token issued by the team | Show that the same wallet contract and the same agent signature work with real USDC, while keeping the value at risk small and offering no real fund unit (items 7 and 8) | Never above US$5; the slice script stops before each mainnet transaction until the operator types SEND MAINNET (`scripts/mainnet/slice.ts`); every step is in [Table 10](evidence.md#mainnet-slice) with its log line | Real value on mainnet, through licensed partners |
