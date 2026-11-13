ALTER TABLE "tenant_applications" ALTER COLUMN "applicant_user_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenant_applications" ADD COLUMN "applicant_name" varchar(255);
--> statement-breakpoint
ALTER TABLE "tenant_applications" ADD COLUMN "applicant_email" varchar(255);
--> statement-breakpoint
ALTER TABLE "tenant_applications" ADD COLUMN "contact_phone" varchar(32);
--> statement-breakpoint
ALTER TABLE "tenant_applications" ADD COLUMN "service_type" varchar(120);
--> statement-breakpoint
ALTER TABLE "tenant_applications" ADD COLUMN "requested_plan" varchar(24);
--> statement-breakpoint

UPDATE "tenant_applications" a
SET "applicant_name" = u."display_name", "applicant_email" = u."email",
    "contact_phone" = 'Chưa cung cấp', "service_type" = 'Chưa cung cấp', "requested_plan" = 'free'
FROM "users" u WHERE a."applicant_user_id" = u."id";
--> statement-breakpoint

ALTER TABLE "tenant_applications" ALTER COLUMN "applicant_name" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenant_applications" ALTER COLUMN "applicant_email" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenant_applications" ALTER COLUMN "contact_phone" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenant_applications" ALTER COLUMN "service_type" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenant_applications" ALTER COLUMN "requested_plan" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenant_applications" ADD CONSTRAINT "tenant_applications_requested_plan_valid" CHECK ("requested_plan" IN ('free', 'small', 'growth'));
--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_applications_pending_email_uidx" ON "tenant_applications" ("applicant_email") WHERE "status" = 'pending';
--> statement-breakpoint

CREATE TABLE "tenant_owner_invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "application_id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL,
  "token_hash" varchar(64) NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tenant_owner_invitations_application_fk" FOREIGN KEY ("application_id") REFERENCES "tenant_applications"("id") ON DELETE CASCADE,
  CONSTRAINT "tenant_owner_invitations_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_owner_invitations_token_hash_uidx" ON "tenant_owner_invitations" ("token_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_owner_invitations_application_uidx" ON "tenant_owner_invitations" ("application_id");
--> statement-breakpoint
CREATE INDEX "tenant_owner_invitations_tenant_idx" ON "tenant_owner_invitations" ("tenant_id");
