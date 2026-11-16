ALTER TABLE plan_catalog
  ADD COLUMN appointment_reminders_enabled boolean NOT NULL DEFAULT false;

-- Preserve existing paid-plan behavior; free plans remain without reminders.
UPDATE plan_catalog
SET appointment_reminders_enabled = (price_vnd > 0);
