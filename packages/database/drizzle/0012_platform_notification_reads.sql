CREATE TABLE "platform_notification_reads" (
	"user_id" uuid NOT NULL,
	"notification_id" uuid NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_notification_reads_pk" PRIMARY KEY("user_id", "notification_id"),
	CONSTRAINT "platform_notification_reads_admin_fk" FOREIGN KEY ("user_id") REFERENCES "platform_admins"("user_id") ON DELETE cascade,
	CONSTRAINT "platform_notification_reads_notification_fk" FOREIGN KEY ("notification_id") REFERENCES "outbox_messages"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX "platform_notification_reads_notification_idx" ON "platform_notification_reads" USING btree ("notification_id");
