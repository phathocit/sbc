CREATE TABLE "platform_admins" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
  "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
  "ciphertext" text NOT NULL,
  "iv" varchar(16) NOT NULL,
  "auth_tag" varchar(32) NOT NULL,
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "platform_settings_singleton_check" CHECK ("id" = 1)
);
