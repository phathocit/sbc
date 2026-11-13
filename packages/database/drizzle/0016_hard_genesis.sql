CREATE TABLE "staff_shift_template_intervals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"local_start" time NOT NULL,
	"local_end" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_shift_template_intervals_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "staff_shift_template_intervals_positive_interval" CHECK ("staff_shift_template_intervals"."local_start" < "staff_shift_template_intervals"."local_end")
);
--> statement-breakpoint
CREATE TABLE "staff_shift_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_shift_templates_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "staff_shift_templates_name_nonempty" CHECK (length(trim("staff_shift_templates"."name")) BETWEEN 1 AND 80)
);
--> statement-breakpoint
ALTER TABLE "staff_shift_template_intervals" ADD CONSTRAINT "staff_shift_template_intervals_template_tenant_fk" FOREIGN KEY ("tenant_id","template_id") REFERENCES "public"."staff_shift_templates"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_shift_templates" ADD CONSTRAINT "staff_shift_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_shift_template_intervals_template_idx" ON "staff_shift_template_intervals" USING btree ("tenant_id","template_id","local_start");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_shift_templates_tenant_name_uidx" ON "staff_shift_templates" USING btree ("tenant_id",lower("name"));