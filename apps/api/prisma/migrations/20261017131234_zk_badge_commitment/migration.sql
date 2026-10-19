-- AlterTable
ALTER TABLE "users" ADD COLUMN     "badge_claim_tx_hash" TEXT,
ADD COLUMN     "badge_commitment" TEXT,
ADD COLUMN     "badge_onchain_threshold" INTEGER,
ADD COLUMN     "badge_salt" TEXT;
