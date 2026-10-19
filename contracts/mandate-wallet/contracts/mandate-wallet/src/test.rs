#![cfg(test)]
//! Every rule has a test that passes and one that refuses.
//! Refusal tests never use `mock_all_auths`: each call only carries the auth of the address named in it.

extern crate std;

use super::*;
use soroban_sdk::{
    contract, contracterror, contractimpl, map, symbol_short,
    testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation, Events as _, Ledger, MockAuth, MockAuthInvoke},
    token, vec, Address, BytesN, Env, Event, IntoVal, MuxedAddress, Symbol, Val, Vec,
};

// -------- Stand-in for the FundToken: units only reach whitelisted accounts --------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum UnitsError {
    NotWhitelisted = 4,
    InsufficientBalance = 5,
}

#[contract]
pub struct MockUnits;

#[contractimpl]
impl MockUnits {
    pub fn whitelist_add(env: Env, addr: Address) {
        env.storage().persistent().set(&(symbol_short!("wl"), addr), &true);
    }
    pub fn mint(env: Env, to: Address, amount: i128) {
        let b = Self::balance(env.clone(), to.clone());
        env.storage().persistent().set(&(symbol_short!("bal"), to), &(b + amount));
    }
    pub fn balance(env: Env, addr: Address) -> i128 {
        env.storage().persistent().get(&(symbol_short!("bal"), addr)).unwrap_or(0)
    }
    pub fn transfer(env: Env, from: Address, to: MuxedAddress, amount: i128) -> Result<(), UnitsError> {
        from.require_auth();
        let to = to.address();
        let wl: bool = env.storage().persistent().get(&(symbol_short!("wl"), to.clone())).unwrap_or(false);
        if !wl {
            return Err(UnitsError::NotWhitelisted);
        }
        let fb = Self::balance(env.clone(), from.clone());
        if fb < amount {
            return Err(UnitsError::InsufficientBalance);
        }
        env.storage().persistent().set(&(symbol_short!("bal"), from), &(fb - amount));
        let tb = Self::balance(env.clone(), to.clone());
        env.storage().persistent().set(&(symbol_short!("bal"), to), &(tb + amount));
        Ok(())
    }
}

// -------- Setup --------

const PER_TX: i128 = 100;
const PERIOD_CAP: i128 = 250;
const PERIOD_SECS: u64 = 86_400;
const FUND_CAP: i128 = 1_000;
const T0: u64 = 1_800_000_000;

struct Setup<'a> {
    env: Env,
    wallet: MandateWalletClient<'a>,
    usdc: token::Client<'a>,
    units: MockUnitsClient<'a>,
    owner: Address,
    agent: Address,
    fund: Address,
}

fn hash(env: &Env, b: u8) -> BytesN<32> {
    BytesN::from_array(env, &[b; 32])
}

fn setup<'a>() -> Setup<'a> {
    let env = Env::default();
    env.ledger().set_timestamp(T0);
    let owner = Address::generate(&env);
    let agent = Address::generate(&env);
    let fund = Address::generate(&env);

    let usdc_sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let usdc = token::Client::new(&env, &usdc_sac.address());
    let units_id = env.register(MockUnits, ());
    let units = MockUnitsClient::new(&env, &units_id);

    let wallet_id = env.register(
        MandateWallet,
        (owner.clone(), agent.clone(), usdc_sac.address(), PER_TX, PERIOD_CAP, PERIOD_SECS, hash(&env, 1)),
    );
    let wallet = MandateWalletClient::new(&env, &wallet_id);

    // Fixture only: fund the wallet and allowlist one fund, then switch auth enforcement back on
    env.mock_all_auths();
    token::StellarAssetClient::new(&env, &usdc_sac.address()).mint(&wallet_id, &10_000);
    wallet.allow_fund(&fund, &units_id, &FUND_CAP);
    env.set_auths(&[]);

    Setup { env, wallet, usdc, units, owner, agent, fund }
}

