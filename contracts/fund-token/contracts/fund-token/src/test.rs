#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::{Address as _, Ledger, MuxedAddress as _}, Env, MuxedAddress, String};

fn setup(env: &Env) -> (FundTokenClient<'_>, Address) {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let contract_id = env.register(
        FundToken,
        (
            admin.clone(),
            String::from_str(env, "Agro Fund"),
            String::from_str(env, "AGRO"),
            1_000_000_i128,
        ),
    );
    (FundTokenClient::new(env, &contract_id), admin)
}

#[test]
fn constructor_sets_metadata() {
    let env = Env::default();
    let (client, admin) = setup(&env);

    assert_eq!(client.admin(), admin);
    assert_eq!(client.name(), String::from_str(&env, "Agro Fund"));
    assert_eq!(client.symbol(), String::from_str(&env, "AGRO"));
    assert_eq!(client.decimals(), 7);
    assert_eq!(client.max_supply(), 1_000_000);
    assert_eq!(client.total_supply(), 0);
    assert!(!client.is_paused());
}

#[test]
#[should_panic]
fn constructor_rejects_invalid_max_supply() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    env.register(
        FundToken,
        (admin, String::from_str(&env, "Agro Fund"), String::from_str(&env, "AGRO"), 0_i128),
    );
}

#[test]
fn set_admin_transfers_control() {
    let env = Env::default();
    let (client, _admin) = setup(&env);
    let new_admin = Address::generate(&env);

    client.set_admin(&new_admin);
    assert_eq!(client.admin(), new_admin);

    // The new admin can now manage the whitelist
    let alice = Address::generate(&env);
    client.whitelist_add(&alice);
    assert!(client.is_whitelisted(&alice));
}

