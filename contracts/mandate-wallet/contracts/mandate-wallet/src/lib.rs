#![no_std]
//! MandateWallet: the investing agent's wallet, one instance per investor (the owner).
//!
//! It can only pay fund wallets the owner approved, within limits she signed, and the agent cannot change those limits.
//!
//! Security model (not audited):
//! - No upgrade function and no platform admin: once deployed, only the owner can change the rules,
//!   and nobody (the platform included) can replace this code.
//! - No `__check_auth`: this is NOT a contract account. It never authorizes calls made by others, so a
//!   `transfer(from = this wallet)` on any token (USDC or fund units) fails `require_auth` unless this
//!   contract itself is the caller. Money leaves only through `subscribe` (agent, under every rule below)
//!   and `withdraw` / `withdraw_units` (owner, and only to the owner).
//! - No transfer to an arbitrary destination: not even the owner can send funds to a third party from here.
//! - The spending window is derived from the ledger timestamp, not from ledger numbers.
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, BytesN, Env,
};

#[cfg(test)]
mod test;

// Storage TTLs (ledgers close every ~5s): keep entries alive for ~30 days, extended on every write
const DAY_IN_LEDGERS: u32 = 17_280;
const TTL_EXTEND_TO: u32 = 30 * DAY_IN_LEDGERS;
const TTL_THRESHOLD: u32 = TTL_EXTEND_TO - DAY_IN_LEDGERS;

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    // Instance: small config read on every call
    Owner,
    Agent,
    Usdc,
    Revoked,
    Limits,
    MandateHash,
    PeriodStart,
    PeriodSpent,
    // Persistent
    Fund(Address),        // fund wallet -> FundEntry (allowlist)
    Decision(BytesN<32>), // decision hash already used -> true
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct Limits {
    pub per_tx_cap: i128,
    pub period_cap: i128,
    pub period_secs: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct FundEntry {
    pub token: Address, // the fund's FundToken (units the wallet receives)
    pub cap: i128,      // max USDC this wallet may ever pay to this fund wallet
    pub spent: i128,    // USDC already paid to this fund wallet
}

// Error codes are part of the public interface (adversarial suite, video): do not renumber
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    InvalidConfig = 1,
    InvalidAmount = 2,
    AgentRevoked = 3,
    DecisionUsed = 4,
    FundNotAllowed = 5,
    OverTxCap = 6,
    OverPeriodCap = 7,
    OverFundCap = 8,
    Math = 9,
}

/// Purchase paid by the agent: topics ["subscribe", fund_wallet], data {amount, decision}
#[contractevent(topics = ["subscribe"])]
pub struct Subscribe {
    #[topic]
    pub fund_wallet: Address,
    pub decision: BytesN<32>,
    pub amount: i128,
}

#[contractevent(topics = ["allow_fund"])]
pub struct AllowFund {
    #[topic]
    pub fund_wallet: Address,
    pub fund_token: Address,
    pub cap: i128,
}

#[contractevent(topics = ["disallow_fund"])]
pub struct DisallowFund {
    #[topic]
    pub fund_wallet: Address,
}

#[contractevent(topics = ["limits"])]
pub struct LimitsSet {
    pub per_tx_cap: i128,
    pub period_cap: i128,
    pub period_secs: u64,
    pub mandate_hash: BytesN<32>,
}

#[contractevent(topics = ["revoke"])]
pub struct Revoke {}

#[contractevent(topics = ["set_agent"])]
pub struct SetAgent {
    pub agent: Address,
}

#[contractevent(topics = ["withdraw"])]
pub struct Withdraw {
    pub amount: i128,
}

#[contractevent(topics = ["withdraw_units"])]
pub struct WithdrawUnits {
    #[topic]
    pub fund_token: Address,
    pub amount: i128,
}

fn bump_instance(env: &Env) {
    env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}
