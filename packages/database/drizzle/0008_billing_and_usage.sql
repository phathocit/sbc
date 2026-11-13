CREATE TABLE "plan_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(24) NOT NULL,
	"version" integer NOT NULL,
	"display_name" varchar(80) NOT NULL,
	"price_vnd" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'VND' NOT NULL,
	"active_staff_limit" integer NOT NULL,
	"monthly_booking_limit" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_catalog_code_valid" CHECK ("code" IN ('free', 'small', 'growth')),
	CONSTRAINT "plan_catalog_version_positive" CHECK ("version" > 0),
	CONSTRAINT "plan_catalog_price_nonnegative" CHECK ("price_vnd" >= 0),
	CONSTRAINT "plan_catalog_staff_limit_positive" CHECK ("active_staff_limit" > 0),
	CONSTRAINT "plan_catalog_booking_limit_nonnegative" CHECK ("monthly_booking_limit" IS NULL OR "monthly_booking_limit" >= 0),
	CONSTRAINT "plan_catalog_currency_vnd" CHECK ("currency" = 'VND')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "plan_catalog_code_version_uidx" ON "plan_catalog" USING btree ("code", "version");
--> statement-breakpoint
CREATE INDEX "plan_catalog_active_idx" ON "plan_catalog" USING btree ("is_active", "code");
--> statement-breakpoint
CREATE TABLE "tenant_subscriptions" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" varchar(24) DEFAULT 'active' NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_subscriptions_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade,
	CONSTRAINT "tenant_subscriptions_plan_fk" FOREIGN KEY ("plan_id") REFERENCES "plan_catalog"("id") ON DELETE restrict,
	CONSTRAINT "tenant_subscriptions_status_valid" CHECK ("status" IN ('active', 'past_due', 'expired')),
	CONSTRAINT "tenant_subscriptions_period_valid" CHECK ("current_period_start" < "current_period_end")
);
--> statement-breakpoint
CREATE INDEX "tenant_subscriptions_plan_status_idx" ON "tenant_subscriptions" USING btree ("plan_id", "status");
--> statement-breakpoint
CREATE INDEX "tenant_subscriptions_period_end_idx" ON "tenant_subscriptions" USING btree ("status", "current_period_end");
--> statement-breakpoint
CREATE TABLE "billing_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"target_plan_id" uuid NOT NULL,
	"provider" varchar(16) NOT NULL,
	"order_reference" varchar(100) NOT NULL,
	"amount_vnd" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'VND' NOT NULL,
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_orders_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict,
	CONSTRAINT "billing_orders_plan_fk" FOREIGN KEY ("target_plan_id") REFERENCES "plan_catalog"("id") ON DELETE restrict,
	CONSTRAINT "billing_orders_provider_valid" CHECK ("provider" IN ('vnpay', 'momo')),
	CONSTRAINT "billing_orders_status_valid" CHECK ("status" IN ('pending', 'paid', 'failed', 'expired', 'cancelled', 'refunded')),
	CONSTRAINT "billing_orders_amount_positive" CHECK ("amount_vnd" > 0),
	CONSTRAINT "billing_orders_currency_vnd" CHECK ("currency" = 'VND'),
	CONSTRAINT "billing_orders_paid_state_valid" CHECK (("status" = 'paid' AND "paid_at" IS NOT NULL) OR ("status" <> 'paid' AND "paid_at" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_orders_order_reference_uidx" ON "billing_orders" USING btree ("order_reference");
--> statement-breakpoint
CREATE INDEX "billing_orders_tenant_created_idx" ON "billing_orders" USING btree ("tenant_id", "created_at");
--> statement-breakpoint
CREATE INDEX "billing_orders_expiry_idx" ON "billing_orders" USING btree ("status", "expires_at");
--> statement-breakpoint
CREATE TABLE "payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" varchar(16) NOT NULL,
	"provider_request_id" varchar(128) NOT NULL,
	"provider_order_reference" varchar(128) NOT NULL,
	"provider_transaction_id" varchar(128),
	"checkout_url" text,
	"status" varchar(24) DEFAULT 'initializing' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "payment_attempts_order_fk" FOREIGN KEY ("order_id") REFERENCES "billing_orders"("id") ON DELETE restrict,
	CONSTRAINT "payment_attempts_provider_valid" CHECK ("provider" IN ('vnpay', 'momo')),
	CONSTRAINT "payment_attempts_status_valid" CHECK ("status" IN ('initializing', 'pending', 'succeeded', 'failed', 'expired', 'cancelled')),
	CONSTRAINT "payment_attempts_completion_state_valid" CHECK (("status" IN ('succeeded', 'failed', 'expired', 'cancelled') AND "completed_at" IS NOT NULL) OR ("status" IN ('initializing', 'pending') AND "completed_at" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_provider_request_uidx" ON "payment_attempts" USING btree ("provider", "provider_request_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_provider_order_uidx" ON "payment_attempts" USING btree ("provider", "provider_order_reference");
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_provider_transaction_uidx" ON "payment_attempts" USING btree ("provider", "provider_transaction_id") WHERE "provider_transaction_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "payment_attempts_order_created_idx" ON "payment_attempts" USING btree ("order_id", "created_at");
--> statement-breakpoint
CREATE TABLE "payment_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(16) NOT NULL,
	"event_key" varchar(255) NOT NULL,
	"order_id" uuid NOT NULL,
	"payment_attempt_id" uuid NOT NULL,
	"signature_verified" boolean NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(24) DEFAULT 'received' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "payment_webhook_events_order_fk" FOREIGN KEY ("order_id") REFERENCES "billing_orders"("id") ON DELETE restrict,
	CONSTRAINT "payment_webhook_events_attempt_fk" FOREIGN KEY ("payment_attempt_id") REFERENCES "payment_attempts"("id") ON DELETE restrict,
	CONSTRAINT "payment_webhook_events_provider_valid" CHECK ("provider" IN ('vnpay', 'momo')),
	CONSTRAINT "payment_webhook_events_status_valid" CHECK ("status" IN ('received', 'processed', 'failed')),
	CONSTRAINT "payment_webhook_events_verified_only" CHECK ("signature_verified" = true),
	CONSTRAINT "payment_webhook_events_processing_state_valid" CHECK (("status" = 'processed' AND "processed_at" IS NOT NULL) OR ("status" <> 'processed' AND "processed_at" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_webhook_events_provider_event_uidx" ON "payment_webhook_events" USING btree ("provider", "event_key");
--> statement-breakpoint
CREATE INDEX "payment_webhook_events_processing_idx" ON "payment_webhook_events" USING btree ("status", "received_at");
--> statement-breakpoint
CREATE TABLE "tenant_booking_usage" (
	"tenant_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"booking_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_booking_usage_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade,
	CONSTRAINT "tenant_booking_usage_period_valid" CHECK ("period_start" < "period_end"),
	CONSTRAINT "tenant_booking_usage_count_nonnegative" CHECK ("booking_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_booking_usage_tenant_period_uidx" ON "tenant_booking_usage" USING btree ("tenant_id", "period_start");
--> statement-breakpoint
CREATE INDEX "tenant_booking_usage_period_end_idx" ON "tenant_booking_usage" USING btree ("period_end");
--> statement-breakpoint
INSERT INTO "plan_catalog" ("id", "code", "version", "display_name", "price_vnd", "currency", "active_staff_limit", "monthly_booking_limit", "is_active") VALUES
	('00000000-0000-4000-8000-000000000801', 'free', 1, 'Miễn phí', 0, 'VND', 1, 10, true),
	('00000000-0000-4000-8000-000000000802', 'small', 1, 'Tiệm nhỏ', 79000, 'VND', 3, 150, true),
	('00000000-0000-4000-8000-000000000803', 'growth', 1, 'Tiệm phát triển', 159000, 'VND', 10, NULL, true)
ON CONFLICT ("code", "version") DO NOTHING;
--> statement-breakpoint
INSERT INTO "tenant_subscriptions" ("tenant_id", "plan_id", "status", "current_period_start", "current_period_end")
SELECT t."id", p."id", 'active', date_trunc('month', now()), date_trunc('month', now()) + interval '1 month'
FROM "tenants" t
CROSS JOIN "plan_catalog" p
WHERE p."code" = 'free' AND p."version" = 1
ON CONFLICT ("tenant_id") DO NOTHING;