/// Only `who` signs exactly this call on the wallet (no sub invocations)
fn sign(t: &Setup, who: &Address, fn_name: &str, args: Vec<Val>) {
    t.env.mock_auths(&[MockAuth {
        address: who,
        invoke: &MockAuthInvoke { contract: &t.wallet.address, fn_name, args, sub_invokes: &[] },
    }]);
}

fn buy(t: &Setup, decision: &BytesN<32>, fund: &Address, amount: i128) -> Result<(), Error> {
    sign(t, &t.agent, "subscribe", (decision.clone(), fund.clone(), amount).into_val(&t.env));
    match t.wallet.try_subscribe(decision, fund, &amount) {
        Ok(_) => Ok(()),
        Err(Ok(e)) => Err(e),
        Err(Err(e)) => panic!("unexpected host error: {:?}", e),
    }
}

fn only_signer(t: &Setup, who: &Address, fn_name: &str, args: Vec<Val>) -> std::vec::Vec<(Address, AuthorizedInvocation)> {
    std::vec![(
        who.clone(),
        AuthorizedInvocation {
            function: AuthorizedFunction::Contract((t.wallet.address.clone(), Symbol::new(&t.env, fn_name), args)),
            sub_invocations: std::vec![],
        },
    )]
}

// -------- T1, T2: subscribe --------

#[test]
fn t01_subscribe_pays_the_fund_marks_decision_and_emits_event() {
    let t = setup();
    let d = hash(&t.env, 7);
    assert!(!t.wallet.decision_used(&d));

    sign(&t, &t.agent, "subscribe", (d.clone(), t.fund.clone(), 80_i128).into_val(&t.env));
    t.wallet.subscribe(&d, &t.fund, &80);

    // Events of this invocation: the USDC transfer (SAC) and our Subscribe
    let all = t.env.events().all();
    assert_eq!(all.events().len(), 2);
    let ours = all.filter_by_contract(&t.wallet.address);
    assert_eq!(ours, [Subscribe { fund_wallet: t.fund.clone(), decision: d.clone(), amount: 80 }.to_xdr(&t.env, &t.wallet.address)]);
    // Same event, spelled out: topics ["subscribe", fund_wallet], data map {amount, decision}
    let amount_val: Val = 80_i128.into_val(&t.env);
    let decision_val: Val = d.clone().into_val(&t.env);
    let data_map: soroban_sdk::Map<Symbol, Val> =
        map![&t.env, (symbol_short!("amount"), amount_val), (Symbol::new(&t.env, "decision"), decision_val)];
    let data: Val = data_map.into_val(&t.env);
    assert_eq!(
        ours,
        vec![&t.env, (t.wallet.address.clone(), (Symbol::new(&t.env, "subscribe"), t.fund.clone()).into_val(&t.env), data)]
    );

    assert_eq!(t.usdc.balance(&t.fund), 80);
    assert_eq!(t.usdc.balance(&t.wallet.address), 10_000 - 80);
    assert!(t.wallet.decision_used(&d));
    assert_eq!(t.wallet.spent_in_period(), 80);
    assert_eq!(t.wallet.fund(&t.fund).unwrap().spent, 80);
}

#[test]
fn t02_subscribe_is_authorized_by_the_agent_only_with_exact_args() {
    let t = setup();
    let d = hash(&t.env, 7);
    sign(&t, &t.agent, "subscribe", (d.clone(), t.fund.clone(), 50_i128).into_val(&t.env));
    t.wallet.subscribe(&d, &t.fund, &50);
    assert_eq!(t.env.auths(), only_signer(&t, &t.agent, "subscribe", (d.clone(), t.fund.clone(), 50_i128).into_val(&t.env)));

    // Refusal: the owner (or anyone else) cannot call subscribe in the agent's place
    let d2 = hash(&t.env, 8);
    sign(&t, &t.owner, "subscribe", (d2.clone(), t.fund.clone(), 50_i128).into_val(&t.env));
    assert!(matches!(t.wallet.try_subscribe(&d2, &t.fund, &50), Err(Err(_))));
    // Refusal: the agent signed a different amount than the one submitted
    sign(&t, &t.agent, "subscribe", (d2.clone(), t.fund.clone(), 10_i128).into_val(&t.env));
    assert!(matches!(t.wallet.try_subscribe(&d2, &t.fund, &50), Err(Err(_))));
    assert!(!t.wallet.decision_used(&d2));
    assert_eq!(t.usdc.balance(&t.fund), 50);
}