fn set_persistent<V: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(env: &Env, key: &DataKey, value: &V) {
    env.storage().persistent().set(key, value);
    env.storage().persistent().extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
}
fn get_instance<V: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>>(env: &Env, key: &DataKey) -> V {
    // Every instance key is written by the constructor, so it is always present
    env.storage().instance().get(key).unwrap()
}
fn owner(env: &Env) -> Address {
    get_instance(env, &DataKey::Owner)
}
fn require_owner(env: &Env) -> Address {
    let owner = owner(env);
    owner.require_auth();
    bump_instance(env);
    owner
}
fn add(a: i128, b: i128) -> Result<i128, Error> {
    a.checked_add(b).ok_or(Error::Math)
}
fn check_limits(per_tx_cap: i128, period_cap: i128, period_secs: u64) -> Result<(), Error> {
    if per_tx_cap <= 0 || period_cap < per_tx_cap || period_secs == 0 {
        return Err(Error::InvalidConfig);
    }
    Ok(())
}
fn check_agent(env: &Env, owner: &Address, agent: &Address) -> Result<(), Error> {
    if agent == owner || *agent == env.current_contract_address() {
        return Err(Error::InvalidConfig);
    }
    Ok(())
}
/// (window start, amount spent in it). When the window has expired a new one starts now with 0 spent.
fn current_period(env: &Env) -> (u64, i128) {
    let limits: Limits = get_instance(env, &DataKey::Limits);
    let start: u64 = get_instance(env, &DataKey::PeriodStart);
    let spent: i128 = get_instance(env, &DataKey::PeriodSpent);
    let now = env.ledger().timestamp();
    // Saturating: an absurdly long period simply never expires
    if now >= start.saturating_add(limits.period_secs) {
        (now, 0)
    } else {
        (start, spent)
    }
}

#[contract]
pub struct MandateWallet;

#[contractimpl]
impl MandateWallet {
    /// Runs atomically with the deploy. The owner signs the initial limits and mandate hash.
    pub fn __constructor(
        env: Env,
        owner: Address,
        agent: Address,
        usdc: Address,
        per_tx_cap: i128,
        period_cap: i128,
        period_secs: u64,
        mandate_hash: BytesN<32>,
    ) -> Result<(), Error> {
        owner.require_auth();
        check_limits(per_tx_cap, period_cap, period_secs)?;
        check_agent(&env, &owner, &agent)?;
        let st = env.storage().instance();
        st.set(&DataKey::Owner, &owner);
        st.set(&DataKey::Agent, &agent);
        st.set(&DataKey::Usdc, &usdc);
        st.set(&DataKey::Revoked, &false);
        st.set(&DataKey::Limits, &Limits { per_tx_cap, period_cap, period_secs });
        st.set(&DataKey::MandateHash, &mandate_hash);
        st.set(&DataKey::PeriodStart, &env.ledger().timestamp());
        st.set(&DataKey::PeriodSpent, &0i128);
        bump_instance(&env);
        Ok(())
    }

    // -------- Owner --------

    /// New limits and the hash of the mandate they come from. The current window keeps its start and spent amount.
    pub fn set_limits(env: Env, per_tx_cap: i128, period_cap: i128, period_secs: u64, mandate_hash: BytesN<32>) -> Result<(), Error> {
        require_owner(&env);
        check_limits(per_tx_cap, period_cap, period_secs)?;
        env.storage().instance().set(&DataKey::Limits, &Limits { per_tx_cap, period_cap, period_secs });
        env.storage().instance().set(&DataKey::MandateHash, &mandate_hash);
        LimitsSet { per_tx_cap, period_cap, period_secs, mandate_hash }.publish(&env);
        Ok(())
    }

    /// Adds a fund wallet to the allowlist (or updates its token and cap, keeping what was already spent)
    pub fn allow_fund(env: Env, fund_wallet: Address, fund_token: Address, fund_cap: i128) -> Result<(), Error> {
        let owner = require_owner(&env);
        if fund_cap <= 0 {
            return Err(Error::InvalidConfig);
        }
        let agent: Address = get_instance(&env, &DataKey::Agent);
        if fund_wallet == owner || fund_wallet == agent || fund_wallet == env.current_contract_address() {
            return Err(Error::InvalidConfig);
        }
        let key = DataKey::Fund(fund_wallet.clone());
        let spent = env.storage().persistent().get::<_, FundEntry>(&key).map(|e| e.spent).unwrap_or(0);
        set_persistent(&env, &key, &FundEntry { token: fund_token.clone(), cap: fund_cap, spent });
        AllowFund { fund_wallet, fund_token, cap: fund_cap }.publish(&env);
        Ok(())
    }

    pub fn disallow_fund(env: Env, fund_wallet: Address) -> Result<(), Error> {
        require_owner(&env);
        let key = DataKey::Fund(fund_wallet.clone());
        if !env.storage().persistent().has(&key) {
            return Err(Error::FundNotAllowed);
        }
        env.storage().persistent().remove(&key);
        DisallowFund { fund_wallet }.publish(&env);
        Ok(())
    }

    /// Kill switch: the agent can no longer call `subscribe`
    pub fn revoke_agent(env: Env) -> Result<(), Error> {
        require_owner(&env);
        env.storage().instance().set(&DataKey::Revoked, &true);
        Revoke {}.publish(&env);
        Ok(())
    }

