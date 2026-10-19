-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "share_holder" TEXT;

-- AlterTable
ALTER TABLE "pools" ADD COLUMN     "processed_tx_hashes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill: approved orders were minted to the investor's current wallet
UPDATE "orders" o SET "share_holder" = u."public_key"
FROM "users" u
WHERE o."investor_id" = u."id" AND o."approval_status" = 'APPROVED' AND o."share_holder" IS NULL;
