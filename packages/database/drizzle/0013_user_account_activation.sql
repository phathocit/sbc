ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "account_status" varchar(24) DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_account_status_valid" CHECK ("account_status" IN ('active', 'pending_activation'));
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_active_password_required" CHECK ("account_status" <> 'active' OR "password_hash" IS NOT NULL);