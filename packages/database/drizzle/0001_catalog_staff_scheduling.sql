CREATE TABLE "services" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" varchar(160) NOT NULL,
  "description" varchar(2000),
  "duration_minutes" integer NOT NULL,
  "buffer_before_minutes" integer DEFAULT 0 NOT NULL,
  "buffer_after_minutes" integer DEFAULT 0 NOT NULL,
  "price_minor" integer DEFAULT 0 NOT NULL,
  "currency" varchar(3) NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "published" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "services_tenant_id_id_unique" UNIQUE("tenant_id", "id"),
  CONSTRAINT "services_duration_positive" CHECK ("duration_minutes" > 0),
  CONSTRAINT "services_buffers_nonnegative" CHECK ("buffer_before_minutes" >= 0 AND "buffer_after_minutes" >= 0),
  CONSTRAINT "services_price_nonnegative" CHECK ("price_minor" >= 0)
);
--> statement-breakpoint

CREATE TABLE "staff_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "location_id" uuid NOT NULL,
  "user_id" uuid,
  "name" varchar(160) NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "staff_profiles_tenant_id_id_unique" UNIQUE("tenant_id", "id"),
  CONSTRAINT "staff_profiles_location_tenant_fk" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "locations"("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "staff_profiles_membership_user_fk" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "memberships"("tenant_id", "user_id")
);
--> statement-breakpoint

CREATE TABLE "staff_services" (
  "tenant_id" uuid NOT NULL,
  "staff_id" uuid NOT NULL,
  "service_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "staff_services_pk" PRIMARY KEY("tenant_id", "staff_id", "service_id"),
  CONSTRAINT "staff_services_staff_tenant_fk" FOREIGN KEY ("tenant_id", "staff_id") REFERENCES "staff_profiles"("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "staff_services_service_tenant_fk" FOREIGN KEY ("tenant_id", "service_id") REFERENCES "services"("tenant_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint

CREATE TABLE "business_hours" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "location_id" uuid NOT NULL,
  "weekday" integer NOT NULL,
  "local_start" time NOT NULL,
  "local_end" time NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "business_hours_tenant_id_id_unique" UNIQUE("tenant_id", "id"),
  CONSTRAINT "business_hours_location_tenant_fk" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "locations"("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "business_hours_weekday_range" CHECK ("weekday" BETWEEN 0 AND 6),
  CONSTRAINT "business_hours_positive_interval" CHECK ("local_start" < "local_end")
);
--> statement-breakpoint

CREATE TABLE "staff_hours" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "staff_id" uuid NOT NULL,
  "weekday" integer NOT NULL,
  "local_start" time NOT NULL,
  "local_end" time NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "staff_hours_tenant_id_id_unique" UNIQUE("tenant_id", "id"),
  CONSTRAINT "staff_hours_staff_tenant_fk" FOREIGN KEY ("tenant_id", "staff_id") REFERENCES "staff_profiles"("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "staff_hours_weekday_range" CHECK ("weekday" BETWEEN 0 AND 6),
  CONSTRAINT "staff_hours_positive_interval" CHECK ("local_start" < "local_end")
);
--> statement-breakpoint

CREATE TABLE "schedule_exceptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "scope" varchar(16) NOT NULL,
  "location_id" uuid,
  "staff_id" uuid,
  "on_date" date NOT NULL,
  "local_start" time NOT NULL,
  "local_end" time NOT NULL,
  "kind" varchar(16) NOT NULL,
  "reason" varchar(500),
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "schedule_exceptions_location_tenant_fk" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "locations"("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "schedule_exceptions_staff_tenant_fk" FOREIGN KEY ("tenant_id", "staff_id") REFERENCES "staff_profiles"("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "schedule_exceptions_scope_target" CHECK (("scope" = 'location' AND "location_id" IS NOT NULL AND "staff_id" IS NULL) OR ("scope" = 'staff' AND "staff_id" IS NOT NULL AND "location_id" IS NULL)),
  CONSTRAINT "schedule_exceptions_kind" CHECK ("kind" IN ('unavailable', 'available')),
  CONSTRAINT "schedule_exceptions_positive_interval" CHECK ("local_start" < "local_end")
);
--> statement-breakpoint

CREATE INDEX "services_tenant_active_idx" ON "services" USING btree ("tenant_id", "active");
--> statement-breakpoint
CREATE INDEX "staff_profiles_tenant_location_active_idx" ON "staff_profiles" USING btree ("tenant_id", "location_id", "active");
--> statement-breakpoint
CREATE INDEX "staff_services_tenant_service_idx" ON "staff_services" USING btree ("tenant_id", "service_id");
--> statement-breakpoint
CREATE INDEX "business_hours_tenant_weekday_idx" ON "business_hours" USING btree ("tenant_id", "location_id", "weekday");
--> statement-breakpoint
CREATE INDEX "staff_hours_tenant_weekday_idx" ON "staff_hours" USING btree ("tenant_id", "staff_id", "weekday");
--> statement-breakpoint
CREATE INDEX "schedule_exceptions_tenant_date_idx" ON "schedule_exceptions" USING btree ("tenant_id", "on_date", "active");
