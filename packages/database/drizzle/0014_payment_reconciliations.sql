CREATE TABLE "payment_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"initiated_by" uuid NOT NULL,
	"request_id" varchar(32) NOT NULL,
	"outcome" varchar(16) DEFAULT 'started' NOT NULL,
	"response_code" varchar(2),
	"transaction_status" varchar(2),
	"transaction_no" varchar(15),
	"message" varchar(255),
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "payment_reconciliations_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "payment_reconciliations_outcome_valid" CHECK ("payment_reconciliations"."outcome" IN ('started', 'paid', 'not_paid', 'error')),
	CONSTRAINT "payment_reconciliations_completion_state_valid" CHECK (("payment_reconciliations"."outcome" = 'started' AND "payment_reconciliations"."completed_at" IS NULL) OR ("payment_reconciliations"."outcome" <> 'started' AND "payment_reconciliations"."completed_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "payment_reconciliations" ADD CONSTRAINT "payment_reconciliations_order_fk" FOREIGN KEY ("order_id") REFERENCES "public"."billing_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reconciliations" ADD CONSTRAINT "payment_reconciliations_admin_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."platform_admins"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_reconciliations_order_requested_idx" ON "payment_reconciliations" USING btree ("order_id","requested_at");