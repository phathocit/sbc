ALTER TABLE "tenant_telegram_integrations"
  ADD COLUMN IF NOT EXISTS "bot_id" varchar(32),
  ADD COLUMN IF NOT EXISTS "update_offset" bigint NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_telegram_integrations_bot_uidx"
  ON "tenant_telegram_integrations" ("bot_id") WHERE "bot_id" IS NOT NULL;
