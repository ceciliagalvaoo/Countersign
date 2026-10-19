---
id: contracts
title: Contracts
sidebar_position: 4
---

# Contracts

Four Soroban contracts, written in Rust with `soroban-sdk` 28.0.0. All four are ours, public and not audited. The source is in [`contracts/`](https://github.com/ceciliagalvaoo/Countersign/tree/main/contracts) of the repository, and each one runs its own tests with `cargo test`.

## Addresses

| Contract | Network | Address |
|---|---|---|
| `mandate-wallet` (one instance per investor; example from end to end run a40494) | testnet | [`CA7JMFSZI2IBTEIDKFHVZ6FMLVGTVRMHCTRJYAIX7L62IKHGNB66KDRG`](https://stellar.expert/explorer/testnet/contract/CA7JMFSZI2IBTEIDKFHVZ6FMLVGTVRMHCTRJYAIX7L62IKHGNB66KDRG) |
| `mandate-wallet` (the investor's wallet used through the interface) | testnet | [`CCFFFHL3FPHZSNVQHIA5OFQY5PTNUA7X4X6CVSVQKTP72WNPCNZKGZYG`](https://stellar.expert/explorer/testnet/contract/CCFFFHL3FPHZSNVQHIA5OFQY5PTNUA7X4X6CVSVQKTP72WNPCNZKGZYG) |
| `mandate-wallet` (mainnet slice) | mainnet | [`CAIUDASJVR5XHXQDGBKDFUYGNL7BQJAQPWLBCA4OFHSYYVFL7GP34HVV`](https://stellar.expert/explorer/public/contract/CAIUDASJVR5XHXQDGBKDFUYGNL7BQJAQPWLBCA4OFHSYYVFL7GP34HVV) |
| `fund-token` (one instance per fund; example: demonstration fund CSAGRI, run a40494) | testnet | [`CDC2RC2KHUMF3MLYJZOGT5VY6JZICFILI2LP5XJBHFEN3MWFHJ73OGRQ`](https://stellar.expert/explorer/testnet/contract/CDC2RC2KHUMF3MLYJZOGT5VY6JZICFILI2LP5XJBHFEN3MWFHJ73OGRQ) |
| `receivable-vault` | testnet | [`CAQJEBGUOP5NFTGWO7QJTOGQSYONSKKCVMFSXQ7GCWEWDK5GWHIHXQH6`](https://stellar.expert/explorer/testnet/contract/CAQJEBGUOP5NFTGWO7QJTOGQSYONSKKCVMFSXQ7GCWEWDK5GWHIHXQH6) |
| `badge-verifier` | testnet | [`CBBGOOKHE4QRRAYAAR3CM6WUYU7K6LX6A2EGEMFTJLL2K5B7QBOEJMEC`](https://stellar.expert/explorer/testnet/contract/CBBGOOKHE4QRRAYAAR3CM6WUYU7K6LX6A2EGEMFTJLL2K5B7QBOEJMEC) |

## `mandate-wallet`

The agent's wallet, one instance per investor. It can only pay fund wallets the owner approved, within limits she signed, and the agent cannot change those limits. These rules are enforced by our wallet contract on Stellar, not audited.

Three design choices carry most of the security:

- **No upgrade function and no platform admin.** Once deployed, only the owner can change the rules, and nobody, the platform included, can replace the code.
- **Not a contract account.** The wallet has no `__check_auth`, so it never authorizes calls made by others. A token `transfer` out of the wallet fails unless the wallet itself makes the call, which it only does inside `subscribe`, `withdraw` and `withdraw_units`.
- **No transfer to an arbitrary destination.** Money leaves only to an allowlisted fund wallet (agent) or to the owner (owner). Not even the owner can send funds to a third party from it.

| Function | Who signs | What it checks |
|---|---|---|
| `__constructor(owner, agent, usdc, per_tx_cap, period_cap, period_secs, mandate_hash)` | owner, atomically with the deploy | caps are positive, the period cap is at least the per purchase cap and the period is not zero; the agent is neither the owner nor the wallet itself |
| `set_limits(per_tx_cap, period_cap, period_secs, mandate_hash)` | owner | the same checks; anchors the hash of the newly approved mandate |
| `allow_fund(fund_wallet, fund_token, fund_cap)` | owner | the cap is positive; the fund wallet is not the owner, the agent or the wallet itself |
| `disallow_fund(fund_wallet)` | owner | the fund was allowed |
| `revoke_agent()` | owner | kill switch: the agent can no longer call `subscribe` |
| `set_agent(agent)` | owner | replaces the agent key and re-enables it; the same checks on the agent |
| `withdraw(amount)` | owner | USDC, only to the owner |
| `withdraw_units(fund_token, amount)` | owner | fund units, only to the owner |
| `subscribe(decision, fund_wallet, amount)` | agent | the agent is not revoked; the `decision` was never used; the fund wallet is allowlisted; the amount is within the per purchase cap, the period cap and the fund cap; then it pays the fund wallet in USDC |

Read functions: `owner`, `agent`, `is_revoked`, `limits`, `mandate_hash`, `fund`, `spent_in_period`, `decision_used`.

Every owner and agent call publishes an event with topic `limits`, `allow_fund`, `disallow_fund`, `revoke`, `set_agent`, `withdraw`, `withdraw_units` or `subscribe`. The `subscribe` event carries the fund wallet, the `decision` and the amount, so the hash of the decision log line is readable both in the call arguments and in the event.

The spending period is derived from the ledger timestamp, not from ledger numbers. Storage entries are extended to about 30 days on every write.

**Refusal codes.** `InvalidConfig` 1, `InvalidAmount` 2, `AgentRevoked` 3, `DecisionUsed` 4, `FundNotAllowed` 5, `OverTxCap` 6, `OverPeriodCap` 7, `OverFundCap` 8, `Math` 9. The code shown for a refused transaction comes from the RPC's diagnostic events, which are not part of consensus (limitation 13).

**Tests.** 23 tests in `contracts/mandate-wallet`, covering each rule with passing and refusing cases (allowlist, caps, period window, fund cap, decision reuse, revocation, owner and agent authorization), including a direct `transfer` out of the wallet, which fails with an authorization error.

## `fund-token`

The fund units, one instance per fund, a SEP-41 token whose admin is the fund wallet (the issuer).

- `whitelist_add` and `whitelist_remove`: only allowlisted holders can receive units. The issuer adds the investor's mandate wallet on her first purchase.
- `mint`: only the admin mints. This is the issuer's countersignature: nobody holds a unit without it.
- `set_pause` and `is_paused`: the issuer freezes and resumes the units.
- `set_admin`: the admin role moves only if both the current and the new admin sign.
- The standard token interface: `balance`, `transfer`, `transfer_from`, `approve`, `allowance`, `burn`, `burn_from`, `decimals`, `name`, `symbol`, `total_supply`, `max_supply`.

## `receivable-vault`

The registry of receivables and the path for income to come back to holders.

- `admin_register_fund`, `admin_register_entity`: register a fund and its assignors and account debtors.
- `register_receivable`, `pay`: a receivable is registered and then paid in USDC.
- `distribute`: pays the holders of a fund's units pro rata. The vault requires the listed holders to add up to the total supply before it pays, so no holder can be left out.

The vault's admin is the platform's account: `admin_register_fund`, `admin_register_entity`, `register_receivable` and `distribute` are signed by it; `pay` is signed by the payer. It also has `set_admin`, `consultant_add`, `consultant_remove`, `submit_fund`, `submit_cedente`, `submit_sacado` and `approve_entity`.

In the demo, a 10 USDC distribution reached the investor's mandate wallet: see [Income back to the mandate wallet](evidence.md#income-back-to-the-mandate-wallet).

## `badge-verifier`

Verifies a Groth16 proof (BN254, with Poseidon) that an investor's total invested on this platform reaches a tier threshold, without revealing the total.

- `verify`: checks a proof.
- `claim`: signed by the investor; checks the platform's attestation of her committed total and the proof, then records her tier.
- `badge`: reads the recorded tier.
- `set_attester`: the platform's admin rotates the attestation key (limitation 6).

The circuit is in `zk/badge/circuits/investor_tier.circom`. The tier is not a regulatory investor status, and the phase 2 setup has a single contribution (limitation 6).
