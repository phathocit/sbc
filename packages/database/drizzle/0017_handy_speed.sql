CREATE TABLE "tenant_notification_reads" (
	"tenant_id" uuid NOT NULL,
	"notification_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_notification_reads_pk" PRIMARY KEY("notification_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "tenant_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" varchar(64) NOT NULL,
	"title" varchar(180) NOT NULL,
	"description" varchar(500) NOT NULL,
	"action_path" varchar(500) NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_notifications_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "tenant_notification_reads" ADD CONSTRAINT "tenant_notification_reads_notification_fk" FOREIGN KEY ("tenant_id","notification_id") REFERENCES "public"."tenant_notifications"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_notification_reads" ADD CONSTRAINT "tenant_notification_reads_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_notifications" ADD CONSTRAINT "tenant_notifications_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_notification_reads_user_idx" ON "tenant_notification_reads" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "tenant_notifications_tenant_time_idx" ON "tenant_notifications" USING btree ("tenant_id","occurred_at");