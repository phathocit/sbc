ALTER TABLE "outbox_messages"
  ADD COLUMN "lease_owner" varchar(128),
  ADD COLUMN "lease_until" timestamp with time zone,
  ADD COLUMN "dead_lettered_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX "outbox_messages_guest_delivery_idx"
  ON "outbox_messages" USING btree ("next_attempt_at", "lease_until", "occurred_at")
  WHERE "event_type" = 'guest_access.delivery.requested'
    AND "processed_at" IS NULL
    AND "dead_lettered_at" IS NULL;
