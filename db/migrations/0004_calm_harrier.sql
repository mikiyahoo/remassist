CREATE TYPE "public"."user_role" AS ENUM('admin', 'manager');--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'manager' NOT NULL,
	"invited_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" "user_role" DEFAULT 'manager' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "invited_by" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "invitations_token_idx" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_email_idx" ON "invitations" USING btree ("email");--> statement-breakpoint
-- The two constraints below are hand-written: Drizzle's schema builder cannot
-- express an expression index or a partial unique index.

-- users.email had no uniqueness of any kind. Password sign-in looks a user up
-- by address, and two rows sharing one address makes "which account did they
-- just sign in to" undefined. Lower-cased because addresses are compared
-- case-insensitively everywhere else in this codebase.
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" (lower("email"));--> statement-breakpoint

-- Exactly one admin, enforced by the database. Every row in this partial index
-- has role='admin', so they all share one index value and only one can exist.
-- Application-level checks for this are racy and easy to forget; this is not.
CREATE UNIQUE INDEX "users_single_admin_idx" ON "users" (("role")) WHERE "role" = 'admin';
