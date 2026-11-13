ALTER TABLE "booking_reminder_deliveries"
  DROP CONSTRAINT "booking_reminder_deliveries_pk",
  DROP CONSTRAINT "booking_reminder_deliveries_type_check",
  ADD COLUMN "scheduled_starts_at" timestamp with time zone;

UPDATE "booking_reminder_deliveries" AS delivery
SET "scheduled_starts_at" = booking."starts_at",
    "reminder_type" = CASE
      WHEN delivery."reminder_type" = 'confirmation' AND delivery."lead_minutes" >= 20 THEN 'confirmation_20'
      WHEN delivery."reminder_type" = 'confirmation' AND delivery."lead_minutes" >= 10 THEN 'confirmation_10'
      WHEN delivery."reminder_type" = 'confirmation' THEN 'confirmation_5'
      ELSE delivery."reminder_type"
    END
FROM "bookings" AS booking
WHERE booking."tenant_id" = delivery."tenant_id"
  AND booking."id" = delivery."booking_id";

ALTER TABLE "booking_reminder_deliveries"
  ALTER COLUMN "scheduled_starts_at" SET NOT NULL,
  ALTER COLUMN "reminder_type" DROP DEFAULT,
  ADD CONSTRAINT "booking_reminder_deliveries_type_check"
    CHECK ("reminder_type" IN ('confirmation_20', 'confirmation_10', 'confirmation_5', 'upcoming')),
  ADD CONSTRAINT "booking_reminder_deliveries_pk"
    PRIMARY KEY ("tenant_id", "booking_id", "scheduled_starts_at", "reminder_type");