#[test]
fn mint_and_transfer_between_whitelisted_holders() {
    let env = Env::default();
    let (client, _admin) = setup(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    client.whitelist_add(&alice);
    client.whitelist_add(&bob);
    client.mint(&alice, &500);
    assert_eq!(client.balance(&alice), 500);
    assert_eq!(client.total_supply(), 500);

    client.transfer(&alice, &MuxedAddress::from(&bob), &200);
    assert_eq!(client.balance(&alice), 300);
    assert_eq!(client.balance(&bob), 200);
}

#[test]
fn mint_requires_whitelist() {
    let env = Env::default();
    let (client, _admin) = setup(&env);
    let alice = Address::generate(&env);

    assert_eq!(client.try_mint(&alice, &1), Err(Ok(TokenError::NotWhitelisted)));

    client.whitelist_add(&alice);
    client.whitelist_remove(&alice);
    assert!(!client.is_whitelisted(&alice));
    assert_eq!(client.try_mint(&alice, &1), Err(Ok(TokenError::NotWhitelisted)));
}

#[test]
fn mint_respects_max_supply() {
    let env = Env::default();
    let (client, _admin) = setup(&env);
    let alice = Address::generate(&env);
    client.whitelist_add(&alice);

    client.mint(&alice, &1_000_000);
    assert_eq!(client.try_mint(&alice, &1), Err(Ok(TokenError::SupplyOverflow)));
}

#[test]
fn transfer_fails_without_balance() {
    let env = Env::default();
    let (client, _admin) = setup(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    client.whitelist_add(&bob);

    assert_eq!(
        client.try_transfer(&alice, &MuxedAddress::from(&bob), &1),
        Err(Ok(TokenError::InsufficientBalance))
    );
}

#[test]
fn pause_blocks_mint_and_transfer() {
    let env = Env::default();
    let (client, _admin) = setup(&env);
    let alice = Address::generate(&env);
    client.whitelist_add(&alice);
    client.mint(&alice, &10);

    client.set_pause(&true);
    assert!(client.is_paused());
    assert_eq!(client.try_mint(&alice, &1), Err(Ok(TokenError::Paused)));
    assert_eq!(client.try_transfer(&alice, &MuxedAddress::from(&alice), &1), Err(Ok(TokenError::Paused)));
}

#[test]
#[should_panic]
fn whitelist_add_requires_admin_auth() {
    let env = Env::default();
    let (client, _admin) = setup(&env);

    // Drop the mocked auths: the admin did not sign this call
    env.set_auths(&[]);
    client.whitelist_add(&Address::generate(&env));
}

#[test]
fn approve_and_transfer_from_respect_allowance_and_whitelist() {
    let env = Env::default();
    let (client, _admin) = setup(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let spender = Address::generate(&env);
    let outsider = Address::generate(&env);
    client.whitelist_add(&alice);
    client.whitelist_add(&bob);
    client.mint(&alice, &100);

    let until = env.ledger().sequence() + 100;
    client.approve(&alice, &spender, &60, &until);
    assert_eq!(client.allowance(&alice, &spender), 60);

    client.transfer_from(&spender, &alice, &bob, &40);
    assert_eq!(client.balance(&bob), 40);
    assert_eq!(client.allowance(&alice, &spender), 20);

    assert_eq!(client.try_transfer_from(&spender, &alice, &bob, &21), Err(Ok(TokenError::InsufficientAllowance)));
    // Shares can never reach a non-KYC account, not even through an allowance
    assert_eq!(client.try_transfer_from(&spender, &alice, &outsider, &1), Err(Ok(TokenError::NotWhitelisted)));
}

#[test]
fn allowance_expires() {
    let env = Env::default();
    let (client, _admin) = setup(&env);
    let alice = Address::generate(&env);
    let spender = Address::generate(&env);

    let until = env.ledger().sequence() + 10;
    client.approve(&alice, &spender, &5, &until);
    env.ledger().with_mut(|l| l.sequence_number += 11);
    assert_eq!(client.allowance(&alice, &spender), 0);
    assert_eq!(
        client.try_approve(&alice, &spender, &5, &(env.ledger().sequence() - 1)),
        Err(Ok(TokenError::InvalidExpiration))
    );
    // Beyond the network's max TTL: a clear error instead of a host trap
    let too_far = env.ledger().sequence() + env.storage().max_ttl() + 1;
    assert_eq!(client.try_approve(&alice, &spender, &5, &too_far), Err(Ok(TokenError::InvalidExpiration)));
    let max_ok = env.ledger().sequence() + env.storage().max_ttl();
    client.approve(&alice, &spender, &5, &max_ok);
    assert_eq!(client.allowance(&alice, &spender), 5);
}

#[test]
fn burn_and_burn_from_reduce_supply() {
    let env = Env::default();
    let (client, _admin) = setup(&env);
    let alice = Address::generate(&env);
    let spender = Address::generate(&env);
    client.whitelist_add(&alice);
    client.mint(&alice, &100);

    client.burn(&alice, &30);
    assert_eq!(client.balance(&alice), 70);
    assert_eq!(client.total_supply(), 70);

    client.approve(&alice, &spender, &20, &(env.ledger().sequence() + 10));
    client.burn_from(&spender, &alice, &20);
    assert_eq!(client.balance(&alice), 50);
    assert_eq!(client.total_supply(), 50);
    assert_eq!(client.try_burn(&alice, &51), Err(Ok(TokenError::InsufficientBalance)));
}

#[test]
fn transfer_to_muxed_address_credits_the_base_account() {
    let env = Env::default();
    let (client, _admin) = setup(&env);
    let alice = Address::generate(&env);
    // Muxed ids only exist for regular (G...) accounts
    let muxed = MuxedAddress::new(MuxedAddress::generate(&env).address(), 42);
    let bob = muxed.address();
    client.whitelist_add(&alice);
    client.whitelist_add(&bob);
    client.mint(&alice, &10);

    client.transfer(&alice, &muxed, &4);
    assert_eq!(client.balance(&bob), 4);
}
