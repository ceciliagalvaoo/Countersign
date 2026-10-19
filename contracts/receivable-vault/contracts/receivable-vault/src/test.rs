#![cfg(test)]

use super::*;
use soroban_sdk::{contract, contractimpl, symbol_short, testutils::Address as _, token, vec, Env, String};

/// Minimal stand-in for the FundToken contract: balances are set directly by the test
#[contract]
pub struct MockToken;

#[contractimpl]
impl MockToken {
    pub fn set_balance(env: Env, addr: Address, amount: i128) {
        let old: i128 = env.storage().persistent().get(&addr).unwrap_or(0);
        let supply: i128 = env.storage().instance().get(&symbol_short!("supply")).unwrap_or(0);
        env.storage().instance().set(&symbol_short!("supply"), &(supply - old + amount));
        env.storage().persistent().set(&addr, &amount);
    }
    pub fn balance(env: Env, addr: Address) -> i128 {
        env.storage().persistent().get(&addr).unwrap_or(0)
    }
    pub fn total_supply(env: Env) -> i128 {
        env.storage().instance().get(&symbol_short!("supply")).unwrap_or(0)
    }
}

struct Setup<'a> {
    env: Env,
    vault: ReceivableVaultClient<'a>,
    token: MockTokenClient<'a>,
    usdc: token::Client<'a>,
    consultant: Address,
    payer: Address,
}

fn s(env: &Env, v: &str) -> String {
    String::from_str(env, v)
}

fn setup<'a>() -> Setup<'a> {
    let env = Env::default();
    env.mock_all_auths();

    let token_id = env.register(MockToken, ());
    let token = MockTokenClient::new(&env, &token_id);
    let admin = Address::generate(&env);
    let consultant = Address::generate(&env);
    // Stellar Asset Contract standing in for USDC; the payer (fund wallet) holds 10,000
    let usdc_sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let usdc = token::Client::new(&env, &usdc_sac.address());
    let usdc_admin = token::StellarAssetClient::new(&env, &usdc_sac.address());
    let payer = Address::generate(&env);
    usdc_admin.mint(&payer, &10_000);

    let vault_id = env.register(ReceivableVault, (admin.clone(), token_id.clone(), usdc_sac.address()));
    let vault = ReceivableVaultClient::new(&env, &vault_id);
    vault.consultant_add(&consultant);

    Setup { env, vault, token, usdc, consultant, payer }
}

/// Submits and approves a fund, cedente and sacado, then registers receivable "R1" of 1000
fn register_receivable(t: &Setup) {
    let env = &t.env;
    t.vault.submit_fund(&t.consultant, &s(env, "F1"), &s(env, "Agro Fund"), &t.token.address);
    t.vault.submit_cedente(&t.consultant, &s(env, "C1"), &s(env, "Cedente"));
    t.vault.submit_sacado(&t.consultant, &s(env, "S1"), &s(env, "Sacado"));
    t.vault.approve_entity(&symbol_short!("fund"), &s(env, "F1"), &true);
    t.vault.approve_entity(&symbol_short!("sacado"), &s(env, "S1"), &true);

    t.vault.register_receivable(
        &s(env, "R1"),
        &s(env, "F1"),
        &s(env, "C1"),
        &s(env, "S1"),
        &1000,
        &1_900_000_000,
        &Address::generate(env),
    );
}

#[test]
fn full_receivable_lifecycle() {
    let t = setup();
    register_receivable(&t);
    assert_eq!(t.vault.get_receivables_count(), 1);

    // The payment really moves USDC from the payer into the vault
    t.vault.pay(&s(&t.env, "R1"), &t.payer, &1000);
    assert_eq!(t.vault.get_total_paid(), 1000);
    assert_eq!(t.usdc.balance(&t.vault.address), 1000);
    assert_eq!(t.usdc.balance(&t.payer), 9_000);

    let alice = Address::generate(&t.env);
    let bob = Address::generate(&t.env);
    t.token.set_balance(&alice, &300);
    t.token.set_balance(&bob, &700);
    t.vault.distribute(&s(&t.env, "R1"), &vec![&t.env, alice.clone(), bob.clone()]);

    // ...and the distribution really pays the shareholders pro rata
    assert_eq!(t.usdc.balance(&alice), 300);
    assert_eq!(t.usdc.balance(&bob), 700);
    assert_eq!(t.usdc.balance(&t.vault.address), 0);
    let r = t.vault.get_receivable(&s(&t.env, "R1"));
    assert!(matches!(r.status, ReceivableStatus::Distributed));
    assert_eq!(r.paid_amount, 1000);
}

