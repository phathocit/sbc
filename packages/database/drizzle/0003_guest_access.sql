CREATE TABLE "guest_access_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "booking_id" uuid NOT NULL,
  "token_hash" varchar(64) NOT NULL UNIQUE,
  "scope" varchar(32) DEFAULT 'booking:manage' NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "redeemed_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "guest_access_tokens_booking_fk" FOREIGN KEY ("tenant_id", "booking_id") REFERENCES "bookings"("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "guest_access_tokens_tenant_booking_id_unique" UNIQUE ("tenant_id", "booking_id", "id")
);
--> statement-breakpoint
CREATE INDEX "guest_access_tokens_booking_idx" ON "guest_access_tokens" USING btree ("tenant_id", "booking_id", "created_at");
--> statement-breakpoint

CREATE TABLE "guest_access_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "booking_id" uuid NOT NULL,
  "token_id" uuid NOT NULL,
  "session_hash" varchar(64) NOT NULL UNIQUE,
  "scope" varchar(32) DEFAULT 'booking:manage' NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "guest_access_sessions_booking_fk" FOREIGN KEY ("tenant_id", "booking_id") REFERENCES "bookings"("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "guest_access_sessions_token_fk" FOREIGN KEY ("tenant_id", "booking_id", "token_id") REFERENCES "guest_access_tokens"("tenant_id", "booking_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "guest_access_sessions_booking_idx" ON "guest_access_sessions" USING btree ("tenant_id", "booking_id", "expires_at");
--> statement-breakpoint

CREATE TABLE "public_rate_limits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key_hash" varchar(64) NOT NULL,
  "window_start" timestamp with time zone NOT NULL,
  "request_count" integer DEFAULT 1 NOT NULL CHECK ("request_count" > 0),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "public_rate_limits_key_window_unique" UNIQUE ("key_hash", "window_start")
);
--> statement-breakpoint
CREATE INDEX "public_rate_limits_created_idx" ON "public_rate_limits" USING btree ("created_at");
