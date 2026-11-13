ALTER TABLE "booking_reminder_deliveries"
  DROP CONSTRAINT "booking_reminder_deliveries_pk",
  ADD COLUMN "reminder_type" varchar(24) DEFAULT 'upcoming' NOT NULL,
  ADD CONSTRAINT "booking_reminder_deliveries_type_check"
    CHECK ("reminder_type" IN ('confirmation', 'upcoming')),
  ADD CONSTRAINT "booking_reminder_deliveries_pk"
    PRIMARY KEY ("tenant_id", "booking_id", "reminder_type");
