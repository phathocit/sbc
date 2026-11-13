ALTER TABLE "customers" ALTER COLUMN "email_normalized" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "phone_normalized" varchar(32);