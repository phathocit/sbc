CREATE UNIQUE INDEX "billing_orders_tenant_id_id_uidx" ON "billing_orders" USING btree ("tenant_id", "id");
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"billing_order_id" uuid,
	"subject" varchar(140) NOT NULL,
	"category" varchar(32) NOT NULL,
	"status" varchar(24) DEFAULT 'waiting_admin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_tickets_tenant_id_id_unique" UNIQUE("tenant_id", "id"),
	CONSTRAINT "support_tickets_category_check" CHECK ("category" IN ('billing', 'account', 'booking', 'technical', 'other')),
	CONSTRAINT "support_tickets_status_check" CHECK ("status" IN ('waiting_admin', 'waiting_tenant', 'resolved', 'closed')),
	CONSTRAINT "support_tickets_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade,
	CONSTRAINT "support_tickets_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict,
	CONSTRAINT "support_tickets_billing_order_fk" FOREIGN KEY ("tenant_id", "billing_order_id") REFERENCES "public"."billing_orders"("tenant_id", "id") ON DELETE restrict
);
CREATE INDEX "support_tickets_tenant_updated_idx" ON "support_tickets" USING btree ("tenant_id", "updated_at");
CREATE INDEX "support_tickets_status_updated_idx" ON "support_tickets" USING btree ("status", "updated_at");
CREATE TABLE "support_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"sender_role" varchar(16) NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_messages_sender_role_check" CHECK ("sender_role" IN ('tenant', 'platform_admin')),
	CONSTRAINT "support_messages_ticket_fk" FOREIGN KEY ("tenant_id", "ticket_id") REFERENCES "public"."support_tickets"("tenant_id", "id") ON DELETE cascade,
	CONSTRAINT "support_messages_sender_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE restrict
);
CREATE INDEX "support_messages_ticket_time_idx" ON "support_messages" USING btree ("tenant_id", "ticket_id", "created_at");
