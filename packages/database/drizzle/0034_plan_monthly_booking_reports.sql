ALTER TABLE plan_catalog
  ADD COLUMN monthly_booking_reports_enabled boolean NOT NULL DEFAULT false;

UPDATE plan_catalog
SET monthly_booking_reports_enabled = (code = 'growth');
