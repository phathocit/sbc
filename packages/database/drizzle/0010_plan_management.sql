ALTER TABLE "plan_catalog" DROP CONSTRAINT "plan_catalog_code_valid";
--> statement-breakpoint
ALTER TABLE "plan_catalog" ADD CONSTRAINT "plan_catalog_code_valid" CHECK ("code" ~ '^[a-z0-9][a-z0-9_-]{0,23}$');
--> statement-breakpoint
ALTER TABLE "plan_catalog" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "plan_catalog" ADD COLUMN "features" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "plan_catalog" ADD CONSTRAINT "plan_catalog_sort_order_nonnegative" CHECK ("sort_order" >= 0);
--> statement-breakpoint
ALTER TABLE "plan_catalog" ADD CONSTRAINT "plan_catalog_features_array" CHECK (jsonb_typeof("features") = 'array');
--> statement-breakpoint
UPDATE "plan_catalog" SET "sort_order" = CASE "code" WHEN 'free' THEN 0 WHEN 'small' THEN 1 WHEN 'growth' THEN 2 ELSE 10 END;
--> statement-breakpoint
UPDATE "plan_catalog" SET "features" = CASE "code"
  WHEN 'growth' THEN '["Trang đặt lịch riêng cho tiệm", "Workspace quản lý lịch hẹn", "Quản lý dịch vụ cơ bản", "Báo cáo lịch đặt theo tháng"]'::jsonb
  ELSE '["Trang đặt lịch riêng cho tiệm", "Workspace quản lý lịch hẹn", "Quản lý dịch vụ cơ bản"]'::jsonb
END;
--> statement-breakpoint
CREATE UNIQUE INDEX "plan_catalog_one_active_version_uidx" ON "plan_catalog" USING btree ("code") WHERE "is_active" = true;
--> statement-breakpoint
CREATE TABLE "tenant_plan_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"from_plan_id" uuid,
	"to_plan_id" uuid NOT NULL,
	"note" varchar(1000) NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_plan_changes_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
	CONSTRAINT "tenant_plan_changes_actor_fk" FOREIGN KEY ("actor_user_id") REFERENCES "platform_admins"("user_id") ON DELETE RESTRICT,
	CONSTRAINT "tenant_plan_changes_from_plan_fk" FOREIGN KEY ("from_plan_id") REFERENCES "plan_catalog"("id") ON DELETE RESTRICT,
	CONSTRAINT "tenant_plan_changes_to_plan_fk" FOREIGN KEY ("to_plan_id") REFERENCES "plan_catalog"("id") ON DELETE RESTRICT,
	CONSTRAINT "tenant_plan_changes_note_nonempty" CHECK (length(trim("note")) BETWEEN 3 AND 1000)
);
--> statement-breakpoint
CREATE INDEX "tenant_plan_changes_tenant_changed_idx" ON "tenant_plan_changes" USING btree ("tenant_id", "changed_at");
