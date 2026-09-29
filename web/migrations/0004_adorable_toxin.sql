CREATE TABLE "xport_credit_transactions" (
	"operation_key" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"amount" integer NOT NULL,
	"type" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"polar_payload" jsonb,
	"polar_delivered_at" timestamp with time zone,
	"polar_attempts" integer DEFAULT 0 NOT NULL,
	"polar_next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"polar_last_error" text
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "credit_balance" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "xport_credit_transactions" ADD CONSTRAINT "xport_credit_transactions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_transactions_user_idx" ON "xport_credit_transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "credit_transactions_pending_idx" ON "xport_credit_transactions" USING btree ("polar_next_attempt_at") WHERE "xport_credit_transactions"."polar_payload" IS NOT NULL AND "xport_credit_transactions"."polar_delivered_at" IS NULL;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_credit_balance_check" CHECK ("user"."credit_balance" >= 0);