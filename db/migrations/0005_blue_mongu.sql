ALTER TABLE "invitations" ADD COLUMN "code_hash" text;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "code_expires_at" timestamp with time zone;