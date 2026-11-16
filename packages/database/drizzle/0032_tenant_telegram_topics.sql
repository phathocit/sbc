ALTER TABLE "tenant_telegram_integrations"
  ADD COLUMN IF NOT EXISTS "topic_threads" jsonb NOT NULL DEFAULT '{}'::jsonb;
