"use client";

import { Fragment, useCallback } from "react";
import { ExternalLink, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FetchJobStatusResponse, MediaItem, ResultState, TweetCardModel } from "./types";
import { estimateCostCredits, formatCreditLabel } from "./utils";

function pluralize(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function resultSummaryLabel(result: ResultState): string {
  if (result.kind === "article") {
    return pluralize(result.sections.length, "section");
  }

  if (result.kind === "thread") {
    const total = result.tweets.length + (result.mainTweet ? 1 : 0);
    return pluralize(total, "post");
  }

  return pluralize(result.tweets.length, "post");
}

function usageSummaryLabel(result: ResultState): string {
  if (!result.usage) return "charge unknown";
  return result.usage.charged ? "charged" : "not charged";
}

function resultKindLabel(result: ResultState): string {
  if (result.kind === "article") return "Article";
  if (result.kind === "thread") return "Thread";
  return "User";
}

const jobStatusBadgeConfig: Record<string, { label: string; className: string }> = {
  fetching: {
    label: "Fetching",
    className: "bg-chart-2/20 text-chart-2",
  },
  stopped: {
    label: "Stopped",
    className: "bg-amber-500/20 text-amber-600 dark:text-amber-400",
  },
  complete: {
    label: "Complete",
    className: "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400",
  },
  partial: {
    label: "Partial",
    className: "bg-amber-500/20 text-amber-600 dark:text-amber-400",
  },
  failed: {
    label: "Failed",
    className: "bg-destructive/20 text-destructive",
  },
};

function resolveJobBadge(
  jobStatus: FetchJobStatusResponse,
  hasResults: boolean,
): { label: string; className: string } | null {
  if (jobStatus.status === "running" || jobStatus.status === "queued") {
    return jobStatusBadgeConfig.fetching;
  }
  if (jobStatus.status === "failed") {
    return hasResults ? jobStatusBadgeConfig.partial : jobStatusBadgeConfig.failed;
  }
  if (jobStatus.status === "stopped") {
    return hasResults ? jobStatusBadgeConfig.partial : jobStatusBadgeConfig.stopped;
  }
  return jobStatusBadgeConfig.complete;
}

function MediaGallery({ media, altPrefix }: { media: MediaItem[]; altPrefix: string }) {
  if (media.length === 0) return null;
  const asGrid = media.length > 1;

  return (
    <div className={cn("mt-3 gap-2", asGrid ? "grid sm:grid-cols-2" : "space-y-2")}>
      {media.map((item, index) => (
        <div
          key={`${item.url}-${index}`}
          className={cn(
            "overflow-hidden rounded-md border bg-muted/20",
            asGrid && item.type === "video" && "sm:col-span-2",
          )}
        >
          {item.type === "image" ? (
            <a href={item.url} target="_blank" rel="noreferrer" className="block">
              <img
                src={item.url}
                alt={`${altPrefix} media ${index + 1}`}
                className={cn("w-full object-cover", asGrid ? "h-52 sm:h-44" : "max-h-96")}
                loading="lazy"
              />
            </a>
          ) : (
            <video
              src={item.url}
              controls
              playsInline
              preload="metadata"
              className={cn("w-full bg-black", asGrid ? "h-52 sm:h-44" : "max-h-96")}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function TweetRowCard({
  tweet,
  main = false,
  tag,
  index,
}: {
  tweet: TweetCardModel;
  main?: boolean;
  tag?: string;
  index?: number;
}) {
  return (
    <article
      className={cn(
        "space-y-2.5 rounded-md border px-3 py-3",
        main ? "border-foreground/20 bg-secondary/40" : "bg-background",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {typeof index === "number" && (
            <span className="rounded-full border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {index}
            </span>
          )}
          {tag && (
            <span className="rounded-full border bg-background px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {tag}
            </span>
          )}
          <span className="truncate text-xs text-muted-foreground">{tweet.meta}</span>
        </div>
        {tweet.url && (
          <a
            href={tweet.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            Open
            <ExternalLink className="size-3" />
          </a>
        )}
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{tweet.text}</p>
      {tweet.media.length > 0 && (
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {pluralize(tweet.media.length, "media item")}
        </p>
      )}
      <MediaGallery media={tweet.media} altPrefix="Tweet" />
    </article>
  );
}

export function ResultDisplay({
  result,
  jobStatus,
  onLoadMore,
  loadingMore,
}: {
  result: ResultState;
  jobStatus?: FetchJobStatusResponse;
  onLoadMore?: () => void;
  loadingMore?: boolean;
}) {
  const hasResults =
    result.kind === "article"
      ? result.sections.length > 0
      : result.kind === "thread"
        ? Boolean(result.mainTweet || result.tweets.length > 0)
        : result.tweets.length > 0;
  const badge = jobStatus ? resolveJobBadge(jobStatus, hasResults) : null;

  const handleScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (!onLoadMore || loadingMore) return;
      const el = event.currentTarget;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
        onLoadMore();
      }
    },
    [onLoadMore, loadingMore],
  );

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 mt-2 w-full duration-300 md:w-[120%] md:max-w-[calc(100vw-2rem)] md:self-center">
      <div className="overflow-hidden rounded-lg border">
        <div className="border-b bg-muted/30 px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="rounded-full border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
                {resultKindLabel(result)}
              </span>
              <span className="text-sm font-medium">{result.label}</span>
              <span className="rounded-full border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
                {resultSummaryLabel(result)}
              </span>
              {badge && (
                <span
                  className={cn(
                    "rounded-full border-0 px-2 py-0.5 text-[11px] font-medium",
                    badge.className,
                  )}
                >
                  {badge.label}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span className="rounded-full border bg-background px-2 py-0.5">
                {formatCreditLabel(estimateCostCredits(result))}
              </span>
              <span className="rounded-full border bg-background px-2 py-0.5">
                {usageSummaryLabel(result)}
              </span>
              {typeof result.usage?.tweetCount === "number" && (
                <span className="rounded-full border bg-background px-2 py-0.5">
                  billed on {pluralize(result.usage.tweetCount, "post")}
                </span>
              )}
            </div>
          </div>
        </div>
        <div
          className="h-104 w-full overflow-auto md:h-152"
          onScroll={onLoadMore ? handleScroll : undefined}
        >
          {result.kind === "article" ? (
            <ArticleContent result={result} />
          ) : result.kind === "thread" ? (
            <ThreadContent result={result} />
          ) : result.kind === "user-tweets" ? (
            <UserTweetsContent result={result} />
          ) : (
            <EmptyPlaceholder />
          )}
          {loadingMore && (
            <div className="flex items-center justify-center py-4">
              <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ResultDisplayLoading() {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 mt-2 w-full duration-300 md:w-[120%] md:max-w-[calc(100vw-2rem)] md:self-center">
      <div className="overflow-hidden rounded-lg border">
        <div className="border-b bg-muted/30 px-3 py-2.5">
          <span className="text-sm font-medium text-muted-foreground">Loading results</span>
        </div>
        <div className="flex h-[26rem] w-full items-center justify-center md:h-[38rem]">
          <LoaderCircle className="size-10 animate-spin text-muted-foreground" />
        </div>
      </div>
    </div>
  );
}

function ArticleContent({ result }: { result: ResultState & { kind: "article" } }) {
  return (
    <article className="space-y-4 p-4 sm:p-5">
      <header className="space-y-2 rounded-md border bg-muted/20 px-3 py-3">
        <h2 className="text-base font-semibold leading-snug sm:text-lg">{result.title}</h2>
        {result.byline && <p className="text-xs text-muted-foreground">{result.byline}</p>}
        {result.preview && (
          <p className="rounded-md border bg-background px-3 py-2 text-sm leading-relaxed text-muted-foreground">
            {result.preview}
          </p>
        )}
      </header>
      {result.coverImageUrl && (
        <MediaGallery media={[{ type: "image", url: result.coverImageUrl }]} altPrefix="Article" />
      )}
      {result.sections.length > 0 ? (
        <div className="rounded-md border bg-background px-4 py-4 sm:px-5">
          <div className="prose prose-sm max-w-none dark:prose-invert">
            {result.sections.map((block, index) => {
              const displayText = block.styledText || block.text;
              if (!displayText && block.type !== "divider") return null;

              if (block.type === "image" || block.type === "gif") {
                const url = block.previewUrl || block.url;
                if (!url) return null;
                return (
                  <Fragment key={`article-media-${index}`}>
                    <MediaGallery media={[{ type: "image", url }]} altPrefix="Article" />
                  </Fragment>
                );
              }

              return (
                <Fragment key={`article-block-${index}`}>
                  <p
                    className={cn(
                      "whitespace-pre-wrap text-sm leading-relaxed",
                      block.type === "blockquote" && "border-l-2 pl-4 italic",
                      block.type === "header-one" && "text-lg font-semibold",
                      block.type === "header-two" && "text-base font-semibold",
                      block.type === "header-three" && "text-sm font-semibold",
                    )}
                    dangerouslySetInnerHTML={{
                      __html: renderBlockHtml(displayText, block.type),
                    }}
                  />
                </Fragment>
              );
            })}
          </div>
        </div>
      ) : (
        <EmptyPlaceholder message="No article content returned." />
      )}
    </article>
  );
}

function renderBlockHtml(text: string, type: string | undefined): string {
  if (type === "header-one" || type === "header-two" || type === "header-three") {
    return escapeHtml(text);
  }
  const html = text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/_(.+?)_/g, "<em>$1</em>")
    .replace(/~~(.+?)~~/g, "<del>$1</del>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/<u>(.+?)<\/u>/g, "<u>$1</u>");
  const escaped = escapeHtml(text);
  if (html !== escaped) {
    return html;
  }
  return escapeHtml(text);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function ThreadContent({ result }: { result: ResultState & { kind: "thread" } }) {
  const replyStartIndex = result.mainTweet ? 2 : 1;
  return (
    <div className="space-y-4 p-3">
      {result.mainTweet && (
        <div className="space-y-2">
          <TweetRowCard tweet={result.mainTweet} main tag="Main post" index={1} />
        </div>
      )}
      {result.tweets.length > 0 ? (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between px-0.5 text-xs text-muted-foreground">
            <span>Thread replies</span>
            <span>{pluralize(result.tweets.length, "post")}</span>
          </div>
          {result.tweets.map((tweet, index) => (
            <TweetRowCard key={tweet.id} tweet={tweet} index={replyStartIndex + index} />
          ))}
        </div>
      ) : (
        !result.mainTweet && <EmptyPlaceholder />
      )}
    </div>
  );
}

function UserTweetsContent({ result }: { result: ResultState & { kind: "user-tweets" } }) {
  if (result.tweets.length === 0) {
    return <EmptyPlaceholder />;
  }

  return (
    <div className="space-y-2.5 p-3">
      <div className="flex items-center justify-between px-0.5 text-xs text-muted-foreground">
        <span>Latest posts</span>
        <span>{pluralize(result.tweets.length, "post")}</span>
      </div>
      {result.tweets.map((tweet, index) => (
        <TweetRowCard key={tweet.id} tweet={tweet} index={index + 1} />
      ))}
    </div>
  );
}

function EmptyPlaceholder({ message = "No results returned." }: { message?: string }) {
  return (
    <div className="flex h-full min-h-52 items-center justify-center px-4 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}
