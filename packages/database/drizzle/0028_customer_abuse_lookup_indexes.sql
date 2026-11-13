CREATE INDEX IF NOT EXISTS "customers_tenant_phone_lookup_idx"
  ON "customers" ("tenant_id", "phone_normalized");

CREATE INDEX IF NOT EXISTS "customers_tenant_email_lookup_idx"
  ON "customers" ("tenant_id", "email_normalized");

CREATE INDEX IF NOT EXISTS "bookings_tenant_customer_created_idx"
  ON "bookings" ("tenant_id", "customer_id", "created_at");
