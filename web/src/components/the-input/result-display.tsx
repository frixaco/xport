import { ExternalLink, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FetchJobStatusResponse, MediaItem, ResultState, TweetCardModel } from "./types";
import { estimateCostCredits, formatCount, formatCreditLabel } from "./display";

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("rounded-full border bg-background px-2 py-0.5", className)}>
      {children}
    </span>
  );
}

function usageSummaryLabel(result: ResultState): string {
  const credits = formatCreditLabel(estimateCostCredits(result));
  if (!result.usage) return `${credits} estimated`;
  return result.usage.charged ? `${credits} charged` : `${credits} not charged`;
}

function resultHeaderLabel(result: ResultState, isFetchingEmpty = false): string {
  if (result.kind === "article") return "Article";
  if (isFetchingEmpty) return result.kind === "thread" ? "Fetching thread" : "Fetching posts";
  if (result.kind === "user-tweets") {
    const replies = result.tweets.filter((tweet) => tweet.replyTo).length;
    const posts = result.tweets.length - replies;
    if (result.mode === "replies") return `Fetched ${formatCount(replies, "reply")}`;
    if (result.mode === "timeline" && replies > 0) {
      return `Fetched ${formatCount(posts, "post")} and ${formatCount(replies, "reply")}`;
    }
    return `Fetched ${formatCount(posts, "post")}`;
  }

  const replies = result.tweets.length;
  if (result.mainTweet && replies > 0) {
    return `Fetched the post and ${formatCount(replies, "reply")}`;
  }
  if (result.mainTweet) return "Fetched the post";
  return `Fetched ${formatCount(replies, "reply")}`;
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
  partial: {
    label: "Partial",
    className: "bg-amber-500/20 text-amber-600 dark:text-amber-400",
  },
  failed: {
    label: "Failed",
    className: "bg-destructive/20 text-destructive",
  },
};

const skeletonRows = ["first", "second", "third", "fourth"];

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
  return null;
}

function resultMetaLabels(result: ResultState): string[] {
  if (result.kind !== "article") return [];
  return [formatCount(result.sections.length, "section"), usageSummaryLabel(result)];
}

function ListHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center justify-between px-0.5 text-xs text-muted-foreground">
      {label}
      <span>{formatCount(count, "post")}</span>
    </div>
  );
}

