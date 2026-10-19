-- Countersign stellar-integrator: mandate wallets and orders paid by a mandate wallet (C...)

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "payer_address" TEXT;
ALTER TABLE "orders" ADD COLUMN "decision_hash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "orders_decision_hash_key" ON "orders"("decision_hash");

-- CreateTable
CREATE TABLE "mandate_wallets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "owner_address" TEXT NOT NULL,
    "agent_public_key" TEXT NOT NULL,
    "usdc_contract_id" TEXT NOT NULL,
    "deploy_tx_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mandate_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mandate_wallets_user_id_key" ON "mandate_wallets"("user_id");
CREATE UNIQUE INDEX "mandate_wallets_contract_id_key" ON "mandate_wallets"("contract_id");
CREATE UNIQUE INDEX "mandate_wallets_deploy_tx_hash_key" ON "mandate_wallets"("deploy_tx_hash");