    /// Replaces the agent key and re-enables it
    pub fn set_agent(env: Env, agent: Address) -> Result<(), Error> {
        let owner = require_owner(&env);
        check_agent(&env, &owner, &agent)?;
        env.storage().instance().set(&DataKey::Agent, &agent);
        env.storage().instance().set(&DataKey::Revoked, &false);
        SetAgent { agent }.publish(&env);
        Ok(())
    }

    /// USDC from this wallet, only to the owner
    pub fn withdraw(env: Env, amount: i128) -> Result<(), Error> {
        let owner = require_owner(&env);
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let usdc: Address = get_instance(&env, &DataKey::Usdc);
        token::Client::new(&env, &usdc).transfer(&env.current_contract_address(), &owner, &amount);
        Withdraw { amount }.publish(&env);
        Ok(())
    }

    /// Fund units held by this wallet, only to the owner (the FundToken requires her to be whitelisted)
    pub fn withdraw_units(env: Env, fund_token: Address, amount: i128) -> Result<(), Error> {
        let owner = require_owner(&env);
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        token::Client::new(&env, &fund_token).transfer(&env.current_contract_address(), &owner, &amount);
        WithdrawUnits { fund_token, amount }.publish(&env);
        Ok(())
    }

    // -------- Agent --------

    /// Pays `amount` USDC to an allowlisted fund wallet, within every limit, once per `decision`
    /// (the hash of the policy decision log line that approved this purchase).
    pub fn subscribe(env: Env, decision: BytesN<32>, fund_wallet: Address, amount: i128) -> Result<(), Error> {
        let agent: Address = get_instance(&env, &DataKey::Agent);
        agent.require_auth();
        bump_instance(&env);

        let revoked: bool = get_instance(&env, &DataKey::Revoked);
        if revoked {
            return Err(Error::AgentRevoked);
        }
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let decision_key = DataKey::Decision(decision.clone());
        if env.storage().persistent().has(&decision_key) {
            return Err(Error::DecisionUsed);
        }
        let fund_key = DataKey::Fund(fund_wallet.clone());
        let mut entry: FundEntry = env.storage().persistent().get(&fund_key).ok_or(Error::FundNotAllowed)?;
        let limits: Limits = get_instance(&env, &DataKey::Limits);
        if amount > limits.per_tx_cap {
            return Err(Error::OverTxCap);
        }
        let (period_start, period_spent) = current_period(&env);
        let new_period_spent = add(period_spent, amount)?;
        if new_period_spent > limits.period_cap {
            return Err(Error::OverPeriodCap);
        }
        let new_fund_spent = add(entry.spent, amount)?;
        if new_fund_spent > entry.cap {
            return Err(Error::OverFundCap);
        }

        env.storage().instance().set(&DataKey::PeriodStart, &period_start);
        env.storage().instance().set(&DataKey::PeriodSpent, &new_period_spent);
        entry.spent = new_fund_spent;
        set_persistent(&env, &fund_key, &entry);
        set_persistent(&env, &decision_key, &true);

        let usdc: Address = get_instance(&env, &DataKey::Usdc);
        token::Client::new(&env, &usdc).transfer(&env.current_contract_address(), &fund_wallet, &amount);
        Subscribe { fund_wallet, decision, amount }.publish(&env);
        Ok(())
    }

    // -------- Views --------

    pub fn owner(env: Env) -> Address {
        bump_instance(&env);
        owner(&env)
    }
    pub fn agent(env: Env) -> Address {
        bump_instance(&env);
        get_instance(&env, &DataKey::Agent)
    }
    pub fn is_revoked(env: Env) -> bool {
        bump_instance(&env);
        get_instance(&env, &DataKey::Revoked)
    }
    pub fn limits(env: Env) -> Limits {
        bump_instance(&env);
        get_instance(&env, &DataKey::Limits)
    }
    pub fn mandate_hash(env: Env) -> BytesN<32> {
        bump_instance(&env);
        get_instance(&env, &DataKey::MandateHash)
    }
    pub fn fund(env: Env, fund_wallet: Address) -> Option<FundEntry> {
        bump_instance(&env);
        env.storage().persistent().get(&DataKey::Fund(fund_wallet))
    }
    /// USDC spent in the current window (0 if the window has already expired)
    pub fn spent_in_period(env: Env) -> i128 {
        bump_instance(&env);
        current_period(&env).1
    }
    pub fn decision_used(env: Env, decision: BytesN<32>) -> bool {
        bump_instance(&env);
        env.storage().persistent().has(&DataKey::Decision(decision))
    }
}
