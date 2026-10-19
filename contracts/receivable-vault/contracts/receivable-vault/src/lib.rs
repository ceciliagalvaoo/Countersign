#![no_std]
use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype,
    symbol_short, token, vec, Address, Env, String, Symbol, Vec,
};

#[cfg(test)]
mod test;

// Storage TTLs (ledgers close every ~5s): keep entries alive for ~30 days, extended on every write
const DAY_IN_LEDGERS: u32 = 17_280;
const TTL_EXTEND_TO: u32 = 30 * DAY_IN_LEDGERS;
const TTL_THRESHOLD: u32 = TTL_EXTEND_TO - DAY_IN_LEDGERS;

/// Subset of the FundToken interface used for the pro-rata distribution
#[contractclient(name = "FundTokenClient")]
pub trait FundTokenInterface {
    fn balance(env: Env, addr: Address) -> i128;
    fn total_supply(env: Env) -> i128;
}

#[derive(Clone)]
#[contracttype]
pub enum Status { Pending = 0, Approved = 1, Rejected = 2 }

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    FundTokenAddress,           // fund unit token contract of this fund
    PaymentToken,               // payment asset (USDC Stellar Asset Contract)
    Consultants(Address),       // whitelist de consultores
    Cedente(String),            // id -> EntityRecord
    Sacado(String),
    Fund(String),               // fund_id -> FundRecord
    Receivable(String),         // id -> Receivable
    ReceivableCount,
    TotalPaid,
}

#[derive(Clone)]
#[contracttype]
pub struct EntityRecord {
    pub id: String,             // CNPJ/CPF ou identificador
    pub name: String,
    pub created_by: Address,    // Consultor who proposed it
    pub status: Status,
}

#[derive(Clone)]
#[contracttype]
pub struct FundRecord {
    pub id: String,             // ex. "FUND-AGRO-001"
    pub name: String,
    pub created_by: Address,    // Consultor who proposed it
    pub status: Status,
    pub token: Address,         // FundToken address (may stay unset until approval)
}

#[derive(Clone)]
#[contracttype]
pub enum ReceivableStatus { Pending = 0, Paid = 1, Distributed = 2 }

