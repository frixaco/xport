import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { XPost } from "@/lib/x-api";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
};

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    ...timestamps,
  },
  (table) => [uniqueIndex("user_email_uidx").on(table.email)],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    token: text("token").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("session_token_uidx").on(table.token),
    index("session_user_id_idx").on(table.userId),
  ],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    ...timestamps,
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const fetchJobs = pgTable(
  "xport_fetch_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    requestType: text("request_type").$type<"thread" | "user">().notNull(),
    inputRaw: text("input_raw").notNull(),
    inputNormalized: text("input_normalized").notNull(),
    status: text("status")
      .$type<"queued" | "running" | "completed" | "stopped" | "failed">()
      .notNull()
      .default("queued"),
    stopRequested: boolean("stop_requested").notNull().default(false),
    runnerId: text("runner_id"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    pagesFetched: integer("pages_fetched").notNull().default(0),
    rawFetchedTweets: integer("raw_fetched_tweets").notNull().default(0),
    storedTweets: integer("stored_tweets").notNull().default(0),
    chargedCredits: integer("charged_credits").notNull().default(0),
    nextCursor: text("next_cursor"),
    hasNextPage: boolean("has_next_page").notNull().default(true),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    ...timestamps,
  },
  (table) => [
    index("fetch_jobs_owner_user_id_idx").on(table.ownerUserId),
    index("fetch_jobs_status_idx").on(table.status),
    check("fetch_jobs_request_type_check", sql`${table.requestType} IN ('thread', 'user')`),
    check(
      "fetch_jobs_status_check",
      sql`${table.status} IN ('queued', 'running', 'completed', 'stopped', 'failed')`,
    ),
  ],
);

export const fetchTweets = pgTable(
  "xport_fetch_tweets",
  {
    jobId: uuid("job_id")
      .notNull()
      .references(() => fetchJobs.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    tweetId: text("tweet_id").notNull(),
    page: integer("page").notNull(),
    isMain: boolean("is_main").notNull().default(false),
    tweetJson: jsonb("tweet_json").$type<XPost>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.seq] }),
    uniqueIndex("fetch_tweets_job_tweet_uidx").on(table.jobId, table.tweetId),
    index("fetch_tweets_job_seq_idx").on(table.jobId, table.seq),
    index("fetch_tweets_job_created_idx").on(table.jobId, table.createdAt),
  ],
);