// -------- T3 to T8: subscribe refusals --------

#[test]
fn t03_fund_outside_allowlist_is_refused() {
    let t = setup();
    let stranger = Address::generate(&t.env);
    assert_eq!(buy(&t, &hash(&t.env, 1), &stranger, 10), Err(Error::FundNotAllowed));
    assert_eq!(t.usdc.balance(&stranger), 0);

    // Allowed fund passes, then after disallow_fund it is refused
    assert_eq!(buy(&t, &hash(&t.env, 2), &t.fund, 10), Ok(()));
    sign(&t, &t.owner, "disallow_fund", (t.fund.clone(),).into_val(&t.env));
    t.wallet.disallow_fund(&t.fund);
    assert_eq!(t.wallet.fund(&t.fund), None);
    assert_eq!(buy(&t, &hash(&t.env, 3), &t.fund, 10), Err(Error::FundNotAllowed));
    // Removing a fund that is not there is refused too
    sign(&t, &t.owner, "disallow_fund", (t.fund.clone(),).into_val(&t.env));
    assert_eq!(t.wallet.try_disallow_fund(&t.fund), Err(Ok(Error::FundNotAllowed)));
}

#[test]
fn t04_amount_above_per_tx_cap_is_refused() {
    let t = setup();
    assert_eq!(buy(&t, &hash(&t.env, 1), &t.fund, PER_TX + 1), Err(Error::OverTxCap));
    assert_eq!(buy(&t, &hash(&t.env, 2), &t.fund, PER_TX), Ok(()));
    assert_eq!(t.usdc.balance(&t.fund), PER_TX);
}

#[test]
fn t04b_amount_zero_or_negative_is_refused() {
    let t = setup();
    assert_eq!(buy(&t, &hash(&t.env, 1), &t.fund, 0), Err(Error::InvalidAmount));
    assert_eq!(buy(&t, &hash(&t.env, 2), &t.fund, -5), Err(Error::InvalidAmount));
    assert_eq!(buy(&t, &hash(&t.env, 3), &t.fund, 1), Ok(()));
}

#[test]
fn t05_period_cap_with_timestamp_window() {
    let t = setup();
    // 100 + 100 + 50 = 250 = PERIOD_CAP (allowed), one more unit is not
    assert_eq!(buy(&t, &hash(&t.env, 1), &t.fund, 100), Ok(()));
    assert_eq!(buy(&t, &hash(&t.env, 2), &t.fund, 100), Ok(()));
    assert_eq!(buy(&t, &hash(&t.env, 3), &t.fund, 60), Err(Error::OverPeriodCap));
    assert_eq!(buy(&t, &hash(&t.env, 4), &t.fund, 50), Ok(()));
    assert_eq!(buy(&t, &hash(&t.env, 5), &t.fund, 1), Err(Error::OverPeriodCap));
    assert_eq!(t.wallet.spent_in_period(), 250);

    // One second before the window ends: still refused
    t.env.ledger().set_timestamp(T0 + PERIOD_SECS - 1);
    assert_eq!(buy(&t, &hash(&t.env, 6), &t.fund, 1), Err(Error::OverPeriodCap));

    // Window over: the view already reports 0 and a new purchase opens a new window starting now
    let t1 = T0 + PERIOD_SECS;
    t.env.ledger().set_timestamp(t1);
    assert_eq!(t.wallet.spent_in_period(), 0);
    assert_eq!(buy(&t, &hash(&t.env, 7), &t.fund, 100), Ok(()));
    assert_eq!(t.wallet.spent_in_period(), 100);
    // The new window started at t1, not at T0 + 2 * PERIOD_SECS minus anything
    t.env.ledger().set_timestamp(t1 + PERIOD_SECS - 1);
    assert_eq!(t.wallet.spent_in_period(), 100);
    assert_eq!(buy(&t, &hash(&t.env, 8), &t.fund, 100), Ok(()));
    assert_eq!(buy(&t, &hash(&t.env, 9), &t.fund, 60), Err(Error::OverPeriodCap));
}