#[derive(Clone)]
#[contracttype]
pub struct Receivable {
    pub id: String,
    pub fund_id: String,
    pub cedente_id: String,
    pub sacado_id: String,
    pub face_value: i128,
    pub due_date: u64,
    pub debtor_address: Address, // optional: account debtor on chain
    pub status: ReceivableStatus,
    pub paid_amount: i128,
    pub paid_date: u64,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum VaultError {
    AlreadyInitialized = 1, // kept for error-code stability
    NotAdmin = 2,
    NotConsultant = 3,
    DuplicateId = 4,
    NotFound = 5,
    Invalid = 6,
    BadStatus = 7,
    Math = 8,
}

#[contractevent(topics = ["set_admin"], data_format = "single-value")]
pub struct SetAdmin {
    pub new_admin: Address,
}

#[contractevent(topics = ["consultant_add"], data_format = "single-value")]
pub struct ConsultantAdd {
    pub addr: Address,
}

#[contractevent(topics = ["consultant_remove"], data_format = "single-value")]
pub struct ConsultantRemove {
    pub addr: Address,
}

/// kind: "cedente" | "sacado" | "fund"
#[contractevent(topics = ["entity_submit"], data_format = "single-value")]
pub struct EntitySubmit {
    #[topic]
    pub kind: Symbol,
    #[topic]
    pub id: String,
    pub consultant: Address,
}

#[contractevent(topics = ["entity_approve"], data_format = "single-value")]
pub struct EntityApprove {
    #[topic]
    pub kind: Symbol,
    #[topic]
    pub id: String,
    pub approved: bool,
}

#[contractevent(topics = ["rcv_reg"], data_format = "single-value")]
pub struct ReceivableRegistered {
    #[topic]
    pub fund_id: String,
    #[topic]
    pub id: String,
    pub face_value: i128,
}

#[contractevent(topics = ["rcv_paid"], data_format = "single-value")]
pub struct ReceivablePaid {
    #[topic]
    pub fund_id: String,
    #[topic]
    pub id: String,
    pub amount: i128,
}

#[contractevent(topics = ["dist"], data_format = "single-value")]
pub struct Distribution {
    #[topic]
    pub fund_id: String,
    #[topic]
    pub holder: Address,
    pub amount: i128,
}

#[contractevent(topics = ["dist_residue"], data_format = "single-value")]
pub struct DistributionResidue {
    #[topic]
    pub fund_id: String,
    #[topic]
    pub holder: Address,
    pub amount: i128,
}

#[contractevent(topics = ["dist_sum"], data_format = "single-value")]
pub struct DistributionSum {
    #[topic]
    pub fund_id: String,
    #[topic]
    pub receivable_id: String,
    pub amount: i128,
}

fn bump_instance(env: &Env) {
    env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}
fn set_persistent<V: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(env: &Env, key: &DataKey, value: &V) {
    env.storage().persistent().set(key, value);
    env.storage().persistent().extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
}
fn require_admin(env: &Env) {
    let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
    admin.require_auth();
    bump_instance(env);
}

fn add(a: i128, b: i128) -> Result<i128, VaultError> { a.checked_add(b).ok_or(VaultError::Math) }
fn sub(a: i128, b: i128) -> Result<i128, VaultError> { a.checked_sub(b).ok_or(VaultError::Math) }

#[contract]
pub struct ReceivableVault;

#[contractimpl]
impl ReceivableVault {
    // -------- Init / Roles --------
    /// Runs atomically with the deploy, so nobody can initialize the contract in between
    pub fn __constructor(env: Env, admin: Address, fund_token_address: Address, payment_token: Address) -> Result<(), VaultError> {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::FundTokenAddress, &fund_token_address);
        env.storage().instance().set(&DataKey::PaymentToken, &payment_token);
        env.storage().instance().set(&DataKey::ReceivableCount, &0u32);
        env.storage().instance().set(&DataKey::TotalPaid, &0i128);
        bump_instance(&env);
        Ok(())
    }

