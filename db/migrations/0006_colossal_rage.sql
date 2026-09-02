CREATE TYPE "public"."review_source" AS ENUM('trustpilot', 'google');--> statement-breakpoint
CREATE TABLE "faq_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "faq_groups_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "faq_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"published" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text NOT NULL,
	"body" text,
	"date" text NOT NULL,
	"read_time" text NOT NULL,
	"category" text NOT NULL,
	"image" text NOT NULL,
	"author_name" text NOT NULL,
	"author_avatar" text NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posts_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "review_sources" (
	"source" "review_source" PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"stars" integer NOT NULL,
	"rating_label" text NOT NULL,
	"footnote" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "review_source" NOT NULL,
	"author" text NOT NULL,
	"meta" text NOT NULL,
	"date_text" text NOT NULL,
	"headline" text,
	"body" text NOT NULL,
	"rating" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"published" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "faq_items" ADD CONSTRAINT "faq_items_group_id_faq_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."faq_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "faq_items_group_order_idx" ON "faq_items" USING btree ("group_id","sort_order");--> statement-breakpoint
CREATE INDEX "posts_published_date_idx" ON "posts" USING btree ("published","date");--> statement-breakpoint
CREATE INDEX "reviews_source_order_idx" ON "reviews" USING btree ("source","sort_order");