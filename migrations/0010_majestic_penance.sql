ALTER TABLE "list_requests" ADD COLUMN "payment_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "list_requests" ADD COLUMN "payment_method" varchar(50);--> statement-breakpoint
ALTER TABLE "list_requests" ADD COLUMN "payment_reference" varchar(100);--> statement-breakpoint
ALTER TABLE "list_requests" ADD COLUMN "invoice_number" varchar(100);--> statement-breakpoint
CREATE INDEX "list_requests_payment_date_idx" ON "list_requests" USING btree ("payment_date");