-- CreateIndex
CREATE INDEX "cedentes_consultor_id_idx" ON "cedentes"("consultor_id");

-- CreateIndex
CREATE INDEX "cedentes_fund_id_idx" ON "cedentes"("fund_id");

-- CreateIndex
CREATE INDEX "cedentes_status_idx" ON "cedentes"("status");

-- CreateIndex
CREATE INDEX "cedentes_consultor_id_status_idx" ON "cedentes"("consultor_id", "status");

-- CreateIndex
CREATE INDEX "cedentes_fund_id_status_idx" ON "cedentes"("fund_id", "status");

-- CreateIndex
CREATE INDEX "cedentes_document_idx" ON "cedentes"("document");

-- CreateIndex
CREATE INDEX "cedentes_created_at_idx" ON "cedentes"("created_at");

-- CreateIndex
CREATE INDEX "fund_interactions_investor_id_idx" ON "fund_interactions"("investor_id");

-- CreateIndex
CREATE INDEX "fund_interactions_fund_id_idx" ON "fund_interactions"("fund_id");

-- CreateIndex
CREATE INDEX "fund_interactions_type_idx" ON "fund_interactions"("type");

-- CreateIndex
CREATE INDEX "fund_interactions_investor_id_fund_id_idx" ON "fund_interactions"("investor_id", "fund_id");

-- CreateIndex
CREATE INDEX "fund_interactions_investor_id_type_idx" ON "fund_interactions"("investor_id", "type");

-- CreateIndex
CREATE INDEX "fund_interactions_fund_id_type_idx" ON "fund_interactions"("fund_id", "type");

-- CreateIndex
CREATE INDEX "fund_interactions_investor_id_created_at_idx" ON "fund_interactions"("investor_id", "created_at");

-- CreateIndex
CREATE INDEX "fund_interactions_created_at_idx" ON "fund_interactions"("created_at");

-- CreateIndex
CREATE INDEX "funds_symbol_idx" ON "funds"("symbol");

-- CreateIndex
CREATE INDEX "funds_status_idx" ON "funds"("status");

-- CreateIndex
CREATE INDEX "funds_consultor_id_idx" ON "funds"("consultor_id");

-- CreateIndex
CREATE INDEX "funds_fund_type_idx" ON "funds"("fund_type");

-- CreateIndex
CREATE INDEX "funds_risk_level_idx" ON "funds"("risk_level");

-- CreateIndex
CREATE INDEX "funds_sector_idx" ON "funds"("sector");

-- CreateIndex
CREATE INDEX "funds_status_fund_type_idx" ON "funds"("status", "fund_type");

-- CreateIndex
CREATE INDEX "funds_status_risk_level_idx" ON "funds"("status", "risk_level");

-- CreateIndex
CREATE INDEX "funds_status_sector_idx" ON "funds"("status", "sector");

-- CreateIndex
CREATE INDEX "funds_fund_type_risk_level_sector_idx" ON "funds"("fund_type", "risk_level", "sector");

-- CreateIndex
CREATE INDEX "funds_consultor_id_status_idx" ON "funds"("consultor_id", "status");

-- CreateIndex
CREATE INDEX "funds_created_at_idx" ON "funds"("created_at");

-- CreateIndex
CREATE INDEX "funds_price_idx" ON "funds"("price");

-- CreateIndex
CREATE INDEX "orders_investor_id_idx" ON "orders"("investor_id");

-- CreateIndex
CREATE INDEX "orders_fund_id_idx" ON "orders"("fund_id");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "orders_approval_status_idx" ON "orders"("approval_status");

-- CreateIndex
CREATE INDEX "orders_created_at_idx" ON "orders"("created_at");

-- CreateIndex
CREATE INDEX "orders_investor_id_status_idx" ON "orders"("investor_id", "status");

-- CreateIndex
CREATE INDEX "orders_fund_id_status_idx" ON "orders"("fund_id", "status");

-- CreateIndex
CREATE INDEX "orders_investor_id_created_at_idx" ON "orders"("investor_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_status_approval_status_idx" ON "orders"("status", "approval_status");

-- CreateIndex
CREATE INDEX "orders_status_created_at_idx" ON "orders"("status", "created_at");

-- CreateIndex
CREATE INDEX "orders_updated_at_idx" ON "orders"("updated_at");

-- CreateIndex
CREATE INDEX "pools_fund_id_idx" ON "pools"("fund_id");

-- CreateIndex
CREATE INDEX "pools_status_idx" ON "pools"("status");

-- CreateIndex
CREATE INDEX "pools_fund_id_status_idx" ON "pools"("fund_id", "status");

-- CreateIndex
CREATE INDEX "pools_last_yield_update_idx" ON "pools"("last_yield_update");

-- CreateIndex
CREATE INDEX "pools_created_at_idx" ON "pools"("created_at");

-- CreateIndex
CREATE INDEX "receivables_fund_id_idx" ON "receivables"("fund_id");

-- CreateIndex
CREATE INDEX "receivables_sacado_id_idx" ON "receivables"("sacado_id");

-- CreateIndex
CREATE INDEX "receivables_status_idx" ON "receivables"("status");

-- CreateIndex
CREATE INDEX "receivables_due_date_idx" ON "receivables"("due_date");

-- CreateIndex
CREATE INDEX "receivables_fund_id_status_idx" ON "receivables"("fund_id", "status");

-- CreateIndex
CREATE INDEX "receivables_sacado_id_status_idx" ON "receivables"("sacado_id", "status");

-- CreateIndex
CREATE INDEX "receivables_status_due_date_idx" ON "receivables"("status", "due_date");

-- CreateIndex
CREATE INDEX "receivables_created_at_idx" ON "receivables"("created_at");

-- CreateIndex
CREATE INDEX "sacados_consultor_id_idx" ON "sacados"("consultor_id");

-- CreateIndex
CREATE INDEX "sacados_fund_id_idx" ON "sacados"("fund_id");

-- CreateIndex
CREATE INDEX "sacados_status_idx" ON "sacados"("status");

-- CreateIndex
CREATE INDEX "sacados_consultor_id_status_idx" ON "sacados"("consultor_id", "status");

-- CreateIndex
CREATE INDEX "sacados_fund_id_status_idx" ON "sacados"("fund_id", "status");

-- CreateIndex
CREATE INDEX "sacados_document_idx" ON "sacados"("document");

-- CreateIndex
CREATE INDEX "sacados_created_at_idx" ON "sacados"("created_at");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_investor_badge_idx" ON "users"("investor_badge");

-- CreateIndex
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");

-- CreateIndex
CREATE INDEX "users_total_invested_idx" ON "users"("total_invested");

-- CreateIndex
CREATE INDEX "users_created_at_idx" ON "users"("created_at");
