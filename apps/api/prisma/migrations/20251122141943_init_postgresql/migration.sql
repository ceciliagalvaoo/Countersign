-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "public_key" TEXT,
    "secret_key" TEXT,
    "total_invested" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "investor_badge" TEXT NOT NULL DEFAULT 'NONE',
    "badge_proof_hash" TEXT,
    "last_badge_update" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cedentes" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "fantasy_name" TEXT,
    "cnae" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT DEFAULT 'BR',
    "postal_code" TEXT,
    "beneficial_owners" TEXT,
    "is_pep" BOOLEAN,
    "revenue_last_12m" DOUBLE PRECISION,
    "total_debt" DOUBLE PRECISION,
    "main_banks" TEXT,
    "risk_rating" TEXT,
    "operation_description" TEXT,
    "credit_policy" TEXT,
    "guarantees" TEXT,
    "public_key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "consultor_id" TEXT NOT NULL,
    "fund_id" TEXT NOT NULL,

    CONSTRAINT "cedentes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sacados" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "person_type" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT DEFAULT 'BR',
    "postal_code" TEXT,
    "sector" TEXT,
    "size" TEXT,
    "rating" TEXT,
    "payment_history" TEXT,
    "exposure" DOUBLE PRECISION,
    "credit_limit_fund" DOUBLE PRECISION,
    "concentration_percent" DOUBLE PRECISION,
    "default_rate_30d" DOUBLE PRECISION,
    "default_rate_60d" DOUBLE PRECISION,
    "default_rate_90d" DOUBLE PRECISION,
    "public_key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "consultor_id" TEXT NOT NULL,
    "fund_id" TEXT NOT NULL,

    CONSTRAINT "sacados_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funds" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "cnpj" TEXT,
    "investor_profile" TEXT,
    "cvm_code" TEXT,
    "administrator_name" TEXT,
    "administrator_cnpj" TEXT,
    "manager_name" TEXT,
    "manager_cnpj" TEXT,
    "custodian_name" TEXT,
    "auditor_name" TEXT,
    "fiduciary_agent_name" TEXT,
    "sector_focus" TEXT,
    "eligibility_criteria" TEXT,
    "max_cedente_concentration_pct" DOUBLE PRECISION,
    "max_sacado_concentration_pct" DOUBLE PRECISION,
    "sector_concentration_pct" DOUBLE PRECISION,
    "target_pmt" DOUBLE PRECISION,
    "key_risks" TEXT,
    "administration_fee" DOUBLE PRECISION,
    "management_fee" DOUBLE PRECISION,
    "performance_fee" DOUBLE PRECISION,
    "other_fees" TEXT,
    "liquidity_type" TEXT,
    "lockup_days" INTEGER,
    "redemption_terms" TEXT,
    "nav_per_share" DOUBLE PRECISION,
    "aum" DOUBLE PRECISION,
    "return_12m" DOUBLE PRECISION,
    "return_ytd" DOUBLE PRECISION,
    "return_since_inception" DOUBLE PRECISION,
    "contract_address" TEXT,
    "token_contract_id" TEXT,
    "vault_contract_id" TEXT,
    "admin_secret_key" TEXT,
    "fund_wallet_public_key" TEXT,
    "max_supply" INTEGER NOT NULL,
    "total_issued" INTEGER NOT NULL DEFAULT 0,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "target_amount" DOUBLE PRECISION,
    "description" TEXT,
    "fund_type" TEXT NOT NULL DEFAULT 'FIDC',
    "risk_level" TEXT,
    "sector" TEXT,
    "duration_months" INTEGER,
    "min_ticket" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "consultor_id" TEXT,

    CONSTRAINT "funds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pools" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "blend_pool_address" TEXT NOT NULL,
    "asset_address" TEXT NOT NULL,
    "total_deposited" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "current_balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "yield_earned" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "apy" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "last_yield_update" TIMESTAMP(3),
    "deposit_tx_hash" TEXT,
    "withdraw_tx_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "fund_id" TEXT NOT NULL,

    CONSTRAINT "pools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivables" (
    "id" TEXT NOT NULL,
    "face_value" DOUBLE PRECISION NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paid_value" DOUBLE PRECISION,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "fund_id" TEXT NOT NULL,
    "sacado_id" TEXT NOT NULL,

    CONSTRAINT "receivables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approval_status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "tx_hash" TEXT,
    "refund_tx_hash" TEXT,
    "token_mint_tx_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "investor_id" TEXT NOT NULL,
    "fund_id" TEXT NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fund_interactions" (
    "id" TEXT NOT NULL,
    "investor_id" TEXT NOT NULL,
    "fund_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fund_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "funds_symbol_key" ON "funds"("symbol");

-- AddForeignKey
ALTER TABLE "cedentes" ADD CONSTRAINT "cedentes_consultor_id_fkey" FOREIGN KEY ("consultor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cedentes" ADD CONSTRAINT "cedentes_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sacados" ADD CONSTRAINT "sacados_consultor_id_fkey" FOREIGN KEY ("consultor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sacados" ADD CONSTRAINT "sacados_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funds" ADD CONSTRAINT "funds_consultor_id_fkey" FOREIGN KEY ("consultor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pools" ADD CONSTRAINT "pools_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_sacado_id_fkey" FOREIGN KEY ("sacado_id") REFERENCES "sacados"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_investor_id_fkey" FOREIGN KEY ("investor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_interactions" ADD CONSTRAINT "fund_interactions_investor_id_fkey" FOREIGN KEY ("investor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_interactions" ADD CONSTRAINT "fund_interactions_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