#[test]
fn only_consultants_can_submit() {
    let t = setup();
    let stranger = Address::generate(&t.env);
    let result = t.vault.try_submit_cedente(&stranger, &s(&t.env, "C1"), &s(&t.env, "X"));
    assert_eq!(result, Err(Ok(VaultError::NotConsultant)));
}

#[test]
fn duplicate_submission_fails() {
    let t = setup();
    t.vault.submit_sacado(&t.consultant, &s(&t.env, "S1"), &s(&t.env, "Sacado"));
    let result = t.vault.try_submit_sacado(&t.consultant, &s(&t.env, "S1"), &s(&t.env, "Again"));
    assert_eq!(result, Err(Ok(VaultError::DuplicateId)));
}

#[test]
fn unknown_entity_kind_is_rejected() {
    let t = setup();
    let result = t.vault.try_approve_entity(&symbol_short!("other"), &s(&t.env, "X"), &true);
    assert_eq!(result, Err(Ok(VaultError::Invalid)));
}

#[test]
fn receivable_requires_approved_fund() {
    let t = setup();
    let env = &t.env;
    t.vault.submit_fund(&t.consultant, &s(env, "F1"), &s(env, "Agro Fund"), &t.token.address);
    t.vault.submit_cedente(&t.consultant, &s(env, "C1"), &s(env, "Cedente"));
    t.vault.submit_sacado(&t.consultant, &s(env, "S1"), &s(env, "Sacado"));

    let result = t.vault.try_register_receivable(
        &s(env, "R1"),
        &s(env, "F1"),
        &s(env, "C1"),
        &s(env, "S1"),
        &1000,
        &1_900_000_000,
        &Address::generate(env),
    );
    assert_eq!(result, Err(Ok(VaultError::BadStatus)));
}

#[test]
fn distribute_requires_paid_receivable_and_holders_with_balance() {
    let t = setup();
    register_receivable(&t);
    let alice = Address::generate(&t.env);

    let result = t.vault.try_distribute(&s(&t.env, "R1"), &vec![&t.env, alice.clone()]);
    assert_eq!(result, Err(Ok(VaultError::BadStatus)));

    t.vault.pay(&s(&t.env, "R1"), &t.payer, &1000);
    let result = t.vault.try_distribute(&s(&t.env, "R1"), &vec![&t.env, alice]);
    assert_eq!(result, Err(Ok(VaultError::Invalid)));
}

#[test]
fn paying_twice_fails() {
    let t = setup();
    register_receivable(&t);
    t.vault.pay(&s(&t.env, "R1"), &t.payer, &1000);
    let result = t.vault.try_pay(&s(&t.env, "R1"), &t.payer, &1000);
    assert_eq!(result, Err(Ok(VaultError::BadStatus)));
    assert_eq!(t.usdc.balance(&t.vault.address), 1000);
}

#[test]
fn distribution_must_include_every_holder() {
    let t = setup();
    register_receivable(&t);
    t.vault.pay(&s(&t.env, "R1"), &t.payer, &1000);
    let alice = Address::generate(&t.env);
    let bob = Address::generate(&t.env);
    t.token.set_balance(&alice, &300);
    t.token.set_balance(&bob, &700);

    // Skipping a holder would let the others take their share
    let result = t.vault.try_distribute(&s(&t.env, "R1"), &vec![&t.env, alice.clone()]);
    assert_eq!(result, Err(Ok(VaultError::Invalid)));
    // Listing a holder twice would pay them twice
    let result = t.vault.try_distribute(&s(&t.env, "R1"), &vec![&t.env, alice.clone(), alice.clone(), bob.clone()]);
    assert_eq!(result, Err(Ok(VaultError::DuplicateId)));
    assert_eq!(t.usdc.balance(&t.vault.address), 1000);
}

