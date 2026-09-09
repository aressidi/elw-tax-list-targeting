CREATE TYPE "public"."email_queue_status" AS ENUM('queued', 'sending', 'sent', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "email_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"list_request_id" integer NOT NULL,
	"status" "email_queue_status" DEFAULT 'queued' NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"send_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_queue_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"daily_limit" integer DEFAULT 20 NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "list_requests" ADD COLUMN "queued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "list_requests" ADD COLUMN "scheduled_send_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_queue" ADD CONSTRAINT "email_queue_list_request_id_list_requests_id_fk" FOREIGN KEY ("list_request_id") REFERENCES "public"."list_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_queue_request_idx" ON "email_queue" USING btree ("list_request_id");--> statement-breakpoint
CREATE INDEX "email_queue_status_idx" ON "email_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "email_queue_send_at_idx" ON "email_queue" USING btree ("send_at");