#[test]
fn t06_cumulative_fund_cap_is_refused_and_preserved_on_update() {
    let t = setup();
    // Fund cap 120 for this test (per_tx 100, period 250)
    sign(&t, &t.owner, "allow_fund", (t.fund.clone(), t.units.address.clone(), 120_i128).into_val(&t.env));
    t.wallet.allow_fund(&t.fund, &t.units.address, &120);
    assert_eq!(buy(&t, &hash(&t.env, 1), &t.fund, 100), Ok(()));
    assert_eq!(buy(&t, &hash(&t.env, 2), &t.fund, 30), Err(Error::OverFundCap));
    assert_eq!(buy(&t, &hash(&t.env, 3), &t.fund, 20), Ok(()));
    assert_eq!(buy(&t, &hash(&t.env, 4), &t.fund, 1), Err(Error::OverFundCap));

    // Raising the cap keeps what was already spent
    sign(&t, &t.owner, "allow_fund", (t.fund.clone(), t.units.address.clone(), 200_i128).into_val(&t.env));
    t.wallet.allow_fund(&t.fund, &t.units.address, &200);
    assert_eq!(t.wallet.fund(&t.fund), Some(FundEntry { token: t.units.address.clone(), cap: 200, spent: 120 }));
    t.env.ledger().set_timestamp(T0 + PERIOD_SECS);
    assert_eq!(buy(&t, &hash(&t.env, 5), &t.fund, 81), Err(Error::OverFundCap));
    assert_eq!(buy(&t, &hash(&t.env, 6), &t.fund, 80), Ok(()));
}

#[test]
fn t07_reused_decision_is_refused() {
    let t = setup();
    let d = hash(&t.env, 9);
    assert_eq!(buy(&t, &d, &t.fund, 10), Ok(()));
    assert_eq!(buy(&t, &d, &t.fund, 10), Err(Error::DecisionUsed));

    // Also for another allowlisted fund
    let other = Address::generate(&t.env);
    sign(&t, &t.owner, "allow_fund", (other.clone(), t.units.address.clone(), 500_i128).into_val(&t.env));
    t.wallet.allow_fund(&other, &t.units.address, &500);
    assert_eq!(buy(&t, &d, &other, 10), Err(Error::DecisionUsed));
    assert_eq!(buy(&t, &hash(&t.env, 10), &other, 10), Ok(()));
    assert_eq!(t.usdc.balance(&t.fund), 10);
}

#[test]
fn t08_revoked_agent_is_refused_and_set_agent_reenables() {
    let t = setup();
    sign(&t, &t.owner, "revoke_agent", ().into_val(&t.env));
    t.wallet.revoke_agent();
    assert!(t.wallet.is_revoked());
    // AgentRevoked comes first, even with an otherwise invalid amount
    assert_eq!(buy(&t, &hash(&t.env, 1), &t.fund, 10), Err(Error::AgentRevoked));
    assert_eq!(buy(&t, &hash(&t.env, 1), &t.fund, 0), Err(Error::AgentRevoked));

    let new_agent = Address::generate(&t.env);
    sign(&t, &t.owner, "set_agent", (new_agent.clone(),).into_val(&t.env));
    t.wallet.set_agent(&new_agent);
    assert!(!t.wallet.is_revoked());
    assert_eq!(t.wallet.agent(), new_agent);

    // The old agent key no longer works
    let d = hash(&t.env, 2);
    sign(&t, &t.agent, "subscribe", (d.clone(), t.fund.clone(), 10_i128).into_val(&t.env));
    assert!(matches!(t.wallet.try_subscribe(&d, &t.fund, &10), Err(Err(_))));
    // The new one does
    sign(&t, &new_agent, "subscribe", (d.clone(), t.fund.clone(), 10_i128).into_val(&t.env));
    t.wallet.subscribe(&d, &t.fund, &10);
    assert_eq!(t.usdc.balance(&t.fund), 10);
}

