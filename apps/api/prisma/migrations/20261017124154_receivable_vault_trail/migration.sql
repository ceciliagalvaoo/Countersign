-- AlterTable
ALTER TABLE "receivables" ADD COLUMN     "cedente_id" TEXT,
ADD COLUMN     "chain_status" TEXT NOT NULL DEFAULT 'NOT_REGISTERED',
ADD COLUMN     "chain_tx_hash" TEXT;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_cedente_id_fkey" FOREIGN KEY ("cedente_id") REFERENCES "cedentes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