#[test]
fn rounding_residue_goes_to_largest_holder() {
    let t = setup();
    register_receivable(&t);
    t.vault.pay(&s(&t.env, "R1"), &t.payer, &1000);
    let a = Address::generate(&t.env);
    let b = Address::generate(&t.env);
    let c = Address::generate(&t.env);
    t.token.set_balance(&a, &1);
    t.token.set_balance(&b, &1);
    t.token.set_balance(&c, &2);
    t.vault.distribute(&s(&t.env, "R1"), &vec![&t.env, a.clone(), b.clone(), c.clone()]);
    // 1000 * 1/4 = 250, 250, 500: nothing left, all paid out
    assert_eq!(t.usdc.balance(&a) + t.usdc.balance(&b) + t.usdc.balance(&c), 1000);
    assert_eq!(t.usdc.balance(&t.vault.address), 0);

    // Uneven split: 3 holders with 1 share each over 1000 -> 333 + 333 + 334 (residue to the first largest)
    let t2 = setup();
    register_receivable(&t2);
    t2.vault.pay(&s(&t2.env, "R1"), &t2.payer, &1000);
    let x = Address::generate(&t2.env);
    let y = Address::generate(&t2.env);
    let z = Address::generate(&t2.env);
    for h in [&x, &y, &z] {
        t2.token.set_balance(h, &1);
    }
    t2.vault.distribute(&s(&t2.env, "R1"), &vec![&t2.env, x.clone(), y.clone(), z.clone()]);
    assert_eq!(t2.usdc.balance(&x), 334);
    assert_eq!(t2.usdc.balance(&y), 333);
    assert_eq!(t2.usdc.balance(&z), 333);
    assert_eq!(t2.usdc.balance(&t2.vault.address), 0);
}

#[test]
#[should_panic]
fn pay_requires_payer_auth() {
    let t = setup();
    register_receivable(&t);
    t.env.set_auths(&[]);
    t.vault.pay(&s(&t.env, "R1"), &t.payer, &1000);
}

#[test]
fn set_admin_transfers_control() {
    let t = setup();
    let new_admin = Address::generate(&t.env);
    t.vault.set_admin(&new_admin);
    assert_eq!(t.vault.get_admin(), new_admin);
}

#[test]
fn admin_registers_preapproved_entities_and_receivable() {
    let t = setup();
    let env = &t.env;
    t.vault.admin_register_fund(&s(env, "F9"), &s(env, "Admin Fund"), &t.token.address);
    t.vault.admin_register_entity(&symbol_short!("cedente"), &s(env, "C9"), &s(env, "Cedente"));
    t.vault.admin_register_entity(&symbol_short!("sacado"), &s(env, "S9"), &s(env, "Sacado"));
    assert!(t.vault.is_registered(&symbol_short!("fund"), &s(env, "F9")));
    assert!(!t.vault.is_registered(&symbol_short!("sacado"), &s(env, "nope")));
    assert_eq!(
        t.vault.try_admin_register_entity(&symbol_short!("sacado"), &s(env, "S9"), &s(env, "Again")),
        Err(Ok(VaultError::DuplicateId))
    );
    assert_eq!(
        t.vault.try_admin_register_entity(&symbol_short!("other"), &s(env, "X"), &s(env, "X")),
        Err(Ok(VaultError::Invalid))
    );

    // Approved on registration, so a receivable can be registered right away
    t.vault.register_receivable(
        &s(env, "R9"), &s(env, "F9"), &s(env, "C9"), &s(env, "S9"), &700, &1_900_000_000, &Address::generate(env),
    );
    assert_eq!(t.vault.get_receivables_count(), 1);
}

#[test]
#[should_panic]
fn admin_register_requires_admin_auth() {
    let t = setup();
    t.env.set_auths(&[]);
    t.vault.admin_register_entity(&symbol_short!("cedente"), &s(&t.env, "C1"), &s(&t.env, "X"));
}
