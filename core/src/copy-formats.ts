import { extractUsernameFromMeta } from "./tweet-card.ts";
import type {
  ContentBlock,
  ResultExportFormat,
  ResultState,
  ThreadResultState,
  TweetCardModel,
} from "./types.ts";

const FORMAT_ORDER: ResultExportFormat[] = ["markdown", "json"];

type ArticleResult = Extract<ResultState, { kind: "article" }>;
type TweetResult = Extract<ResultState, { kind: "thread" | "user-tweets" }>;
type TweetRole = "main" | "reply" | "post";

interface FormatMeta {
  extension: string;
  label: string;
  mimeType: string;
}

interface TweetRow {
  role: TweetRole;
  index: number;
  tweet: TweetCardModel;
}

const FORMAT_META = {
  markdown: {
    extension: "md",
    label: "Markdown",
    mimeType: "text/markdown",
  },
  json: {
    extension: "json",
    label: "JSON",
    mimeType: "application/json",
  },
} satisfies Record<ResultExportFormat, FormatMeta>;

export const downloadActions: Array<{
  value: ResultExportFormat;
  label: string;
}> = FORMAT_ORDER.map((value) => ({
  value,
  label: FORMAT_META[value].label,
}));

function joinNonEmpty(lines: Array<string | null | undefined>): string {
  return lines.filter((line) => Boolean(line && line.trim().length > 0)).join("\n");
}

