CREATE TABLE IF NOT EXISTS xport_fetch_jobs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id   text        NOT NULL,
  request_type    text        NOT NULL CHECK (request_type IN ('thread', 'user')),
  input_raw       text        NOT NULL,
  input_normalized text       NOT NULL,
  status          text        NOT NULL DEFAULT 'queued'
                              CHECK (status IN ('queued', 'running', 'completed', 'stopped', 'failed')),
  stop_requested  boolean     NOT NULL DEFAULT false,
  started_at      timestamptz,
  finished_at     timestamptz,
  expires_at      timestamptz,
  pages_fetched   integer     NOT NULL DEFAULT 0,
  raw_fetched_tweets integer  NOT NULL DEFAULT 0,
  stored_tweets   integer     NOT NULL DEFAULT 0,
  charged_credits integer     NOT NULL DEFAULT 0,
  next_cursor     text,
  has_next_page   boolean     NOT NULL DEFAULT true,
  error_code      text,
  error_message   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fetch_jobs_owner_user_id ON xport_fetch_jobs (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_fetch_jobs_status         ON xport_fetch_jobs (status);

CREATE TABLE IF NOT EXISTS xport_fetch_tweets (
  job_id      uuid        NOT NULL REFERENCES xport_fetch_jobs(id) ON DELETE CASCADE,
  seq         integer     NOT NULL,
  tweet_id    text        NOT NULL,
  page        integer     NOT NULL,
  is_main     boolean     NOT NULL DEFAULT false,
  tweet_json  jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, seq)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fetch_tweets_job_tweet ON xport_fetch_tweets (job_id, tweet_id);
CREATE INDEX IF NOT EXISTS idx_fetch_tweets_job_seq          ON xport_fetch_tweets (job_id, seq);
CREATE INDEX IF NOT EXISTS idx_fetch_tweets_job_created      ON xport_fetch_tweets (job_id, created_at);
