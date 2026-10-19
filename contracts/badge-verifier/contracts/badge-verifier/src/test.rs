#![cfg(test)]

extern crate std;

use super::*;
use soroban_sdk::{testutils::Address as _, Env, String};

#[path = "test_fixture.rs"]
mod fixture;

fn hex<const N: usize>(env: &Env, s: &str) -> BytesN<N> {
    let mut out = [0u8; N];
    for i in 0..N {
        out[i] = u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap();
    }
    BytesN::from_array(env, &out)
}

fn vk(env: &Env) -> VerifyingKey {
    let mut ic = Vec::new(env);
    for p in fixture::VK_IC {
        ic.push_back(hex::<64>(env, p));
    }
    VerifyingKey {
        alpha: hex(env, fixture::VK_ALPHA),
        beta: hex(env, fixture::VK_BETA),
        gamma: hex(env, fixture::VK_GAMMA),
        delta: hex(env, fixture::VK_DELTA),
        ic,
    }
}

fn proof(env: &Env) -> Proof {
    Proof { a: hex(env, fixture::PROOF_A), b: hex(env, fixture::PROOF_B), c: hex(env, fixture::PROOF_C) }
}

fn setup(env: &Env) -> (BadgeVerifierClient<'_>, Address) {
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();
    let admin = Address::generate(env);
    let id = env.register(BadgeVerifier, (admin, hex::<32>(env, fixture::ATTESTER_PUB), vk(env)));
    let investor = Address::from_string(&String::from_str(env, fixture::INVESTOR));
    (BadgeVerifierClient::new(env, &id), investor)
}

#[test]
fn real_groth16_proof_verifies() {
    let env = Env::default();
    let (client, _) = setup(&env);
    assert!(client.verify(&fixture::THRESHOLD, &hex(&env, fixture::COMMITMENT), &proof(&env)));
}

#[test]
fn claim_records_badge_without_revealing_total() {
    let env = Env::default();
    let (client, investor) = setup(&env);
    client.claim(
        &investor,
        &fixture::THRESHOLD,
        &hex(&env, fixture::COMMITMENT),
        &hex(&env, fixture::ATTESTATION),
        &proof(&env),
    );
    let badge = client.badge(&investor).unwrap();
    assert_eq!(badge.threshold, fixture::THRESHOLD);
    assert_eq!(badge.commitment, hex(&env, fixture::COMMITMENT));
    // Only the threshold and the commitment are stored: the total invested is never on-chain
    assert!(fixture::TOTAL_CENTS > fixture::THRESHOLD);
}

#[test]
fn proof_does_not_verify_for_a_higher_threshold() {
    let env = Env::default();
    let (client, _) = setup(&env);
    // Same proof, but claiming the GOLD threshold (10,000 USDC) the investor never proved
    assert!(!client.verify(&1_000_000, &hex(&env, fixture::COMMITMENT), &proof(&env)));
}

#[test]
fn tampered_proof_is_rejected() {
    let env = Env::default();
    let (client, _) = setup(&env);
    let mut bad = proof(&env);
    bad.c = bad.a.clone();
    assert!(!client.verify(&fixture::THRESHOLD, &hex(&env, fixture::COMMITMENT), &bad));
}

#[test]
fn proof_for_another_commitment_is_rejected() {
    let env = Env::default();
    let (client, _) = setup(&env);
    let mut other = [0u8; 32];
    other[31] = 1;
    assert!(!client.verify(&fixture::THRESHOLD, &BytesN::from_array(&env, &other), &proof(&env)));
}

#[test]
fn non_canonical_commitment_is_rejected() {
    let env = Env::default();
    let (client, investor) = setup(&env);
    let result = client.try_claim(
        &investor,
        &fixture::THRESHOLD,
        &BytesN::from_array(&env, &[0xff; 32]),
        &hex(&env, fixture::ATTESTATION),
        &proof(&env),
    );
    assert_eq!(result, Err(Ok(BadgeError::InvalidCommitment)));
}

#[test]
#[should_panic]
fn attestation_for_another_investor_is_rejected() {
    let env = Env::default();
    let (client, _) = setup(&env);
    // The attestation binds the commitment to the fixture investor; anyone else cannot reuse it
    let stranger = Address::generate(&env);
    client.claim(
        &stranger,
        &fixture::THRESHOLD,
        &hex(&env, fixture::COMMITMENT),
        &hex(&env, fixture::ATTESTATION),
        &proof(&env),
    );
}

#[test]
#[should_panic]
fn attestation_from_another_key_is_rejected() {
    let env = Env::default();
    let (client, investor) = setup(&env);
    client.set_attester(&BytesN::from_array(&env, &[9u8; 32]));
    client.claim(
        &investor,
        &fixture::THRESHOLD,
        &hex(&env, fixture::COMMITMENT),
        &hex(&env, fixture::ATTESTATION),
        &proof(&env),
    );
}

#[test]
#[should_panic]
fn claim_requires_investor_auth() {
    let env = Env::default();
    let (client, investor) = setup(&env);
    env.set_auths(&[]);
    client.claim(
        &investor,
        &fixture::THRESHOLD,
        &hex(&env, fixture::COMMITMENT),
        &hex(&env, fixture::ATTESTATION),
        &proof(&env),
    );
}
