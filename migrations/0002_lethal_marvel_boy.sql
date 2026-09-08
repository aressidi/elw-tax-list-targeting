CREATE TYPE "public"."event_channel" AS ENUM('email', 'phone', 'mail', 'web_form', 'in_person', 'other');--> statement-breakpoint
CREATE TYPE "public"."list_request_event_type" AS ENUM('note', 'email_sent', 'email_received', 'phone_call', 'form_submitted', 'mail_sent', 'response_received', 'payment_requested', 'payment_made', 'file_received', 'data_processed', 'status_changed', 'other');--> statement-breakpoint
CREATE TYPE "public"."price_basis" AS ENUM('flat_list', 'per_listing', 'per_page', 'per_record', 'hourly', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."quantity_unit" AS ENUM('pages', 'listings', 'records', 'counties', 'unknown');--> statement-breakpoint
CREATE TABLE "list_request_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"list_request_id" integer NOT NULL,
	"event_type" "list_request_event_type" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now(),
	"channel" "event_channel",
	"summary" varchar(500),
	"body" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "list_request_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"list_request_id" integer NOT NULL,
	"basis" "price_basis" DEFAULT 'unknown',
	"unit_amount" numeric(10, 2),
	"quantity" numeric(10, 2),
	"quantity_unit" "quantity_unit",
	"currency" varchar(3) DEFAULT 'USD',
	"total_amount" numeric(10, 2),
	"effective_date" timestamp with time zone,
	"raw_text" text,
	"source_label" varchar(500),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "list_request_status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"list_request_id" integer NOT NULL,
	"from_status" "request_status",
	"to_status" "request_status" NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"source_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "list_requests" ADD COLUMN "pricing_basis" "price_basis";--> statement-breakpoint
ALTER TABLE "list_requests" ADD COLUMN "cost_quantity" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "list_requests" ADD COLUMN "cost_quantity_unit" "quantity_unit";--> statement-breakpoint
ALTER TABLE "list_requests" ADD COLUMN "source_label" text;--> statement-breakpoint
ALTER TABLE "list_requests" ADD COLUMN "raw_list_status" text;--> statement-breakpoint
ALTER TABLE "list_requests" ADD COLUMN "latest_event_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "list_request_events" ADD CONSTRAINT "list_request_events_list_request_id_list_requests_id_fk" FOREIGN KEY ("list_request_id") REFERENCES "public"."list_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_request_prices" ADD CONSTRAINT "list_request_prices_list_request_id_list_requests_id_fk" FOREIGN KEY ("list_request_id") REFERENCES "public"."list_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_request_status_history" ADD CONSTRAINT "list_request_status_history_list_request_id_list_requests_id_fk" FOREIGN KEY ("list_request_id") REFERENCES "public"."list_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "list_request_events_request_idx" ON "list_request_events" USING btree ("list_request_id");--> statement-breakpoint
CREATE INDEX "list_request_events_occurred_at_idx" ON "list_request_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "list_request_events_event_type_idx" ON "list_request_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "list_request_prices_request_idx" ON "list_request_prices" USING btree ("list_request_id");--> statement-breakpoint
CREATE INDEX "list_request_prices_effective_date_idx" ON "list_request_prices" USING btree ("effective_date");--> statement-breakpoint
CREATE INDEX "list_request_prices_basis_idx" ON "list_request_prices" USING btree ("basis");--> statement-breakpoint
CREATE INDEX "list_request_status_history_request_idx" ON "list_request_status_history" USING btree ("list_request_id");--> statement-breakpoint
CREATE INDEX "list_request_status_history_changed_at_idx" ON "list_request_status_history" USING btree ("changed_at");--> statement-breakpoint
CREATE INDEX "list_request_status_history_to_status_idx" ON "list_request_status_history" USING btree ("to_status");