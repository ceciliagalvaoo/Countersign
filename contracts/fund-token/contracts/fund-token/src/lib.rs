#![no_std]
//! Fund share token. Implements the SEP-41 token interface (balance, transfer, approve/allowance,
//! transfer_from, burn/burn_from, metadata) plus the fund's rules: shares can only be received by
//! KYC-whitelisted accounts, are minted by the admin (the fund wallet) up to a max supply, and can be paused.
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, Env, MuxedAddress, String,
};

#[cfg(test)]
mod test;

const DECIMALS: u32 = 7;

// Storage TTLs (ledgers close every ~5s): keep entries alive for ~30 days, extended on every write
const DAY_IN_LEDGERS: u32 = 17_280;
const TTL_EXTEND_TO: u32 = 30 * DAY_IN_LEDGERS;
const TTL_THRESHOLD: u32 = TTL_EXTEND_TO - DAY_IN_LEDGERS;

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    Name,
    Symbol,
    Decimals,
    TotalSupply,
    MaxSupply,
    Balance(Address),
    Whitelist(Address),
    Paused,
    Allowance(AllowanceKey),
}

#[derive(Clone)]
#[contracttype]
pub struct AllowanceKey {
    pub from: Address,
    pub spender: Address,
}

#[derive(Clone)]
#[contracttype]
pub struct AllowanceValue {
    pub amount: i128,
    pub live_until_ledger: u32,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum TokenError {
    AlreadyInitialized = 1, // kept for error-code stability
    NotAdmin = 2,
    Paused = 3,
    NotWhitelisted = 4,
    InsufficientBalance = 5,
    SupplyOverflow = 6,
    InvalidAmount = 7,
    InsufficientAllowance = 8,
    InvalidExpiration = 9,
}

fn bump_instance(env: &Env) {
    env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}
fn set_persistent<V: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(env: &Env, key: &DataKey, value: &V) {
    env.storage().persistent().set(key, value);
    env.storage().persistent().extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
}
fn read_admin(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Admin).unwrap()
}

fn ensure_positive(amount: i128) -> Result<(), TokenError> {
    if amount <= 0 { return Err(TokenError::InvalidAmount); }
    Ok(())
}
fn add(a: i128, b: i128, e: TokenError) -> Result<i128, TokenError> {
    a.checked_add(b).ok_or(e)
}
fn sub(a: i128, b: i128, e: TokenError) -> Result<i128, TokenError> {
    // Balances are signed, so checked_sub alone would allow going negative
    match a.checked_sub(b) {
        Some(v) if v >= 0 => Ok(v),
        _ => Err(e),
    }
}

#[contractevent(topics = ["whitelist_add"], data_format = "single-value")]
pub struct WhitelistAdd {
    pub address: Address,
}

#[contractevent(topics = ["whitelist_remove"], data_format = "single-value")]
pub struct WhitelistRemove {
    pub address: Address,
}

#[contractevent(data_format = "single-value")]
pub struct Mint {
    #[topic]
    pub to: Address,
    pub amount: i128,
}

#[contractevent(data_format = "single-value")]
pub struct Transfer {
    #[topic]
    pub from: Address,
    #[topic]
    pub to: Address,
    pub amount: i128,
}

/// Transfer to a muxed address (CAP-67): same topics, data carries the destination's muxed id
#[contractevent(topics = ["transfer"], data_format = "map")]
pub struct TransferMuxed {
    #[topic]
    pub from: Address,
    #[topic]
    pub to: Address,
    pub to_muxed_id: u64,
    pub amount: i128,
}

#[contractevent(data_format = "vec")]
pub struct Approve {
    #[topic]
    pub from: Address,
    #[topic]
    pub spender: Address,
    pub amount: i128,
    pub live_until_ledger: u32,
}

#[contractevent(data_format = "single-value")]
pub struct Burn {
    #[topic]
    pub from: Address,
    pub amount: i128,
}

#[contractevent(topics = ["set_admin"], data_format = "single-value")]
pub struct SetAdmin {
    pub new_admin: Address,
}

#[contractevent(topics = ["pause"], data_format = "single-value")]
pub struct Pause {
    pub paused: bool,
}

fn ensure_not_paused(env: &Env) -> Result<(), TokenError> {
    if env.storage().instance().get::<_, bool>(&DataKey::Paused).unwrap_or(false) {
        return Err(TokenError::Paused);
    }
    Ok(())
}

fn read_balance(env: &Env, addr: &Address) -> i128 {
    env.storage().persistent().get(&DataKey::Balance(addr.clone())).unwrap_or(0)
}