function MediaGallery({ media, altPrefix }: { media: MediaItem[]; altPrefix: string }) {
  if (media.length === 0) return null;
  const asGrid = media.length > 1;

  return (
    <div className={cn("gap-2 pt-3", asGrid ? "grid sm:grid-cols-2" : "flex flex-col")}>
      {media.map((item) =>
        item.type === "image" ? (
          <a
            key={`${item.type}-${item.url}`}
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="block overflow-hidden rounded-md border bg-muted/20"
          >
            <img
              src={item.url}
              alt={`${altPrefix} media`}
              className={cn("w-full object-cover", asGrid ? "h-52 sm:h-44" : "max-h-96")}
              loading="lazy"
            />
          </a>
        ) : (
          <a
            key={`${item.type}-${item.url}`}
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className={cn(
              "flex min-h-32 w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-md border bg-muted/20 p-4 text-center text-sm transition-colors hover:bg-secondary",
              asGrid ? "h-52 sm:col-span-2 sm:h-44" : "min-h-44",
            )}
          >
            <span className="font-medium">Video attachment</span>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              Open video
              <ExternalLink className="size-3" />
            </span>
          </a>
        ),
      )}
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
  const displayTag = tag ?? (tweet.replyTo ? "Reply" : undefined);

  return (
    <article
      className={cn(
        "flex flex-col gap-2.5 rounded-md border p-3",
        main ? "border-foreground/20 bg-secondary/40" : "bg-background",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {typeof index === "number" && (
          <Chip className="px-1.5 text-[10px] font-medium text-muted-foreground">{index}</Chip>
        )}
        {displayTag && (
          <Chip className="text-[10px] tracking-wide text-muted-foreground uppercase">
            {displayTag}
          </Chip>
        )}
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{tweet.meta}</span>
        {tweet.url && (
          <a
            href={tweet.url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            Open
            <ExternalLink className="size-3" />
          </a>
        )}
      </div>
      {tweet.replyTo && (
        <a
          href={tweet.replyTo.url}
          target="_blank"
          rel="noreferrer"
          className="w-fit text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Replying to {tweet.replyTo.username ? `@${tweet.replyTo.username}` : "this post"}
        </a>
      )}
      <p className="text-sm leading-relaxed whitespace-pre-wrap">{tweet.text}</p>
      {tweet.media.length > 0 && (
        <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
          {formatCount(tweet.media.length, "media item")}
        </p>
      )}
      <MediaGallery media={tweet.media} altPrefix="Tweet" />
    </article>
  );
}

export function ResultDisplay({
  result,
  isFetching = false,
  jobStatus,
  onLoadMore,
  loadingMore,
}: {
  result: ResultState;
  isFetching?: boolean;
  jobStatus?: FetchJobStatusResponse;
  onLoadMore?: () => void;
  loadingMore?: boolean;
}) {
  const isArticle = result.kind === "article";
  const hasResults = isArticle
    ? result.sections.length > 0
    : result.kind === "thread"
      ? Boolean(result.mainTweet || result.tweets.length > 0)
      : result.tweets.length > 0;
  const badge = isArticle && jobStatus ? resolveJobBadge(jobStatus, hasResults) : null;
  const showLoadingPlaceholder = isFetching && !hasResults && !isArticle;

  function handleScroll(event: React.UIEvent<HTMLDivElement>) {
    if (!onLoadMore || loadingMore) return;
    const el = event.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
      onLoadMore();
    }
  }

  return (
    <div
      className={cn(
        "w-full animate-in duration-300 fade-in slide-in-from-bottom-2 md:w-[120%] md:max-w-[calc(100vw-2rem)] md:self-center",
        isArticle && "overflow-hidden rounded-lg border",
      )}
    >
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-2 gap-y-1 py-2.5 text-sm",
          isArticle && "border-b bg-muted/20 px-4",
        )}
      >
        <span className="font-medium">{resultHeaderLabel(result, showLoadingPlaceholder)}</span>
        {resultMetaLabels(result).map((label) => (
          <span key={label} className="inline-flex items-center gap-2 text-muted-foreground">
            <span aria-hidden="true">•</span>
            <span className="tabular-nums">{label}</span>
          </span>
        ))}
        {badge && (
          <span
            className={cn(
              "ml-auto rounded-full border-0 px-2 py-0.5 text-[11px] font-medium",
              badge.className,
            )}
          >
            {badge.label}
          </span>
        )}
      </div>
      <div
        className="h-104 w-full overflow-auto md:h-152"
        onScroll={onLoadMore ? handleScroll : undefined}
      >
        {showLoadingPlaceholder ? (
          <PostListSkeleton />
        ) : result.kind === "article" ? (
          <ArticleContent result={result} />
        ) : result.kind === "thread" ? (
          <ThreadContent result={result} />
        ) : (
          <UserTweetsContent result={result} />
        )}
        {loadingMore && (
          <div className="flex items-center justify-center py-4">
            <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
    </div>
  );
}

function PostListSkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      {skeletonRows.map((row) => (
        <div
          key={row}
          className="flex animate-pulse flex-col gap-3 rounded-md border bg-background p-3"
        >
          <div className="flex items-center gap-2">
            <div className="size-5 rounded-full bg-muted" />
            <div className="h-3 w-36 rounded-sm bg-muted" />
            <div className="ml-auto h-6 w-14 rounded-full bg-muted" />
          </div>
          <div className="space-y-2">
            <div className="h-3 w-5/6 rounded-sm bg-muted" />
            <div className="h-3 w-2/3 rounded-sm bg-muted" />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="h-32 rounded-md bg-muted/70" />
            <div className="hidden h-32 rounded-md bg-muted/70 sm:block" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ResultDisplayLoading() {
  return (
    <div className="w-full animate-in overflow-hidden rounded-lg border duration-300 fade-in slide-in-from-bottom-2 md:w-[120%] md:max-w-[calc(100vw-2rem)] md:self-center">
      <div className="border-b bg-muted/30 px-3 py-2.5 text-sm font-medium text-muted-foreground">
        Loading results
      </div>
      <div className="flex h-104 w-full items-center justify-center md:h-152">
        <LoaderCircle className="size-10 animate-spin text-muted-foreground" />
      </div>
    </div>
  );
}

function ArticleContent({ result }: { result: ResultState & { kind: "article" } }) {
  return (
    <article className="flex flex-col gap-5 p-4 sm:p-5">
      <header className="flex flex-col gap-2 border-b pb-4">
        <h2 className="text-base leading-snug font-semibold sm:text-lg">{result.title}</h2>
        {result.byline && <p className="text-xs text-muted-foreground">{result.byline}</p>}
        {result.preview && (
          <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
            {result.preview}
          </p>
        )}
      </header>
      {result.coverImageUrl && (
        <MediaGallery media={[{ type: "image", url: result.coverImageUrl }]} altPrefix="Article" />
      )}
      {result.sections.length > 0 ? (
        <div className="max-w-none">
          {result.sections.map((block) => {
            if (!block.text && block.type !== "divider") return null;

            if (block.type === "image" || block.type === "gif") {
              const url = block.previewUrl || block.url;
              if (!url) return null;
              return (
                <MediaGallery
                  key={`article-media-${url}`}
                  media={[{ type: "image", url }]}
                  altPrefix="Article"
                />
              );
            }

            return (
              <p
                key={`${block.type}-${block.url ?? ""}-${block.text}`}
                className={cn(
                  "text-sm leading-relaxed whitespace-pre-wrap",
                  block.type === "blockquote" && "border-l-2 pl-4 italic",
                  block.type === "header-one" && "text-lg font-semibold",
                  block.type === "header-two" && "text-base font-semibold",
                  block.type === "header-three" && "text-sm font-semibold",
                )}
                dangerouslySetInnerHTML={{
                  __html: renderBlockHtml(block.text, block.type),
                }}
              />
            );
          })}
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
    <div className="flex flex-col gap-4">
      {result.mainTweet && <TweetRowCard tweet={result.mainTweet} main tag="Main post" index={1} />}
      {result.tweets.length > 0 ? (
        <div className="flex flex-col gap-2.5">
          <ListHeader label="Thread replies" count={result.tweets.length} />
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
  if (result.tweets.length === 0) return <EmptyPlaceholder />;

  return (
    <div className="flex flex-col gap-2.5">
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
