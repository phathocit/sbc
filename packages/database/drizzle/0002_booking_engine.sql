CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

CREATE TABLE "customers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "display_name" varchar(255) NOT NULL,
  "email_normalized" varchar(255) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "customers_tenant_id_id_unique" UNIQUE("tenant_id", "id")
);
--> statement-breakpoint
CREATE INDEX "customers_tenant_created_idx" ON "customers" USING btree ("tenant_id", "created_at");
--> statement-breakpoint

CREATE TABLE "bookings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "location_id" uuid NOT NULL,
  "customer_id" uuid NOT NULL,
  "service_id" uuid NOT NULL,
  "starts_at" timestamp with time zone NOT NULL,
  "ends_at" timestamp with time zone NOT NULL,
  "status" varchar(24) NOT NULL,
  "pending_expires_at" timestamp with time zone,
  "service_snapshot" jsonb NOT NULL,
  "policy_snapshot" jsonb NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "bookings_tenant_id_id_unique" UNIQUE("tenant_id", "id"),
  CONSTRAINT "bookings_location_tenant_fk" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "locations"("tenant_id", "id"),
  CONSTRAINT "bookings_customer_tenant_fk" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id"),
  CONSTRAINT "bookings_service_tenant_fk" FOREIGN KEY ("tenant_id", "service_id") REFERENCES "services"("tenant_id", "id"),
  CONSTRAINT "bookings_positive_interval" CHECK ("starts_at" < "ends_at"),
  CONSTRAINT "bookings_status_valid" CHECK ("status" IN ('PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'COMPLETED', 'NO_SHOW')),
  CONSTRAINT "bookings_pending_expiry_valid" CHECK (("status" = 'PENDING' AND "pending_expires_at" IS NOT NULL) OR ("status" <> 'PENDING' AND "pending_expires_at" IS NULL))
);
--> statement-breakpoint
CREATE INDEX "bookings_tenant_location_start_idx" ON "bookings" USING btree ("tenant_id", "location_id", "starts_at");
--> statement-breakpoint
CREATE INDEX "bookings_tenant_status_expiry_idx" ON "bookings" USING btree ("tenant_id", "status", "pending_expires_at");
--> statement-breakpoint

CREATE TABLE "booking_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "booking_id" uuid NOT NULL,
  "staff_id" uuid NOT NULL,
  "occupied_start" timestamp with time zone NOT NULL,
  "occupied_end" timestamp with time zone NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "is_current" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "booking_allocations_booking_tenant_fk" FOREIGN KEY ("tenant_id", "booking_id") REFERENCES "bookings"("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "booking_allocations_staff_tenant_fk" FOREIGN KEY ("tenant_id", "staff_id") REFERENCES "staff_profiles"("tenant_id", "id"),
  CONSTRAINT "booking_allocations_positive_interval" CHECK ("occupied_start" < "occupied_end"),
  CONSTRAINT "booking_allocations_active_is_current" CHECK (NOT "active" OR "is_current")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "booking_allocations_one_active_per_booking" ON "booking_allocations" USING btree ("tenant_id", "booking_id") WHERE "active" = true;
--> statement-breakpoint
CREATE UNIQUE INDEX "booking_allocations_one_current_per_booking" ON "booking_allocations" USING btree ("tenant_id", "booking_id") WHERE "is_current" = true;
--> statement-breakpoint
CREATE INDEX "booking_allocations_tenant_staff_start_idx" ON "booking_allocations" USING btree ("tenant_id", "staff_id", "occupied_start");
--> statement-breakpoint
ALTER TABLE "booking_allocations" ADD CONSTRAINT "booking_allocations_no_staff_overlap" EXCLUDE USING gist (
  "tenant_id" WITH =,
  "staff_id" WITH =,
  tstzrange("occupied_start", "occupied_end", '[)') WITH &&
) WHERE ("active" = true);
--> statement-breakpoint

CREATE TABLE "booking_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "booking_id" uuid NOT NULL,
  "actor_type" varchar(16) NOT NULL,
  "actor_id" uuid,
  "event_type" varchar(48) NOT NULL,
  "summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "booking_events_booking_tenant_fk" FOREIGN KEY ("tenant_id", "booking_id") REFERENCES "bookings"("tenant_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "booking_events_tenant_booking_time_idx" ON "booking_events" USING btree ("tenant_id", "booking_id", "occurred_at");
--> statement-breakpoint

CREATE TABLE "idempotency_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "operation" varchar(48) NOT NULL,
  "key" varchar(255) NOT NULL,
  "request_hash" varchar(64) NOT NULL,
  "result_booking_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "idempotency_tenant_actor_operation_key_unique" UNIQUE("tenant_id", "actor_id", "operation", "key"),
  CONSTRAINT "idempotency_booking_tenant_fk" FOREIGN KEY ("tenant_id", "result_booking_id") REFERENCES "bookings"("tenant_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint

CREATE TABLE "outbox_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid REFERENCES "tenants"("id") ON DELETE CASCADE,
  "event_type" varchar(80) NOT NULL,
  "payload" jsonb NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone,
  "failure_reason" varchar(1000)
);
--> statement-breakpoint
CREATE INDEX "outbox_messages_pending_idx" ON "outbox_messages" USING btree ("next_attempt_at", "occurred_at");
