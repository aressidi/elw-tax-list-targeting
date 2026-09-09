CREATE TYPE "public"."inbox_classification" AS ENUM('list_received', 'fee_quote', 'fee_paid', 'clarification', 'rejection', 'other');--> statement-breakpoint
CREATE TYPE "public"."inbox_item_status" AS ENUM('unprocessed', 'matched', 'unmatched', 'reviewed', 'attached');--> statement-breakpoint
CREATE TYPE "public"."inbox_match_method" AS ENUM('thread_id', 'subject', 'from_address', 'manual');--> statement-breakpoint
CREATE TABLE "inbox_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"gmail_message_id" varchar(100) NOT NULL,
	"thread_id" varchar(100),
	"from_address" varchar(200),
	"subject" varchar(500),
	"body_text" text,
	"received_at" timestamp with time zone,
	"list_request_id" integer,
	"match_confidence" integer DEFAULT 0,
	"match_method" "inbox_match_method",
	"classification" "inbox_classification",
	"status" "inbox_item_status" DEFAULT 'unprocessed' NOT NULL,
	"attachment_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_list_request_id_list_requests_id_fk" FOREIGN KEY ("list_request_id") REFERENCES "public"."list_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_items_gmail_message_id_idx" ON "inbox_items" USING btree ("gmail_message_id");--> statement-breakpoint
CREATE INDEX "inbox_items_thread_id_idx" ON "inbox_items" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "inbox_items_list_request_idx" ON "inbox_items" USING btree ("list_request_id");--> statement-breakpoint
CREATE INDEX "inbox_items_status_idx" ON "inbox_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "inbox_items_classification_idx" ON "inbox_items" USING btree ("classification");