/// Moves shares between accounts; the receiver must be whitelisted (KYC)
fn move_balance(env: &Env, from: &Address, to: &Address, amount: i128) -> Result<(), TokenError> {
    ensure_not_paused(env)?;
    if !env.storage().persistent().get(&DataKey::Whitelist(to.clone())).unwrap_or(false) {
        return Err(TokenError::NotWhitelisted);
    }
    let from_new = sub(read_balance(env, from), amount, TokenError::InsufficientBalance)?;
    set_persistent(env, &DataKey::Balance(from.clone()), &from_new);
    // Read after writing `from`, so a self-transfer leaves the balance unchanged
    let to_new = add(read_balance(env, to), amount, TokenError::SupplyOverflow)?;
    set_persistent(env, &DataKey::Balance(to.clone()), &to_new);
    Ok(())
}

fn burn_balance(env: &Env, from: &Address, amount: i128) -> Result<(), TokenError> {
    ensure_not_paused(env)?;
    let new_bal = sub(read_balance(env, from), amount, TokenError::InsufficientBalance)?;
    let supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
    set_persistent(env, &DataKey::Balance(from.clone()), &new_bal);
    env.storage().instance().set(&DataKey::TotalSupply, &sub(supply, amount, TokenError::InsufficientBalance)?);
    Burn { from: from.clone(), amount }.publish(env);
    Ok(())
}

fn read_allowance(env: &Env, from: &Address, spender: &Address) -> i128 {
    let key = DataKey::Allowance(AllowanceKey { from: from.clone(), spender: spender.clone() });
    match env.storage().temporary().get::<_, AllowanceValue>(&key) {
        Some(a) if a.live_until_ledger >= env.ledger().sequence() => a.amount,
        _ => 0,
    }
}

fn write_allowance(env: &Env, from: &Address, spender: &Address, amount: i128, live_until_ledger: u32) -> Result<(), TokenError> {
    if amount < 0 {
        return Err(TokenError::InvalidAmount);
    }
    let seq = env.ledger().sequence();
    // An allowance must expire in the future, but no later than the network lets a temporary entry live
    if amount > 0 && (live_until_ledger < seq || live_until_ledger - seq > env.storage().max_ttl()) {
        return Err(TokenError::InvalidExpiration);
    }
    let key = DataKey::Allowance(AllowanceKey { from: from.clone(), spender: spender.clone() });
    env.storage().temporary().set(&key, &AllowanceValue { amount, live_until_ledger });
    if amount > 0 {
        let live_for = live_until_ledger - seq;
        env.storage().temporary().extend_ttl(&key, live_for, live_for);
    }
    Ok(())
}

fn spend_allowance(env: &Env, from: &Address, spender: &Address, amount: i128) -> Result<(), TokenError> {
    let key = DataKey::Allowance(AllowanceKey { from: from.clone(), spender: spender.clone() });
    let allowance = read_allowance(env, from, spender);
    if allowance < amount {
        return Err(TokenError::InsufficientAllowance);
    }
    if amount > 0 {
        let live_until_ledger = env.storage().temporary().get::<_, AllowanceValue>(&key).unwrap().live_until_ledger;
        env.storage().temporary().set(&key, &AllowanceValue { amount: allowance - amount, live_until_ledger });
    }
    Ok(())
}

#[contract]
pub struct FundToken;

#[contractimpl]
impl FundToken {
    /// Runs atomically with the deploy, so nobody can initialize the contract in between
    pub fn __constructor(env: Env, admin: Address, name: String, symbol: String, max_supply: i128) -> Result<(), TokenError> {
        admin.require_auth();
        if name.len() == 0 || symbol.len() == 0 || max_supply <= 0 {
            return Err(TokenError::InvalidAmount);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Name, &name);
        env.storage().instance().set(&DataKey::Symbol, &symbol);
        env.storage().instance().set(&DataKey::Decimals, &DECIMALS);
        env.storage().instance().set(&DataKey::TotalSupply, &0i128);
        env.storage().instance().set(&DataKey::MaxSupply, &max_supply);
        env.storage().instance().set(&DataKey::Paused, &false);
        bump_instance(&env);
        Ok(())
    }

