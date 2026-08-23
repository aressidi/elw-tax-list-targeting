CREATE TYPE "public"."email_type" AS ENUM('sent', 'received', 'follow_up');--> statement-breakpoint
CREATE TYPE "public"."file_type" AS ENUM('csv', 'pdf', 'excel', 'txt', 'other');--> statement-breakpoint
CREATE TYPE "public"."list_type" AS ENUM('free', 'paid', 'not_available', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('not_required', 'requested', 'paid', 'fulfilled');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('not_started', 'research_needed', 'ready_to_email', 'email_sent', 'awaiting_response', 'response_received', 'list_provided', 'requires_payment', 'requires_form', 'not_available', 'declined');--> statement-breakpoint
CREATE TYPE "public"."research_source" AS ENUM('ai_search', 'website', 'phone_call', 'manual', 'other');--> statement-breakpoint
CREATE TYPE "public"."target_priority" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TABLE "counties" (
	"id" serial PRIMARY KEY NOT NULL,
	"state_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"county_seat" varchar(100),
	"fips_code" varchar(5),
	"population" integer,
	"target_priority" "target_priority" DEFAULT 'medium',
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_tracking" (
	"id" serial PRIMARY KEY NOT NULL,
	"list_request_id" integer NOT NULL,
	"email_type" "email_type" DEFAULT 'sent',
	"gmail_message_id" varchar(100),
	"sent_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"subject" varchar(500),
	"body_preview" text,
	"attachments_count" integer DEFAULT 0,
	"processed" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foia_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"subject_line" varchar(500) NOT NULL,
	"body_text" text NOT NULL,
	"is_default" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "list_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"tax_official_id" integer NOT NULL,
	"request_status" "request_status" DEFAULT 'not_started',
	"list_type" "list_type" DEFAULT 'unknown',
	"cost_amount" numeric(10, 2),
	"cost_currency" varchar(3) DEFAULT 'USD',
	"cost_notes" text,
	"payment_status" "payment_status" DEFAULT 'not_required',
	"foia_template_id" integer,
	"email_sent_at" timestamp with time zone,
	"response_received_at" timestamp with time zone,
	"response_summary" text,
	"full_response_text" text,
	"list_file_received" boolean DEFAULT false,
	"file_location" varchar(500),
	"data_processed" boolean DEFAULT false,
	"tax_year_available" varchar(50),
	"update_frequency" varchar(100),
	"next_update_date" timestamp with time zone,
	"notes" text,
	"assigned_to" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_lists" (
	"id" serial PRIMARY KEY NOT NULL,
	"list_request_id" integer NOT NULL,
	"original_filename" varchar(255),
	"file_type" "file_type",
	"raw_data_stored" boolean DEFAULT false,
	"record_count" integer,
	"mailing_list_created" boolean DEFAULT false,
	"mailing_list_export_path" varchar(500),
	"processed_at" timestamp with time zone,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "states" (
	"id" serial PRIMARY KEY NOT NULL,
	"abbreviation" varchar(2) NOT NULL,
	"name" varchar(100) NOT NULL,
	"fips_code" varchar(2),
	"priority" integer DEFAULT 0,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "states_abbreviation_unique" UNIQUE("abbreviation")
);
--> statement-breakpoint
CREATE TABLE "tax_officials" (
	"id" serial PRIMARY KEY NOT NULL,
	"county_id" integer NOT NULL,
	"full_name" varchar(100) NOT NULL,
	"title" varchar(100),
	"phone_number" varchar(50),
	"email_address" varchar(200),
	"office_address" text,
	"website_url" varchar(500),
	"is_primary" boolean DEFAULT false,
	"research_source" "research_source" DEFAULT 'manual',
	"verified_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "counties" ADD CONSTRAINT "counties_state_id_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_tracking" ADD CONSTRAINT "email_tracking_list_request_id_list_requests_id_fk" FOREIGN KEY ("list_request_id") REFERENCES "public"."list_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_requests" ADD CONSTRAINT "list_requests_tax_official_id_tax_officials_id_fk" FOREIGN KEY ("tax_official_id") REFERENCES "public"."tax_officials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_requests" ADD CONSTRAINT "list_requests_foia_template_id_foia_templates_id_fk" FOREIGN KEY ("foia_template_id") REFERENCES "public"."foia_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processed_lists" ADD CONSTRAINT "processed_lists_list_request_id_list_requests_id_fk" FOREIGN KEY ("list_request_id") REFERENCES "public"."list_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_officials" ADD CONSTRAINT "tax_officials_county_id_counties_id_fk" FOREIGN KEY ("county_id") REFERENCES "public"."counties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "counties_state_idx" ON "counties" USING btree ("state_id");--> statement-breakpoint
CREATE INDEX "counties_name_idx" ON "counties" USING btree ("name");--> statement-breakpoint
CREATE INDEX "counties_priority_idx" ON "counties" USING btree ("target_priority");--> statement-breakpoint
CREATE UNIQUE INDEX "counties_state_name_idx" ON "counties" USING btree ("state_id","name");--> statement-breakpoint
CREATE INDEX "email_tracking_request_idx" ON "email_tracking" USING btree ("list_request_id");--> statement-breakpoint
CREATE INDEX "email_tracking_type_idx" ON "email_tracking" USING btree ("email_type");--> statement-breakpoint
CREATE INDEX "email_tracking_gmail_idx" ON "email_tracking" USING btree ("gmail_message_id");--> statement-breakpoint
CREATE INDEX "email_tracking_processed_idx" ON "email_tracking" USING btree ("processed");--> statement-breakpoint
CREATE UNIQUE INDEX "foia_templates_name_idx" ON "foia_templates" USING btree ("name");--> statement-breakpoint
CREATE INDEX "foia_templates_default_idx" ON "foia_templates" USING btree ("is_default");--> statement-breakpoint
CREATE INDEX "list_requests_official_idx" ON "list_requests" USING btree ("tax_official_id");--> statement-breakpoint
CREATE INDEX "list_requests_status_idx" ON "list_requests" USING btree ("request_status");--> statement-breakpoint
CREATE INDEX "list_requests_list_type_idx" ON "list_requests" USING btree ("list_type");--> statement-breakpoint
CREATE INDEX "list_requests_payment_status_idx" ON "list_requests" USING btree ("payment_status");--> statement-breakpoint
CREATE INDEX "list_requests_template_idx" ON "list_requests" USING btree ("foia_template_id");--> statement-breakpoint
CREATE INDEX "list_requests_assigned_idx" ON "list_requests" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "list_requests_created_at_idx" ON "list_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "processed_lists_request_idx" ON "processed_lists" USING btree ("list_request_id");--> statement-breakpoint
CREATE INDEX "processed_lists_file_type_idx" ON "processed_lists" USING btree ("file_type");--> statement-breakpoint
CREATE INDEX "processed_lists_processed_at_idx" ON "processed_lists" USING btree ("processed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "states_abbreviation_idx" ON "states" USING btree ("abbreviation");--> statement-breakpoint
CREATE INDEX "states_name_idx" ON "states" USING btree ("name");--> statement-breakpoint
CREATE INDEX "states_priority_idx" ON "states" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "tax_officials_county_idx" ON "tax_officials" USING btree ("county_id");--> statement-breakpoint
CREATE INDEX "tax_officials_email_idx" ON "tax_officials" USING btree ("email_address");--> statement-breakpoint
CREATE INDEX "tax_officials_primary_idx" ON "tax_officials" USING btree ("is_primary");