    /// Transfers the admin role (e.g. to a multisig account). Both the current and the new admin must sign.
    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), VaultError> {
        require_admin(&env);
        new_admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        SetAdmin { new_admin }.publish(&env);
        Ok(())
    }

    pub fn consultant_add(env: Env, addr: Address) -> Result<(), VaultError> {
        require_admin(&env);
        set_persistent(&env, &DataKey::Consultants(addr.clone()), &true);
        ConsultantAdd { addr }.publish(&env);
        Ok(())
    }
    pub fn consultant_remove(env: Env, addr: Address) -> Result<(), VaultError> {
        require_admin(&env);
        env.storage().persistent().remove(&DataKey::Consultants(addr.clone()));
        ConsultantRemove { addr }.publish(&env);
        Ok(())
    }
    fn is_consultant(env: &Env, addr: &Address) -> bool {
        env.storage().persistent().get(&DataKey::Consultants(addr.clone())).unwrap_or(false)
    }

    // -------- Registrations proposed by the Consultor --------
    pub fn submit_cedente(env: Env, consultant: Address, id: String, name: String) -> Result<(), VaultError> {
        consultant.require_auth();
        bump_instance(&env);
        let who = consultant;
        if !Self::is_consultant(&env, &who) { return Err(VaultError::NotConsultant); }
        if id.len() == 0 || name.len() == 0 { return Err(VaultError::Invalid); }
        if env.storage().persistent().has(&DataKey::Cedente(id.clone())) { return Err(VaultError::DuplicateId); }

        let rec = EntityRecord { id: id.clone(), name, created_by: who.clone(), status: Status::Pending };
        set_persistent(&env, &DataKey::Cedente(id.clone()), &rec);
        EntitySubmit { kind: symbol_short!("cedente"), id, consultant: who }.publish(&env);
        Ok(())
    }

    pub fn submit_sacado(env: Env, consultant: Address, id: String, name: String) -> Result<(), VaultError> {
        consultant.require_auth();
        bump_instance(&env);
        let who = consultant;
        if !Self::is_consultant(&env, &who) { return Err(VaultError::NotConsultant); }
        if id.len() == 0 || name.len() == 0 { return Err(VaultError::Invalid); }
        if env.storage().persistent().has(&DataKey::Sacado(id.clone())) { return Err(VaultError::DuplicateId); }

        let rec = EntityRecord { id: id.clone(), name, created_by: who.clone(), status: Status::Pending };
        set_persistent(&env, &DataKey::Sacado(id.clone()), &rec);
        EntitySubmit { kind: symbol_short!("sacado"), id, consultant: who }.publish(&env);
        Ok(())
    }

    pub fn submit_fund(env: Env, consultant: Address, id: String, name: String, token_addr: Address) -> Result<(), VaultError> {
        consultant.require_auth();
        bump_instance(&env);
        let who = consultant;
        if !Self::is_consultant(&env, &who) { return Err(VaultError::NotConsultant); }
        if id.len() == 0 || name.len() == 0 { return Err(VaultError::Invalid); }
        if env.storage().persistent().has(&DataKey::Fund(id.clone())) { return Err(VaultError::DuplicateId); }

        let rec = FundRecord { id: id.clone(), name, created_by: who.clone(), status: Status::Pending, token: token_addr };
        set_persistent(&env, &DataKey::Fund(id.clone()), &rec);
        EntitySubmit { kind: symbol_short!("fund"), id, consultant: who }.publish(&env);
        Ok(())
    }

    // -------- Direct registration by the admin (entities already approved off chain by the manager) --------
    /// Registers an already-approved cedente or sacado (kind: "cedente" | "sacado"), skipping the consultant proposal step
    pub fn admin_register_entity(env: Env, kind: Symbol, id: String, name: String) -> Result<(), VaultError> {
        require_admin(&env);
        if id.len() == 0 || name.len() == 0 { return Err(VaultError::Invalid); }
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        let key = if kind == symbol_short!("cedente") {
            DataKey::Cedente(id.clone())
        } else if kind == symbol_short!("sacado") {
            DataKey::Sacado(id.clone())
        } else {
            return Err(VaultError::Invalid);
        };
        if env.storage().persistent().has(&key) { return Err(VaultError::DuplicateId); }

        let rec = EntityRecord { id: id.clone(), name, created_by: admin, status: Status::Approved };
        set_persistent(&env, &key, &rec);
        EntityApprove { kind, id, approved: true }.publish(&env);
        Ok(())
    }

    /// Registers an already-approved fund together with its FundToken contract
    pub fn admin_register_fund(env: Env, id: String, name: String, token: Address) -> Result<(), VaultError> {
        require_admin(&env);
        if id.len() == 0 || name.len() == 0 { return Err(VaultError::Invalid); }
        if env.storage().persistent().has(&DataKey::Fund(id.clone())) { return Err(VaultError::DuplicateId); }
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();

        let rec = FundRecord { id: id.clone(), name, created_by: admin, status: Status::Approved, token };
        set_persistent(&env, &DataKey::Fund(id.clone()), &rec);
        EntityApprove { kind: symbol_short!("fund"), id, approved: true }.publish(&env);
        Ok(())
    }

    pub fn is_registered(env: Env, kind: Symbol, id: String) -> bool {
        let key = if kind == symbol_short!("cedente") {
            DataKey::Cedente(id)
        } else if kind == symbol_short!("sacado") {
            DataKey::Sacado(id)
        } else if kind == symbol_short!("fund") {
            DataKey::Fund(id)
        } else {
            return false;
        };
        env.storage().persistent().has(&key)
    }

    // -------- Approval by the manager --------
    pub fn approve_entity(env: Env, kind: Symbol, id: String, approve: bool) -> Result<(), VaultError> {
        require_admin(&env);
        let st = if approve { Status::Approved } else { Status::Rejected };

        if kind == symbol_short!("cedente") {
                let mut e: EntityRecord = env.storage().persistent().get(&DataKey::Cedente(id.clone())).ok_or(VaultError::NotFound)?;
                e.status = st;
                set_persistent(&env, &DataKey::Cedente(id.clone()), &e);
        } else if kind == symbol_short!("sacado") {
                let mut e: EntityRecord = env.storage().persistent().get(&DataKey::Sacado(id.clone())).ok_or(VaultError::NotFound)?;
                e.status = st;
                set_persistent(&env, &DataKey::Sacado(id.clone()), &e);
        } else if kind == symbol_short!("fund") {
                let mut f: FundRecord = env.storage().persistent().get(&DataKey::Fund(id.clone())).ok_or(VaultError::NotFound)?;
                f.status = st;
                set_persistent(&env, &DataKey::Fund(id.clone()), &f);
        } else {
            return Err(VaultError::Invalid);
        }
        EntityApprove { kind, id, approved: approve }.publish(&env);
        Ok(())
    }

    // -------- Receivables --------
    pub fn register_receivable(
        env: Env,
        id: String,
        fund_id: String,
        cedente_id: String,
        sacado_id: String,
        face_value: i128,
        due_date: u64,
        debtor_address: Address,
    ) -> Result<(), VaultError> {
        require_admin(&env);

        if face_value <= 0 { return Err(VaultError::Invalid); }
        if env.storage().persistent().has(&DataKey::Receivable(id.clone())) { return Err(VaultError::DuplicateId); }

        // approval checks
        let fund: FundRecord = env.storage().persistent().get(&DataKey::Fund(fund_id.clone())).ok_or(VaultError::NotFound)?;
        if let Status::Approved = fund.status {} else { return Err(VaultError::BadStatus); }

        let sac: EntityRecord = env.storage().persistent().get(&DataKey::Sacado(sacado_id.clone())).ok_or(VaultError::NotFound)?;
        if let Status::Approved = sac.status {} else { return Err(VaultError::BadStatus); }

        let _ced: EntityRecord = env.storage().persistent().get(&DataKey::Cedente(cedente_id.clone())).ok_or(VaultError::NotFound)?; // status opcional

        let r = Receivable {
            id: id.clone(),
            fund_id: fund_id.clone(),
            cedente_id,
            sacado_id,
            face_value,
            due_date,
            debtor_address,
            status: ReceivableStatus::Pending,
            paid_amount: 0,
            paid_date: 0,
        };
        set_persistent(&env, &DataKey::Receivable(id.clone()), &r);

        let cnt: u32 = env.storage().instance().get(&DataKey::ReceivableCount).unwrap_or(0);
        env.storage().instance().set(&DataKey::ReceivableCount, &(cnt + 1));
        ReceivableRegistered { fund_id, id, face_value }.publish(&env);
        Ok(())
    }

    /// Pays a receivable on-chain: `payer` (the fund wallet that collected from the debtor, or the debtor itself)
    /// transfers `amount` of the payment asset into the vault, where it stays until it is distributed.
    pub fn pay(env: Env, id: String, payer: Address, amount: i128) -> Result<(), VaultError> {
        payer.require_auth();
        bump_instance(&env);
        if amount <= 0 { return Err(VaultError::Invalid); }

        let mut r: Receivable = env.storage().persistent().get(&DataKey::Receivable(id.clone())).ok_or(VaultError::NotFound)?;
        match r.status {
            ReceivableStatus::Pending => {},
            _ => return Err(VaultError::BadStatus),
        }

        let payment: Address = env.storage().instance().get(&DataKey::PaymentToken).unwrap();
        token::Client::new(&env, &payment).transfer(&payer, &env.current_contract_address(), &amount);

        r.status = ReceivableStatus::Paid;
        r.paid_amount = amount;
        r.paid_date = env.ledger().timestamp();
        set_persistent(&env, &DataKey::Receivable(id.clone()), &r);

        let tot: i128 = env.storage().instance().get(&DataKey::TotalPaid).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalPaid, &add(tot, amount)?);
        ReceivablePaid { fund_id: r.fund_id, id, amount }.publish(&env);
        Ok(())
    }

    /// Pays the receivable's amount out of the vault to the fund's shareholders, pro rata to their FundToken balance.
    /// `holders` must list every shareholder exactly once: their balances must add up to the token's total supply,
    /// so nobody can be skipped or paid twice. The rounding residue goes to the largest holder.
    pub fn distribute(env: Env, receivable_id: String, holders: Vec<Address>) -> Result<(), VaultError> {
        require_admin(&env);

        let mut r: Receivable = env.storage().persistent().get(&DataKey::Receivable(receivable_id.clone())).ok_or(VaultError::NotFound)?;
        if let ReceivableStatus::Paid = r.status {} else { return Err(VaultError::BadStatus); }

        let fund: FundRecord = env.storage().persistent().get(&DataKey::Fund(r.fund_id.clone())).ok_or(VaultError::NotFound)?;
        let shares = FundTokenClient::new(&env, &fund.token);
        let total_supply = shares.total_supply();
        if total_supply <= 0 { return Err(VaultError::Invalid); }

        let mut balances: Vec<i128> = vec![&env];
        let mut listed: i128 = 0;
        let mut max_idx: u32 = 0;
        let mut max_bal: i128 = -1;
        for i in 0..holders.len() {
            let h = holders.get_unchecked(i);
            for j in 0..i {
                if holders.get_unchecked(j) == h { return Err(VaultError::DuplicateId); }
            }
            let bal = shares.balance(&h);
            balances.push_back(bal);
            listed = add(listed, bal)?;
            if bal > max_bal { max_bal = bal; max_idx = i; }
        }
        if listed != total_supply { return Err(VaultError::Invalid); }

        let payment: Address = env.storage().instance().get(&DataKey::PaymentToken).unwrap();
        let usdc = token::Client::new(&env, &payment);
        let vault = env.current_contract_address();
        let paid = r.paid_amount;
        let mut distributed: i128 = 0;

        for i in 0..holders.len() {
            let bal = balances.get_unchecked(i);
            if bal == 0 { continue; }
            let share = bal.checked_mul(paid).ok_or(VaultError::Math)? / total_supply;
            if share > 0 {
                let h = holders.get_unchecked(i);
                usdc.transfer(&vault, &h, &share);
                distributed = add(distributed, share)?;
                Distribution { fund_id: r.fund_id.clone(), holder: h, amount: share }.publish(&env);
            }
        }
        let residue = sub(paid, distributed)?;
        if residue > 0 {
            let h = holders.get_unchecked(max_idx);
            usdc.transfer(&vault, &h, &residue);
            DistributionResidue { fund_id: r.fund_id.clone(), holder: h, amount: residue }.publish(&env);
        }

        r.status = ReceivableStatus::Distributed;
        set_persistent(&env, &DataKey::Receivable(receivable_id.clone()), &r);
        DistributionSum { fund_id: r.fund_id, receivable_id, amount: paid }.publish(&env);
        Ok(())
    }

    // -------- Views --------
    pub fn get_receivable(env: Env, id: String) -> Result<Receivable, VaultError> {
        env.storage().persistent().get(&DataKey::Receivable(id)).ok_or(VaultError::NotFound)
    }
    pub fn get_receivables_count(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::ReceivableCount).unwrap_or(0)
    }
    pub fn get_total_paid(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalPaid).unwrap_or(0)
    }
    pub fn get_payment_token(env: Env) -> Address {
        env.storage().instance().get(&DataKey::PaymentToken).unwrap()
    }
    pub fn get_fund_token_address(env: Env) -> Address {
        env.storage().instance().get(&DataKey::FundTokenAddress).unwrap()
    }
    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }
}