    /// Transfers the admin role (e.g. to a multisig account). Both the current and the new admin must sign.
    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), TokenError> {
        read_admin(&env).require_auth();
        new_admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        bump_instance(&env);
        SetAdmin { new_admin }.publish(&env);
        Ok(())
    }

    // --- Whitelist (KYC/AML) ---
    pub fn whitelist_add(env: Env, address: Address) -> Result<(), TokenError> {
        read_admin(&env).require_auth();
        bump_instance(&env);
        set_persistent(&env, &DataKey::Whitelist(address.clone()), &true);
        WhitelistAdd { address }.publish(&env);
        Ok(())
    }
    pub fn whitelist_remove(env: Env, address: Address) -> Result<(), TokenError> {
        read_admin(&env).require_auth();
        bump_instance(&env);
        env.storage().persistent().remove(&DataKey::Whitelist(address.clone()));
        WhitelistRemove { address }.publish(&env);
        Ok(())
    }
    pub fn is_whitelisted(env: Env, address: Address) -> bool {
        env.storage().persistent().get(&DataKey::Whitelist(address)).unwrap_or(false)
    }

    // --- Mint (admin) ---
    pub fn mint(env: Env, to: Address, amount: i128) -> Result<(), TokenError> {
        ensure_positive(amount)?;
        read_admin(&env).require_auth();
        bump_instance(&env);
        ensure_not_paused(&env)?;
        if !Self::is_whitelisted(env.clone(), to.clone()) {
            return Err(TokenError::NotWhitelisted);
        }

        let cur_supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        let max_supply: i128 = env.storage().instance().get(&DataKey::MaxSupply).unwrap();
        let new_supply = add(cur_supply, amount, TokenError::SupplyOverflow)?;
        if new_supply > max_supply { return Err(TokenError::SupplyOverflow); }

        let new_bal = add(read_balance(&env, &to), amount, TokenError::SupplyOverflow)?;

        env.storage().instance().set(&DataKey::TotalSupply, &new_supply);
        set_persistent(&env, &DataKey::Balance(to.clone()), &new_bal);
        Mint { to, amount }.publish(&env);
        Ok(())
    }

    // --- SEP-41 ---
    pub fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        read_allowance(&env, &from, &spender)
    }

    pub fn approve(env: Env, from: Address, spender: Address, amount: i128, live_until_ledger: u32) -> Result<(), TokenError> {
        from.require_auth();
        bump_instance(&env);
        write_allowance(&env, &from, &spender, amount, live_until_ledger)?;
        Approve { from, spender, amount, live_until_ledger }.publish(&env);
        Ok(())
    }

    pub fn transfer(env: Env, from: Address, to: MuxedAddress, amount: i128) -> Result<(), TokenError> {
        ensure_positive(amount)?;
        from.require_auth();
        bump_instance(&env);
        let to_addr = to.address();
        move_balance(&env, &from, &to_addr, amount)?;
        match to.id() {
            Some(to_muxed_id) => TransferMuxed { from, to: to_addr, to_muxed_id, amount }.publish(&env),
            None => Transfer { from, to: to_addr, amount }.publish(&env),
        }
        Ok(())
    }

    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) -> Result<(), TokenError> {
        ensure_positive(amount)?;
        spender.require_auth();
        bump_instance(&env);
        spend_allowance(&env, &from, &spender, amount)?;
        move_balance(&env, &from, &to, amount)?;
        Transfer { from, to, amount }.publish(&env);
        Ok(())
    }

    pub fn burn(env: Env, from: Address, amount: i128) -> Result<(), TokenError> {
        ensure_positive(amount)?;
        from.require_auth();
        bump_instance(&env);
        burn_balance(&env, &from, amount)
    }

    pub fn burn_from(env: Env, spender: Address, from: Address, amount: i128) -> Result<(), TokenError> {
        ensure_positive(amount)?;
        spender.require_auth();
        bump_instance(&env);
        spend_allowance(&env, &from, &spender, amount)?;
        burn_balance(&env, &from, amount)
    }

    // --- Views / Admin ---
    pub fn set_pause(env: Env, paused: bool) -> Result<(), TokenError> {
        read_admin(&env).require_auth();
        bump_instance(&env);
        env.storage().instance().set(&DataKey::Paused, &paused);
        Pause { paused }.publish(&env);
        Ok(())
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        read_balance(&env, &id)
    }
    pub fn total_supply(env: Env) -> i128 { env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0) }
    pub fn max_supply(env: Env) -> i128 { env.storage().instance().get(&DataKey::MaxSupply).unwrap() }
    pub fn decimals(env: Env) -> u32 { env.storage().instance().get(&DataKey::Decimals).unwrap() }
    pub fn name(env: Env) -> String { env.storage().instance().get(&DataKey::Name).unwrap() }
    pub fn symbol(env: Env) -> String { env.storage().instance().get(&DataKey::Symbol).unwrap() }
    pub fn admin(env: Env) -> Address { env.storage().instance().get(&DataKey::Admin).unwrap() }
    pub fn is_paused(env: Env) -> bool { env.storage().instance().get(&DataKey::Paused).unwrap_or(false) }
}