#[test]
fn t08b_refusal_order_matches_the_spec() {
    let t = setup();
    let used = hash(&t.env, 1);
    assert_eq!(buy(&t, &used, &t.fund, 10), Ok(()));
    let stranger = Address::generate(&t.env);
    // InvalidAmount before DecisionUsed, DecisionUsed before FundNotAllowed, FundNotAllowed before OverTxCap
    assert_eq!(buy(&t, &used, &stranger, 0), Err(Error::InvalidAmount));
    assert_eq!(buy(&t, &used, &stranger, PER_TX + 1), Err(Error::DecisionUsed));
    assert_eq!(buy(&t, &hash(&t.env, 2), &stranger, PER_TX + 1), Err(Error::FundNotAllowed));
}

// -------- T9, T10: owner functions --------

#[test]
fn t09_agent_cannot_call_owner_functions() {
    let t = setup();
    let env = &t.env;
    let new_hash = hash(env, 2);
    let other = Address::generate(env);
    for who in [t.agent.clone(), Address::generate(env)] {
        sign(&t, &who, "set_limits", (1_000_i128, 10_000_i128, 1_u64, new_hash.clone()).into_val(env));
        assert!(matches!(t.wallet.try_set_limits(&1_000, &10_000, &1, &new_hash), Err(Err(_))));
        sign(&t, &who, "allow_fund", (other.clone(), t.units.address.clone(), 1_000_000_i128).into_val(env));
        assert!(matches!(t.wallet.try_allow_fund(&other, &t.units.address, &1_000_000), Err(Err(_))));
        sign(&t, &who, "disallow_fund", (t.fund.clone(),).into_val(env));
        assert!(matches!(t.wallet.try_disallow_fund(&t.fund), Err(Err(_))));
        sign(&t, &who, "revoke_agent", ().into_val(env));
        assert!(matches!(t.wallet.try_revoke_agent(), Err(Err(_))));
        sign(&t, &who, "set_agent", (other.clone(),).into_val(env));
        assert!(matches!(t.wallet.try_set_agent(&other), Err(Err(_))));
        sign(&t, &who, "withdraw", (10_i128,).into_val(env));
        assert!(matches!(t.wallet.try_withdraw(&10), Err(Err(_))));
        sign(&t, &who, "withdraw_units", (t.units.address.clone(), 1_i128).into_val(env));
        assert!(matches!(t.wallet.try_withdraw_units(&t.units.address, &1), Err(Err(_))));
    }
    // Nothing changed
    assert_eq!(t.wallet.limits(), Limits { per_tx_cap: PER_TX, period_cap: PERIOD_CAP, period_secs: PERIOD_SECS });
    assert_eq!(t.wallet.mandate_hash(), hash(env, 1));
    assert_eq!(t.wallet.fund(&other), None);
    assert!(t.wallet.fund(&t.fund).is_some());
    assert!(!t.wallet.is_revoked());
    assert_eq!(t.wallet.agent(), t.agent);
    assert_eq!(t.usdc.balance(&t.wallet.address), 10_000);
    // And the agent still cannot pay a fund it tried to add
    assert_eq!(buy(&t, &hash(env, 3), &other, 10), Err(Error::FundNotAllowed));
}

