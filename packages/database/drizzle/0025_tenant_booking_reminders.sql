ALTER TABLE "tenant_policies"
  ADD COLUMN "appointment_reminder_minutes" integer DEFAULT 30,
  ADD CONSTRAINT "tenant_policies_appointment_reminder_minutes_check"
    CHECK ("appointment_reminder_minutes" IS NULL OR "appointment_reminder_minutes" BETWEEN 1 AND 1440);

CREATE INDEX "bookings_confirmed_reminder_due_idx"
  ON "bookings" USING btree ("status", "starts_at")
  WHERE "status" = 'CONFIRMED';

CREATE TABLE "booking_reminder_deliveries" (
  "tenant_id" uuid NOT NULL,
  "booking_id" uuid NOT NULL,
  "notification_id" uuid NOT NULL,
  "lead_minutes" integer NOT NULL,
  "delivered_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "booking_reminder_deliveries_pk" PRIMARY KEY ("tenant_id", "booking_id"),
  CONSTRAINT "booking_reminder_deliveries_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade,
  CONSTRAINT "booking_reminder_deliveries_booking_fk" FOREIGN KEY ("tenant_id", "booking_id") REFERENCES "public"."bookings"("tenant_id", "id") ON DELETE cascade,
  CONSTRAINT "booking_reminder_deliveries_notification_fk" FOREIGN KEY ("tenant_id", "notification_id") REFERENCES "public"."tenant_notifications"("tenant_id", "id") ON DELETE cascade,
  CONSTRAINT "booking_reminder_deliveries_lead_minutes_check" CHECK ("lead_minutes" BETWEEN 1 AND 1440)
);
