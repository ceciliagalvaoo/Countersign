-- CreateTable
CREATE TABLE "multisig_transactions" (
    "id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "xdr" TEXT NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "signed_by" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "multisig_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "multisig_transactions_purpose_status_idx" ON "multisig_transactions"("purpose", "status");
