CREATE TABLE "signin_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"failed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "signin_attempts_lookup_idx" ON "signin_attempts" USING btree ("identifier","failed_at");