ALTER TABLE "booking_allocations" ADD COLUMN "segment_index" integer NOT NULL DEFAULT 0;
DROP INDEX IF EXISTS "booking_allocations_one_active_per_booking";
DROP INDEX IF EXISTS "booking_allocations_one_current_per_booking";
CREATE UNIQUE INDEX "booking_allocations_one_active_per_segment" ON "booking_allocations" ("tenant_id", "booking_id", "segment_index") WHERE "active" = true;
CREATE UNIQUE INDEX "booking_allocations_one_current_per_segment" ON "booking_allocations" ("tenant_id", "booking_id", "segment_index") WHERE "is_current" = true;
