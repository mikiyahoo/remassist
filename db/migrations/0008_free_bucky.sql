CREATE TABLE "rate_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" text,
	"actor_name" text NOT NULL,
	"entity" text NOT NULL,
	"row_key" text NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb
);
--> statement-breakpoint
ALTER TABLE "agent_tiers" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "agent_tiers" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "coverage_options" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "rate_changes" ADD CONSTRAINT "rate_changes_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rate_changes_at_idx" ON "rate_changes" USING btree ("changed_at" DESC NULLS LAST);