function escapeDoubleQuotedYaml(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function todayIsoDate(): string {
  return new Date().toISOString().split("T")[0] ?? "";
}

function getTweetRows(result: TweetResult): TweetRow[] {
  if (result.kind === "user-tweets") {
    return result.tweets.map((tweet, index) => ({
      role: "post",
      index: index + 1,
      tweet,
    }));
  }

  const rows: TweetRow[] = [];
  if (result.mainTweet) {
    rows.push({ role: "main", index: 1, tweet: result.mainTweet });
  }

  result.tweets.forEach((tweet) => {
    rows.push({
      role: "reply",
      index: rows.length + 1,
      tweet,
    });
  });

  return rows;
}

function tweetHeading(row: TweetRow): string {
  const heading =
    row.role === "main"
      ? "Main post"
      : row.role === "reply"
        ? `Reply ${row.index}`
        : `Post ${row.index}`;
  return `## ${heading}`;
}

function threadTitleFromFirstPost(text: string): string {
  const title = (text.split("\n")[0] ?? "")
    .replace(/https?:\/\/\S+/g, "")
    .trim()
    .slice(0, 120);
  return title || "Thread";
}

function getArticleMarkdownBlock(block: ContentBlock): string | null {
  if (block.type === "divider") return "---";
  return block.text || null;
}

function toArticleMarkdown(result: ArticleResult): string {
  const frontmatterLines = [
    "---",
    `title: "${escapeDoubleQuotedYaml(result.title)}"`,
    result.sourceUrl ? `source: "${escapeDoubleQuotedYaml(result.sourceUrl)}"` : null,
    "author:",
    result.authorUsername ? `  - "[[@${result.authorUsername}]]"` : `  - "[[@unknown]]"`,
    result.publishedDate ? `published: ${result.publishedDate}` : null,
    `created: ${todayIsoDate()}`,
    result.preview
      ? `description: "${escapeDoubleQuotedYaml(result.preview.replace(/\n/g, " "))}"`
      : null,
    "tags:",
    '  - "clippings"',
    "---",
  ].filter((line): line is string => Boolean(line));

  const body = [
    result.coverImageUrl ? `![Cover](${result.coverImageUrl})` : null,
    ...result.sections.map(getArticleMarkdownBlock),
  ].filter((line): line is string => Boolean(line));

  if (body.length === 0) {
    return `${frontmatterLines.join("\n")}\n`;
  }

  return `${frontmatterLines.join("\n")}\n\n${body.join("\n\n").trim()}\n`;
}

function toThreadMarkdown(result: ThreadResultState): string {
  const posts = [result.mainTweet, ...result.tweets].filter((tweet): tweet is TweetCardModel =>
    Boolean(tweet),
  );
  if (posts.length === 0) return "# Thread\n\n_No posts returned._";

  const firstPost = posts[0]!;
  const metaParts = firstPost.meta.split(" · ");
  const author = metaParts[0] ?? null;
  const date = metaParts.slice(1).join(" · ") || null;
  const title = threadTitleFromFirstPost(firstPost.text);

  const lines: string[] = [
    `# ${title}`,
    joinNonEmpty([
      author ? `> **Author:** ${author}` : null,
      date ? `> **Date:** ${date}` : null,
      firstPost.url ? `> **Thread:** [View on X](${firstPost.url})` : null,
      `> **Posts:** ${posts.length}`,
    ]),
    "---",
  ];

  posts.forEach((post, index) => {
    lines.push(post.text);
    post.media.forEach((item) => {
      lines.push(item.type === "image" ? `![](${item.url})` : `[Video](${item.url})`);
    });
    if (post.url) {
      lines.push(`*Source: [Open on X](${post.url})*`);
    }
    if (index < posts.length - 1) {
      lines.push("---");
    }
  });

  return lines.join("\n\n").trim();
}

function toTweetMarkdown(result: TweetResult): string {
  const rows = getTweetRows(result);
  const lines: string[] = [`# ${result.label}`];
  if (rows.length === 0) {
    lines.push("_No posts returned._");
    return lines.join("\n\n");
  }

  rows.forEach((row) => {
    lines.push(tweetHeading(row));
    lines.push(
      joinNonEmpty([row.tweet.meta, row.tweet.url ? `[Open on X](${row.tweet.url})` : null]),
    );
    lines.push(row.tweet.text);
    if (row.tweet.media.length > 0) {
      lines.push("Media:");
      row.tweet.media.forEach((item) => lines.push(`- ${item.type}: ${item.url}`));
    }
  });

  return lines.join("\n\n").trim();
}

export function toMarkdown(result: ResultState): string {
  if (result.kind === "article") return toArticleMarkdown(result);
  if (result.kind === "thread") return toThreadMarkdown(result);
  return toTweetMarkdown(result);
}

export function serializeByFormat(result: ResultState, format: ResultExportFormat): string {
  if (format === "markdown") return toMarkdown(result);
  return JSON.stringify(result, null, 2);
}

function toAsciiFileToken(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function resolveResultUsername(result: ResultState): string | null {
  if (result.kind === "article") return null;
  if (result.username) return result.username;
  if (result.kind === "thread") {
    return (
      extractUsernameFromMeta(result.mainTweet?.meta) ??
      extractUsernameFromMeta(result.tweets[0]?.meta)
    );
  }
  return extractUsernameFromMeta(result.tweets[0]?.meta);
}

function fileBaseName(result: ResultState, options?: { isPartial?: boolean }): string {
  if (result.kind === "article") {
    const token = toAsciiFileToken(result.title);
    if (token.length > 0) return token;
    return "xport-article";
  }

  const usernameToken = toAsciiFileToken(resolveResultUsername(result)?.replace(/^@/, "") ?? "");
  const usernamePrefix = usernameToken.length > 0 ? usernameToken : "xport";
  const partialSuffix = options?.isPartial ? "-partial" : "";

  if (result.kind === "thread") {
    return `${usernamePrefix}-thread${partialSuffix}`;
  }

  return `${usernamePrefix}-user-posts${partialSuffix}`;
}

export function getDownloadPayload(
  result: ResultState,
  format: ResultExportFormat,
  options?: { isPartial?: boolean },
): { content: string; filename: string; label: string; mimeType: string } {
  const meta = FORMAT_META[format];

  return {
    content: serializeByFormat(result, format),
    filename: `${fileBaseName(result, options)}.${meta.extension}`,
    label: meta.label,
    mimeType: meta.mimeType,
  };
}

export function getMarkdownCopyPayload(result: ResultState): {
  content: string;
  label: string;
} {
  return {
    content: toMarkdown(result),
    label: FORMAT_META.markdown.label,
  };
}
