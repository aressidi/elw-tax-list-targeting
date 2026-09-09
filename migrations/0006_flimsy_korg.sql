CREATE TYPE "public"."review_classification" AS ENUM('list_provided', 'requires_payment', 'requires_form', 'not_available', 'needs_clarification', 'declined');--> statement-breakpoint
ALTER TYPE "public"."request_status" ADD VALUE 'needs_clarification';--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "review_classification" "review_classification";--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "review_notes" text;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "review_cost_amount" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "review_cost_currency" varchar(3);--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "review_form_url" varchar(500);--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "inbox_items_review_classification_idx" ON "inbox_items" USING btree ("review_classification");