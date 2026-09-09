CREATE TABLE "mailing_list_exports" (
	"id" serial PRIMARY KEY NOT NULL,
	"processed_list_id" integer NOT NULL,
	"filename" varchar(255) NOT NULL,
	"export_path" varchar(500) NOT NULL,
	"record_count" integer NOT NULL,
	"export_format" varchar(50) DEFAULT 'elw_csv' NOT NULL,
	"include_duplicates" boolean DEFAULT false NOT NULL,
	"valid_only" boolean DEFAULT true NOT NULL,
	"exported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mailing_list_exports" ADD CONSTRAINT "mailing_list_exports_processed_list_id_processed_lists_id_fk" FOREIGN KEY ("processed_list_id") REFERENCES "public"."processed_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mailing_list_exports_processed_list_idx" ON "mailing_list_exports" USING btree ("processed_list_id");--> statement-breakpoint
CREATE INDEX "mailing_list_exports_exported_at_idx" ON "mailing_list_exports" USING btree ("exported_at");