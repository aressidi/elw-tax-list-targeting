CREATE TABLE "processed_list_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"processed_list_id" integer NOT NULL,
	"raw_data" jsonb NOT NULL,
	"mapped_data" jsonb NOT NULL,
	"is_valid" boolean DEFAULT true NOT NULL,
	"validation_errors" text[],
	"is_duplicate" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "processed_lists" ADD COLUMN "field_mapping" jsonb;--> statement-breakpoint
ALTER TABLE "processed_lists" ADD COLUMN "validation_summary" jsonb;--> statement-breakpoint
ALTER TABLE "processed_list_records" ADD CONSTRAINT "processed_list_records_processed_list_id_processed_lists_id_fk" FOREIGN KEY ("processed_list_id") REFERENCES "public"."processed_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "processed_list_records_processed_list_idx" ON "processed_list_records" USING btree ("processed_list_id");--> statement-breakpoint
CREATE INDEX "processed_list_records_is_valid_idx" ON "processed_list_records" USING btree ("is_valid");--> statement-breakpoint
CREATE INDEX "processed_list_records_is_duplicate_idx" ON "processed_list_records" USING btree ("is_duplicate");