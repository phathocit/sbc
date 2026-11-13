ALTER TABLE "tenant_applications" DROP CONSTRAINT "tenant_applications_requested_plan_valid";
--> statement-breakpoint
ALTER TABLE "tenant_applications" ADD CONSTRAINT "tenant_applications_requested_plan_valid" CHECK ("requested_plan" ~ '^[a-z0-9][a-z0-9_-]{0,23}$');
