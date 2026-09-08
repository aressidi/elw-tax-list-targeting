CREATE TYPE "public"."confidence_level" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."research_run_status" AS ENUM('in_progress', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."research_status" AS ENUM('not_started', 'in_progress', 'completed', 'needs_review', 'skipped', 'failed');--> statement-breakpoint
CREATE TABLE "county_research_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"county_id" integer NOT NULL,
	"status" "research_run_status" DEFAULT 'in_progress' NOT NULL,
	"provider" varchar(50) NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"cache_key" varchar(255),
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"result_data" jsonb,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "counties" ADD COLUMN "research_status" "research_status" DEFAULT 'not_started' NOT NULL;--> statement-breakpoint
ALTER TABLE "tax_officials" ADD COLUMN "confidence_score" "confidence_level";--> statement-breakpoint
ALTER TABLE "tax_officials" ADD COLUMN "source_url" varchar(500);--> statement-breakpoint
ALTER TABLE "county_research_runs" ADD CONSTRAINT "county_research_runs_county_id_counties_id_fk" FOREIGN KEY ("county_id") REFERENCES "public"."counties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "county_research_runs_county_idx" ON "county_research_runs" USING btree ("county_id");--> statement-breakpoint
CREATE INDEX "county_research_runs_status_idx" ON "county_research_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "county_research_runs_cache_key_idx" ON "county_research_runs" USING btree ("cache_key");--> statement-breakpoint
CREATE INDEX "county_research_runs_requested_at_idx" ON "county_research_runs" USING btree ("requested_at");--> statement-breakpoint
CREATE INDEX "counties_research_status_idx" ON "counties" USING btree ("research_status");