#[test]
fn t10_owner_functions_are_authorized_by_the_owner_only() {
    let t = setup();
    let env = &t.env;
    let h2 = hash(env, 2);
    let other = Address::generate(env);
    let new_agent = Address::generate(env);

    let args: Vec<Val> = (200_i128, 400_i128, 3_600_u64, h2.clone()).into_val(env);
    sign(&t, &t.owner, "set_limits", args.clone());
    t.wallet.set_limits(&200, &400, &3_600, &h2);
    assert_eq!(env.auths(), only_signer(&t, &t.owner, "set_limits", args));
    assert_eq!(t.wallet.limits(), Limits { per_tx_cap: 200, period_cap: 400, period_secs: 3_600 });
    assert_eq!(t.wallet.mandate_hash(), h2);

    let args: Vec<Val> = (other.clone(), t.units.address.clone(), 300_i128).into_val(env);
    sign(&t, &t.owner, "allow_fund", args.clone());
    t.wallet.allow_fund(&other, &t.units.address, &300);
    assert_eq!(env.auths(), only_signer(&t, &t.owner, "allow_fund", args));
    assert_eq!(t.wallet.fund(&other), Some(FundEntry { token: t.units.address.clone(), cap: 300, spent: 0 }));

    let args: Vec<Val> = (other.clone(),).into_val(env);
    sign(&t, &t.owner, "disallow_fund", args.clone());
    t.wallet.disallow_fund(&other);
    assert_eq!(env.auths(), only_signer(&t, &t.owner, "disallow_fund", args));

    sign(&t, &t.owner, "revoke_agent", ().into_val(env));
    t.wallet.revoke_agent();
    assert_eq!(env.auths(), only_signer(&t, &t.owner, "revoke_agent", ().into_val(env)));

    let args: Vec<Val> = (new_agent.clone(),).into_val(env);
    sign(&t, &t.owner, "set_agent", args.clone());
    t.wallet.set_agent(&new_agent);
    assert_eq!(env.auths(), only_signer(&t, &t.owner, "set_agent", args));

    let args: Vec<Val> = (25_i128,).into_val(env);
    sign(&t, &t.owner, "withdraw", args.clone());
    t.wallet.withdraw(&25);
    assert_eq!(env.auths(), only_signer(&t, &t.owner, "withdraw", args));

    t.units.mint(&t.wallet.address, &5);
    t.units.whitelist_add(&t.owner);
    let args: Vec<Val> = (t.units.address.clone(), 5_i128).into_val(env);
    sign(&t, &t.owner, "withdraw_units", args.clone());
    t.wallet.withdraw_units(&t.units.address, &5);
    assert_eq!(env.auths(), only_signer(&t, &t.owner, "withdraw_units", args));
}

#[test]
fn t10b_owner_config_events() {
    let t = setup();
    let env = &t.env;
    let h2 = hash(env, 2);
    let other = Address::generate(env);
    let w = &t.wallet.address;

    sign(&t, &t.owner, "set_limits", (200_i128, 400_i128, 3_600_u64, h2.clone()).into_val(env));
    t.wallet.set_limits(&200, &400, &3_600, &h2);
    assert_eq!(env.events().all(), [LimitsSet { per_tx_cap: 200, period_cap: 400, period_secs: 3_600, mandate_hash: h2 }.to_xdr(env, w)]);

    sign(&t, &t.owner, "allow_fund", (other.clone(), t.units.address.clone(), 300_i128).into_val(env));
    t.wallet.allow_fund(&other, &t.units.address, &300);
    assert_eq!(env.events().all(), [AllowFund { fund_wallet: other.clone(), fund_token: t.units.address.clone(), cap: 300 }.to_xdr(env, w)]);

    sign(&t, &t.owner, "disallow_fund", (other.clone(),).into_val(env));
    t.wallet.disallow_fund(&other);
    assert_eq!(env.events().all(), [DisallowFund { fund_wallet: other.clone() }.to_xdr(env, w)]);

    sign(&t, &t.owner, "revoke_agent", ().into_val(env));
    t.wallet.revoke_agent();
    assert_eq!(env.events().all(), [Revoke {}.to_xdr(env, w)]);

    sign(&t, &t.owner, "set_agent", (other.clone(),).into_val(env));
    t.wallet.set_agent(&other);
    assert_eq!(env.events().all(), [SetAgent { agent: other.clone() }.to_xdr(env, w)]);

    sign(&t, &t.owner, "withdraw", (25_i128,).into_val(env));
    t.wallet.withdraw(&25);
    assert_eq!(env.events().all().filter_by_contract(w), [Withdraw { amount: 25 }.to_xdr(env, w)]);
}

