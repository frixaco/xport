CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "xport_fetch_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"request_type" text NOT NULL,
	"input_raw" text NOT NULL,
	"input_normalized" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"stop_requested" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"pages_fetched" integer DEFAULT 0 NOT NULL,
	"raw_fetched_tweets" integer DEFAULT 0 NOT NULL,
	"stored_tweets" integer DEFAULT 0 NOT NULL,
	"charged_credits" integer DEFAULT 0 NOT NULL,
	"next_cursor" text,
	"has_next_page" boolean DEFAULT true NOT NULL,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fetch_jobs_request_type_check" CHECK ("xport_fetch_jobs"."request_type" IN ('thread', 'user')),
	CONSTRAINT "fetch_jobs_status_check" CHECK ("xport_fetch_jobs"."status" IN ('queued', 'running', 'completed', 'stopped', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "xport_fetch_tweets" (
	"job_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"tweet_id" text NOT NULL,
	"page" integer NOT NULL,
	"is_main" boolean DEFAULT false NOT NULL,
	"tweet_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "xport_fetch_tweets_job_id_seq_pk" PRIMARY KEY("job_id","seq")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xport_fetch_jobs" ADD CONSTRAINT "xport_fetch_jobs_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xport_fetch_tweets" ADD CONSTRAINT "xport_fetch_tweets_job_id_xport_fetch_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."xport_fetch_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "fetch_jobs_owner_user_id_idx" ON "xport_fetch_jobs" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "fetch_jobs_status_idx" ON "xport_fetch_jobs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "fetch_tweets_job_tweet_uidx" ON "xport_fetch_tweets" USING btree ("job_id","tweet_id");--> statement-breakpoint
CREATE INDEX "fetch_tweets_job_seq_idx" ON "xport_fetch_tweets" USING btree ("job_id","seq");--> statement-breakpoint
CREATE INDEX "fetch_tweets_job_created_idx" ON "xport_fetch_tweets" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_uidx" ON "session" USING btree ("token");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_uidx" ON "user" USING btree ("email");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");