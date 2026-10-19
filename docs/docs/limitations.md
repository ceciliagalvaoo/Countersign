---
id: limitations
title: Limitations
sidebar_position: 5
---

# Limitations

The list below is identical in the README, the technical document, the security self-assessment, the video and the submission form. It is copied, not rewritten.

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
    wallet controlled by the team. These are the only mainnet transactions in this
    submission; everything else runs on the Stellar test network. The fund unit token on
    mainnet is a test asset issued by the team; the purchase proposal there was entered by
    the operator and decided by our policy code.
```
