ALTER TABLE "processed_lists" ADD COLUMN "file_path" varchar(500);--> statement-breakpoint
ALTER TABLE "processed_lists" ADD COLUMN "file_size_bytes" integer;--> statement-breakpoint
ALTER TABLE "processed_lists" ADD COLUMN "mime_type" varchar(100);