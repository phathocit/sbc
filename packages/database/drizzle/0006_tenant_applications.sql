CREATE TABLE "tenant_applications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "applicant_user_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  "slug" varchar(63) NOT NULL,
  "timezone" varchar(100) NOT NULL,
  "currency" varchar(3) NOT NULL,
  "status" varchar(24) DEFAULT 'pending' NOT NULL,
  "reviewed_by" uuid,
  "reviewed_at" timestamp with time zone,
  "review_note" text,
  "tenant_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tenant_applications_applicant_fk" FOREIGN KEY ("applicant_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "tenant_applications_reviewer_fk" FOREIGN KEY ("reviewed_by") REFERENCES "platform_admins"("user_id") ON DELETE RESTRICT,
  CONSTRAINT "tenant_applications_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT,
  CONSTRAINT "tenant_applications_status_valid" CHECK ("status" IN ('pending', 'approved', 'rejected')),
  CONSTRAINT "tenant_applications_review_state_valid" CHECK (
    ("status" = 'pending' AND "reviewed_by" IS NULL AND "reviewed_at" IS NULL AND "tenant_id" IS NULL) OR
    ("status" = 'approved' AND "reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL AND "tenant_id" IS NOT NULL) OR
    ("status" = 'rejected' AND "reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL AND "tenant_id" IS NULL)
  )
);
--> statement-breakpoint
CREATE INDEX "tenant_applications_status_created_idx" ON "tenant_applications" USING btree ("status", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_applications_pending_applicant_uidx" ON "tenant_applications" USING btree ("applicant_user_id") WHERE "status" = 'pending';
--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_applications_pending_slug_uidx" ON "tenant_applications" USING btree ("slug") WHERE "status" = 'pending';