// -------- T11: withdraw --------

#[test]
fn t11_withdraw_goes_only_to_the_owner() {
    let t = setup();
    sign(&t, &t.owner, "withdraw", (400_i128,).into_val(&t.env));
    t.wallet.withdraw(&400);
    assert_eq!(t.usdc.balance(&t.owner), 400);
    assert_eq!(t.usdc.balance(&t.wallet.address), 10_000 - 400);

    sign(&t, &t.owner, "withdraw", (0_i128,).into_val(&t.env));
    assert_eq!(t.wallet.try_withdraw(&0), Err(Ok(Error::InvalidAmount)));
    // More than the balance: the USDC contract refuses, nothing moves
    sign(&t, &t.owner, "withdraw", (1_000_000_i128,).into_val(&t.env));
    assert!(t.wallet.try_withdraw(&1_000_000).is_err());
    assert_eq!(t.usdc.balance(&t.owner), 400);
}

#[test]
fn t11b_withdraw_units_goes_only_to_the_owner_and_needs_her_whitelisted() {
    let t = setup();
    t.units.mint(&t.wallet.address, &30);

    // Owner not whitelisted on the fund token: the token refuses (its own error), nothing moves
    sign(&t, &t.owner, "withdraw_units", (t.units.address.clone(), 10_i128).into_val(&t.env));
    assert!(t.wallet.try_withdraw_units(&t.units.address, &10).is_err());
    assert_eq!(t.units.balance(&t.wallet.address), 30);

    t.units.whitelist_add(&t.owner);
    sign(&t, &t.owner, "withdraw_units", (t.units.address.clone(), 10_i128).into_val(&t.env));
    t.wallet.withdraw_units(&t.units.address, &10);
    assert_eq!(t.units.balance(&t.owner), 10);
    assert_eq!(t.units.balance(&t.wallet.address), 20);

    sign(&t, &t.owner, "withdraw_units", (t.units.address.clone(), -1_i128).into_val(&t.env));
    assert_eq!(t.wallet.try_withdraw_units(&t.units.address, &-1), Err(Ok(Error::InvalidAmount)));
}

// -------- T12: invalid configuration --------

#[test]
fn t12_constructor_accepts_valid_config_and_reports_it() {
    let t = setup();
    assert_eq!(t.wallet.owner(), t.owner);
    assert_eq!(t.wallet.agent(), t.agent);
    assert!(!t.wallet.is_revoked());
    assert_eq!(t.wallet.limits(), Limits { per_tx_cap: PER_TX, period_cap: PERIOD_CAP, period_secs: PERIOD_SECS });
    assert_eq!(t.wallet.mandate_hash(), hash(&t.env, 1));
    assert_eq!(t.wallet.spent_in_period(), 0);
}

