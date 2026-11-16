CREATE TABLE IF NOT EXISTS "platform_admin_audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor_user_id" uuid NOT NULL,
  "tenant_id" uuid,
  "entity_type" varchar(40) NOT NULL,
  "entity_id" varchar(80) NOT NULL,
  "action" varchar(80) NOT NULL,
  "before" jsonb,
  "after" jsonb,
  "reason" text,
  "occurred_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "platform_admin_audit_actor_fk" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "platform_admin_audit_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "platform_admin_audit_time_idx" ON "platform_admin_audit_events" ("occurred_at");
CREATE INDEX IF NOT EXISTS "platform_admin_audit_entity_idx" ON "platform_admin_audit_events" ("entity_type", "entity_id", "occurred_at");
