#![no_std]
//! Privacy-preserving investor tier badges.
//!
//! The platform attests a Poseidon commitment to an investor's verified total invested (ed25519 signature).
//! The investor proves in zero knowledge (Groth16 over BN254, Circom circuit `zk/badge`) that the committed total
//! reaches a tier threshold. This contract checks the attestation, verifies the proof with the BN254 host
//! functions (Protocol 25) and records the badge. The total invested is never revealed on-chain.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype,
    crypto::bn254::{Bn254Fr, Bn254G1Affine, Bn254G2Affine},
    Address, Bytes, BytesN, Env, U256, Vec, vec,
};

#[cfg(test)]
mod test;

const DAY_IN_LEDGERS: u32 = 17_280;
const TTL_EXTEND_TO: u32 = 30 * DAY_IN_LEDGERS;
const TTL_THRESHOLD: u32 = TTL_EXTEND_TO - DAY_IN_LEDGERS;

/// Domain separator of the platform's attestation message
const ATTESTATION_DOMAIN: &[u8] = b"TSF-BADGE-v1";
/// The circuit has two public inputs: [commitment, threshold]
const N_PUBLIC: u32 = 2;

/// Groth16 verification key, BN254 encoding of soroban-sdk (G1: X||Y, G2: X.c1||X.c0||Y.c1||Y.c0, big-endian)
#[contracttype]
#[derive(Clone)]
pub struct VerifyingKey {
    pub alpha: BytesN<64>,
    pub beta: BytesN<128>,
    pub gamma: BytesN<128>,
    pub delta: BytesN<128>,
    pub ic: Vec<BytesN<64>>,
}

#[contracttype]
#[derive(Clone)]
pub struct Proof {
    pub a: BytesN<64>,
    pub b: BytesN<128>,
    pub c: BytesN<64>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Badge {
    /// Proven minimum total invested, in USDC cents
    pub threshold: u64,
    pub commitment: BytesN<32>,
    pub ledger: u32,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Attester,
    Vk,
    Badge(Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum BadgeError {
    InvalidKey = 1,
    InvalidProof = 2,
    InvalidCommitment = 3,
}

#[contractevent(topics = ["badge"], data_format = "single-value")]
pub struct BadgeClaimed {
    #[topic]
    pub investor: Address,
    pub threshold: u64,
}

#[contract]
pub struct BadgeVerifier;

fn bump_instance(env: &Env) {
    env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

/// Field element from 32 big-endian bytes, rejecting non-canonical encodings (>= field modulus)
fn to_fr(bytes: &BytesN<32>) -> Option<Bn254Fr> {
    let fr = Bn254Fr::from_bytes(bytes.clone());
    if fr.to_bytes() != *bytes {
        return None;
    }
    Some(fr)
}

fn groth16_verify(env: &Env, vk: &VerifyingKey, proof: &Proof, inputs: &Vec<Bn254Fr>) -> bool {
    if vk.ic.len() != inputs.len() + 1 {
        return false;
    }
    let bn = env.crypto().bn254();

    // vk_x = IC[0] + sum(input_i * IC[i + 1])
    let mut points: Vec<Bn254G1Affine> = vec![env];
    for i in 1..vk.ic.len() {
        points.push_back(Bn254G1Affine::from_bytes(vk.ic.get_unchecked(i)));
    }
    let msm = bn.g1_msm(points, inputs.clone());
    let vk_x = bn.g1_add(&Bn254G1Affine::from_bytes(vk.ic.get_unchecked(0)), &msm);

    // e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1
    let neg_a = -Bn254G1Affine::from_bytes(proof.a.clone());
    let g1: Vec<Bn254G1Affine> = vec![
        env,
        neg_a,
        Bn254G1Affine::from_bytes(vk.alpha.clone()),
        vk_x,
        Bn254G1Affine::from_bytes(proof.c.clone()),
    ];
    let g2: Vec<Bn254G2Affine> = vec![
        env,
        Bn254G2Affine::from_bytes(proof.b.clone()),
        Bn254G2Affine::from_bytes(vk.beta.clone()),
        Bn254G2Affine::from_bytes(vk.gamma.clone()),
        Bn254G2Affine::from_bytes(vk.delta.clone()),
    ];
    bn.pairing_check(g1, g2)
}

/// Message signed by the platform: domain || commitment || investor strkey
fn attestation_message(env: &Env, commitment: &BytesN<32>, investor: &Address) -> Bytes {
    let mut msg = Bytes::from_slice(env, ATTESTATION_DOMAIN);
    msg.append(&Bytes::from_array(env, &commitment.to_array()));
    let strkey = investor.to_string();
    let mut buf = [0u8; 56];
    strkey.copy_into_slice(&mut buf[..strkey.len() as usize]);
    msg.append(&Bytes::from_slice(env, &buf[..strkey.len() as usize]));
    msg
}

#[contractimpl]
impl BadgeVerifier {
    pub fn __constructor(env: Env, admin: Address, attester: BytesN<32>, vk: VerifyingKey) -> Result<(), BadgeError> {
        admin.require_auth();
        if vk.ic.len() != N_PUBLIC + 1 {
            return Err(BadgeError::InvalidKey);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Attester, &attester);
        env.storage().instance().set(&DataKey::Vk, &vk);
        bump_instance(&env);
        Ok(())
    }

    /// Rotates the platform's attestation key
    pub fn set_attester(env: Env, attester: BytesN<32>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::Attester, &attester);
        bump_instance(&env);
    }

    /// Pure proof check (no attestation, no state): proves some opening of `commitment` reaches `threshold`
    pub fn verify(env: Env, threshold: u64, commitment: BytesN<32>, proof: Proof) -> bool {
        let vk: VerifyingKey = env.storage().instance().get(&DataKey::Vk).unwrap();
        let Some(c) = to_fr(&commitment) else { return false };
        let t = Bn254Fr::from_u256(U256::from_u128(&env, threshold as u128));
        groth16_verify(&env, &vk, &proof, &vec![&env, c, t])
    }

    /// Records a badge for `investor`: the commitment must be attested by the platform for this investor,
    /// and the proof must show its committed total is at least `threshold`.
    pub fn claim(
        env: Env,
        investor: Address,
        threshold: u64,
        commitment: BytesN<32>,
        attestation: BytesN<64>,
        proof: Proof,
    ) -> Result<(), BadgeError> {
        investor.require_auth();
        bump_instance(&env);

        if to_fr(&commitment).is_none() {
            return Err(BadgeError::InvalidCommitment);
        }
        let attester: BytesN<32> = env.storage().instance().get(&DataKey::Attester).unwrap();
        // Panics (fails the transaction) when the signature is invalid
        env.crypto().ed25519_verify(&attester, &attestation_message(&env, &commitment, &investor), &attestation);

        if !Self::verify(env.clone(), threshold, commitment.clone(), proof) {
            return Err(BadgeError::InvalidProof);
        }

        let key = DataKey::Badge(investor.clone());
        let badge = Badge { threshold, commitment, ledger: env.ledger().sequence() };
        env.storage().persistent().set(&key, &badge);
        env.storage().persistent().extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        BadgeClaimed { investor, threshold }.publish(&env);
        Ok(())
    }

    pub fn badge(env: Env, investor: Address) -> Option<Badge> {
        env.storage().persistent().get(&DataKey::Badge(investor))
    }

    pub fn attester(env: Env) -> BytesN<32> {
        env.storage().instance().get(&DataKey::Attester).unwrap()
    }
}
