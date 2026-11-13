CREATE TABLE "payment_refund_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" varchar(16) NOT NULL,
	"provider_request_id" varchar(128) NOT NULL,
	"provider_refund_order_id" varchar(128) NOT NULL,
	"amount_vnd" integer NOT NULL,
	"reason" varchar(500) NOT NULL,
	"initiated_by" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'started' NOT NULL,
	"response_code" varchar(32),
	"transaction_status" varchar(32),
	"provider_transaction_id" varchar(128),
	"message" varchar(255),
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "payment_refund_requests_provider_valid" CHECK ("payment_refund_requests"."provider" IN ('vnpay', 'momo')),
	CONSTRAINT "payment_refund_requests_amount_positive" CHECK ("payment_refund_requests"."amount_vnd" > 0),
	CONSTRAINT "payment_refund_requests_reason_nonempty" CHECK (length(trim("payment_refund_requests"."reason")) BETWEEN 3 AND 500),
	CONSTRAINT "payment_refund_requests_status_valid" CHECK ("payment_refund_requests"."status" IN ('started', 'pending', 'succeeded', 'failed', 'unknown')),
	CONSTRAINT "payment_refund_requests_completion_state_valid" CHECK (("payment_refund_requests"."status" IN ('succeeded', 'failed') AND "payment_refund_requests"."completed_at" IS NOT NULL) OR ("payment_refund_requests"."status" IN ('started', 'pending', 'unknown') AND "payment_refund_requests"."completed_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "billing_orders" DROP CONSTRAINT "billing_orders_status_valid";--> statement-breakpoint
ALTER TABLE "billing_orders" DROP CONSTRAINT "billing_orders_paid_state_valid";--> statement-breakpoint
ALTER TABLE "payment_reconciliations" DROP CONSTRAINT "payment_reconciliations_outcome_valid";--> statement-breakpoint
ALTER TABLE "payment_reconciliations" ALTER COLUMN "response_code" SET DATA TYPE varchar(32);--> statement-breakpoint
ALTER TABLE "payment_reconciliations" ALTER COLUMN "transaction_status" SET DATA TYPE varchar(32);--> statement-breakpoint
ALTER TABLE "payment_reconciliations" ALTER COLUMN "transaction_no" SET DATA TYPE varchar(128);--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "provider_paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant_plan_changes" ADD COLUMN "change_type" varchar(32) DEFAULT 'support_grant' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_refund_requests" ADD CONSTRAINT "payment_refund_requests_order_fk" FOREIGN KEY ("order_id") REFERENCES "public"."billing_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refund_requests" ADD CONSTRAINT "payment_refund_requests_admin_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."platform_admins"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_refund_requests_provider_request_uidx" ON "payment_refund_requests" USING btree ("provider","provider_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_refund_requests_provider_order_uidx" ON "payment_refund_requests" USING btree ("provider","provider_refund_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_refund_requests_one_success_uidx" ON "payment_refund_requests" USING btree ("order_id") WHERE "payment_refund_requests"."status" = 'succeeded';--> statement-breakpoint
CREATE UNIQUE INDEX "payment_refund_requests_one_open_uidx" ON "payment_refund_requests" USING btree ("order_id") WHERE "payment_refund_requests"."status" IN ('started', 'pending', 'unknown');--> statement-breakpoint
CREATE INDEX "payment_refund_requests_order_requested_idx" ON "payment_refund_requests" USING btree ("order_id","requested_at");--> statement-breakpoint
ALTER TABLE "billing_orders" ADD CONSTRAINT "billing_orders_status_valid" CHECK ("billing_orders"."status" IN ('pending', 'paid', 'paid_review', 'failed', 'expired', 'cancelled', 'refunded'));--> statement-breakpoint
ALTER TABLE "billing_orders" ADD CONSTRAINT "billing_orders_paid_state_valid" CHECK (("billing_orders"."status" IN ('paid', 'paid_review', 'refunded') AND "billing_orders"."paid_at" IS NOT NULL) OR ("billing_orders"."status" NOT IN ('paid', 'paid_review', 'refunded') AND "billing_orders"."paid_at" IS NULL));--> statement-breakpoint
ALTER TABLE "payment_reconciliations" ADD CONSTRAINT "payment_reconciliations_outcome_valid" CHECK ("payment_reconciliations"."outcome" IN ('started', 'paid', 'paid_review', 'not_paid', 'error'));--> statement-breakpoint
ALTER TABLE "tenant_plan_changes" ADD CONSTRAINT "tenant_plan_changes_type_valid" CHECK ("tenant_plan_changes"."change_type" IN ('support_grant', 'paid_review_applied', 'refund_reversal'));