fn register_with(per_tx: i128, period_cap: i128, period_secs: u64, same_agent: bool) {
    let env = Env::default();
    let owner = Address::generate(&env);
    let agent = if same_agent { owner.clone() } else { Address::generate(&env) };
    let usdc = env.register_stellar_asset_contract_v2(Address::generate(&env)).address();
    env.register(MandateWallet, (owner, agent, usdc, per_tx, period_cap, period_secs, hash(&env, 1)));
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn t12a_constructor_rejects_zero_per_tx_cap() {
    register_with(0, 100, 60, false);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn t12b_constructor_rejects_period_cap_below_per_tx_cap() {
    register_with(100, 99, 60, false);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn t12c_constructor_rejects_zero_period() {
    register_with(100, 100, 0, false);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn t12d_constructor_rejects_owner_as_agent() {
    register_with(100, 100, 60, true);
}

#[test]
fn t12e_owner_functions_reject_invalid_config() {
    let t = setup();
    let env = &t.env;
    let h = hash(env, 2);
    for (a, b, c) in [(0_i128, 100_i128, 60_u64), (100, 99, 60), (100, 100, 0)] {
        sign(&t, &t.owner, "set_limits", (a, b, c, h.clone()).into_val(env));
        assert_eq!(t.wallet.try_set_limits(&a, &b, &c, &h), Err(Ok(Error::InvalidConfig)));
    }
    let wallet_addr = t.wallet.address.clone();
    for target in [t.owner.clone(), t.agent.clone(), wallet_addr.clone()] {
        sign(&t, &t.owner, "allow_fund", (target.clone(), t.units.address.clone(), 100_i128).into_val(env));
        assert_eq!(t.wallet.try_allow_fund(&target, &t.units.address, &100), Err(Ok(Error::InvalidConfig)));
    }
    let other = Address::generate(env);
    sign(&t, &t.owner, "allow_fund", (other.clone(), t.units.address.clone(), 0_i128).into_val(env));
    assert_eq!(t.wallet.try_allow_fund(&other, &t.units.address, &0), Err(Ok(Error::InvalidConfig)));
    for target in [t.owner.clone(), wallet_addr] {
        sign(&t, &t.owner, "set_agent", (target.clone(),).into_val(env));
        assert_eq!(t.wallet.try_set_agent(&target), Err(Ok(Error::InvalidConfig)));
    }
    assert_eq!(t.wallet.limits().per_tx_cap, PER_TX);
    assert_eq!(t.wallet.agent(), t.agent);
}

// -------- T13: nobody moves the balance from outside --------

#[test]
fn t13_nobody_can_move_the_wallet_balance_directly() {
    let t = setup();
    let env = &t.env;
    let thief = Address::generate(env);
    let w = t.wallet.address.clone();
    t.units.mint(&w, &30);
    t.units.whitelist_add(&thief);

    // No auth at all
    env.set_auths(&[]);
    assert!(t.usdc.try_transfer(&w, &thief, &100).is_err());
    assert!(t.units.try_transfer(&w, &MuxedAddress::from(&thief), &10).is_err());

    // The thief signs for himself: still the wallet's authorization is missing
    env.mock_auths(&[MockAuth {
        address: &thief,
        invoke: &MockAuthInvoke { contract: &t.usdc.address, fn_name: "transfer", args: (w.clone(), thief.clone(), 100_i128).into_val(env), sub_invokes: &[] },
    }]);
    assert!(t.usdc.try_transfer(&w, &thief, &100).is_err());
    // Allowance route: approve(from = wallet) also needs the wallet's authorization
    env.set_auths(&[]);
    assert!(t.usdc.try_approve(&w, &thief, &100, &(env.ledger().sequence() + 100)).is_err());
    // The agent key cannot do it either
    env.mock_auths(&[MockAuth {
        address: &t.agent,
        invoke: &MockAuthInvoke { contract: &t.usdc.address, fn_name: "transfer", args: (w.clone(), t.agent.clone(), 100_i128).into_val(env), sub_invokes: &[] },
    }]);
    assert!(t.usdc.try_transfer(&w, &t.agent, &100).is_err());

    assert_eq!(t.usdc.balance(&w), 10_000);
    assert_eq!(t.usdc.balance(&thief), 0);
    assert_eq!(t.units.balance(&w), 30);
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn t13b_direct_transfer_from_the_wallet_fails_with_an_auth_error() {
    // The wallet has no `__check_auth`, so its authorization can only come from itself as the caller
    let t = setup();
    let thief = Address::generate(&t.env);
    t.env.set_auths(&[]);
    t.usdc.transfer(&t.wallet.address, &thief, &100);
}
