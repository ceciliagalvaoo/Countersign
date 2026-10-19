-- Countersign policy-guard: mandates, hash-chained decision log, decision executions, agent keys

-- CreateTable
CREATE TABLE "mandates" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "json" TEXT NOT NULL,
    "hash" TEXT,
    "status" TEXT NOT NULL,
    "approved_at" TIMESTAMP(3),
    "on_chain_tx_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mandates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_logs" (
    "seq" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "prev_hash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_logs_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "decision_executions" (
    "seq" INTEGER NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "tx_hash" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "decision_executions_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "agent_keys" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "auth_tag" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mandates_user_id_status_idx" ON "mandates"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "mandates_user_id_version_key" ON "mandates"("user_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "decision_logs_hash_key" ON "decision_logs"("hash");

-- CreateIndex
CREATE INDEX "decision_logs_user_id_seq_idx" ON "decision_logs"("user_id", "seq");

-- CreateIndex
CREATE INDEX "decision_executions_user_id_status_idx" ON "decision_executions"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "agent_keys_user_id_key" ON "agent_keys"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_keys_public_key_key" ON "agent_keys"("public_key");


-- The decision log is append-only: reject UPDATE, DELETE and TRUNCATE from the application.
-- (A database owner can still disable the trigger; that is why GET /api/decision-log/verify recomputes the chain.)
CREATE OR REPLACE FUNCTION decision_logs_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'decision_logs is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER decision_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON "decision_logs"
  FOR EACH ROW EXECUTE FUNCTION decision_logs_append_only();

CREATE TRIGGER decision_logs_no_truncate
  BEFORE TRUNCATE ON "decision_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION decision_logs_append_only();
