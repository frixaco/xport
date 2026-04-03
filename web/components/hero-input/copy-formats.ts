import type { ResultState, TweetCardModel } from "./types";
import { extractUsernameFromMeta } from "./utils";

export type ResultExportFormat = "markdown" | "json" | "text" | "csv";

export interface ThreadExportOptions {
  /** Filter to only the original author's replies in chronological order */
  authorOnly?: boolean;
}

const defaultThreadOptions: ThreadExportOptions = {
  authorOnly: false,
};

export const downloadActions: Array<{
  value: ResultExportFormat;
  label: string;
}> = [
  { value: "markdown", label: "Markdown" },
  { value: "json", label: "JSON" },
  { value: "text", label: "Text" },
  { value: "csv", label: "CSV" },
];

function joinNonEmpty(lines: Array<string | null | undefined>): string {
  return lines.filter((line) => Boolean(line && line.trim().length > 0)).join("\n");
}

function escapeDoubleQuotedYaml(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function todayIsoDate(): string {
  return new Date().toISOString().split("T")[0] ?? "";
}

function mediaLines(tweet: TweetCardModel): string[] {
  return tweet.media.map((item, index) => `${index + 1}. ${item.type}: ${item.url}`);
}

function getTweetRows(result: ResultState): Array<{
  role: "main" | "reply" | "post";
  index: number;
  tweet: TweetCardModel;
}> {
  if (result.kind === "user-tweets") {
    return result.tweets.map((tweet, index) => ({
      role: "post" as const,
      index: index + 1,
      tweet,
    }));
  }

  if (result.kind === "thread") {
    const rows: Array<{
      role: "main" | "reply" | "post";
      index: number;
      tweet: TweetCardModel;
    }> = [];
    if (result.mainTweet) {
      rows.push({ role: "main", index: 0, tweet: result.mainTweet });
    }
    result.tweets.forEach((tweet) => {
      rows.push({
        role: "reply",
        index: 0,
        tweet,
      });
    });
    // Re-index after merge so sequence is always contiguous.
    return rows.map((row, index) => ({ ...row, index: index + 1 }));
  }

  return [];
}

function tweetHeadingMarkdown(role: "main" | "reply" | "post", index: number): string {
  if (role === "main") return `## Main post`;
  if (role === "reply") return `## Reply ${index}`;
  return `## Post ${index}`;
}

function tweetHeadingText(role: "main" | "reply" | "post", index: number): string {
  if (role === "main") return "Main post";
  if (role === "reply") return `Reply ${index}`;
  return `Post ${index}`;
}

/**
 * Extracts the author username from a TweetCardModel's meta field.
 * Meta format: "@username · date" or "@username"
 */
function tweetAuthorUsername(tweet: TweetCardModel): string | null {
  const match = tweet.meta.match(/^@([A-Za-z0-9_]{1,15})/);
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * Filters a thread result to include only the original author's replies
 * in chronological order (root + immediate reply chain from same author).
 */
function filterThreadAuthorOnly(
  result: ResultState & { kind: "thread" },
): ResultState & { kind: "thread" } {
  const allTweets = [result.mainTweet, ...result.tweets].filter((tweet): tweet is TweetCardModel =>
    Boolean(tweet),
  );
  if (allTweets.length === 0) return result;

  const rootTweet = allTweets[0]!;
  const authorUsername = tweetAuthorUsername(rootTweet);
  if (!authorUsername) return result;

  // Collect the author's tweets
  const authorTweets = allTweets.filter((tweet) => tweetAuthorUsername(tweet) === authorUsername);

  return {
    ...result,
    mainTweet: authorTweets[0] ?? null,
    tweets: authorTweets.slice(1),
  };
}

function threadTitleFromFirstPost(text: string): string {
  const title = (text.split("\n")[0] ?? "")
    .replace(/https?:\/\/\S+/g, "")
    .trim()
    .slice(0, 120);
  return title || "Thread";
}

function toArticleMarkdown(result: ResultState & { kind: "article" }): string {
  const sourceLine = result.sourceUrl
    ? `source: "${escapeDoubleQuotedYaml(result.sourceUrl)}"`
    : null;
  const descriptionLine = result.preview
    ? `description: "${escapeDoubleQuotedYaml(result.preview.replace(/\n/g, " "))}"`
    : null;

  const frontmatterLines = [
    "---",
    `title: "${escapeDoubleQuotedYaml(result.title)}"`,
    sourceLine,
    "author:",
    result.authorUsername ? `  - "[[@${result.authorUsername}]]"` : `  - "[[@unknown]]"`,
    result.publishedDate ? `published: ${result.publishedDate}` : null,
    `created: ${todayIsoDate()}`,
    descriptionLine,
    "tags:",
    '  - "clippings"',
    "---",
  ].filter((line): line is string => Boolean(line));

  const body: string[] = [];
  if (result.coverImageUrl) {
    body.push(`![Cover](${result.coverImageUrl})`);
  }

  result.sections.forEach((block) => {
    const text = block.styledText || block.text;
    // Image and divider blocks have styledText set; use it
    if (block.type === "image" || block.type === "gif") {
      // styledText already contains the rendered ![](url) with optional dims
      if (text) body.push(text);
    } else if (block.type === "divider") {
      body.push("---");
    } else if (text) {
      body.push(text);
    }
  });

  if (body.length === 0) {
    return `${frontmatterLines.join("\n")}\n`;
  }

  return `${frontmatterLines.join("\n")}\n\n${body.join("\n\n").trim()}\n`;
}

function toThreadMarkdown(
  result: ResultState & { kind: "thread" },
  options?: ThreadExportOptions,
): string {
  const opts = { ...defaultThreadOptions, ...options };
  const filtered = opts.authorOnly ? filterThreadAuthorOnly(result) : result;

  const posts = [filtered.mainTweet, ...filtered.tweets].filter((tweet): tweet is TweetCardModel =>
    Boolean(tweet),
  );
  if (posts.length === 0) return "# Thread\n\n_No posts returned._";

  const firstPost = posts[0];
  const metaParts = firstPost.meta.split(" · ");
  const author = metaParts[0] ?? null;
  const date = metaParts.slice(1).join(" · ") || null;
  const title = threadTitleFromFirstPost(firstPost.text);
  const sourceUrl = firstPost.url ?? null;

  const lines: string[] = [`# ${title}`];
  lines.push(
    joinNonEmpty([
      author ? `> **Author:** ${author}` : null,
      date ? `> **Date:** ${date}` : null,
      sourceUrl ? `> **Thread:** [View on X](${sourceUrl})` : null,
      `> **Posts:** ${posts.length}`,
    ]),
  );
  lines.push("---");

  posts.forEach((post, index) => {
    lines.push(post.text);
    if (post.media.length > 0) {
      post.media.forEach((item) => {
        if (item.type === "image") {
          lines.push(`![](${item.url})`);
        } else {
          lines.push(`[Video](${item.url})`);
        }
      });
    }
    if (post.url) {
      lines.push(`*Source: [Open on X](${post.url})*`);
    }
    if (index < posts.length - 1) {
      lines.push("---");
    }
  });

  return lines.join("\n\n").trim();
}

function toMarkdown(result: ResultState, options?: ThreadExportOptions): string {
  if (result.kind === "article") {
    return toArticleMarkdown(result);
  }

  if (result.kind === "thread") {
    return toThreadMarkdown(result, options);
  }

  const rows = getTweetRows(result);
  const lines: string[] = [`# ${result.label}`];
  if (rows.length === 0) {
    lines.push("_No posts returned._");
    return lines.join("\n\n");
  }

  rows.forEach((row) => {
    lines.push(tweetHeadingMarkdown(row.role, row.index));
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

function toText(result: ResultState): string {
  if (result.kind === "article") {
    const lines: string[] = [`Title: ${result.title}`];
    if (result.byline) lines.push(`By: ${result.byline}`);
    if (result.preview) {
      lines.push("");
      lines.push("Preview:");
      lines.push(result.preview);
    }
    if (result.coverImageUrl) {
      lines.push("");
      lines.push(`Cover image: ${result.coverImageUrl}`);
    }

    if (result.sections.length > 0) {
      lines.push("");
      result.sections.forEach((block) => {
        const text = block.styledText || block.text;
        if (block.type === "image" || block.type === "gif") {
          const url = block.previewUrl || block.url;
          if (url) lines.push(`${block.type}: ${url}`);
        } else if (text) {
          lines.push(text);
        }
      });
    } else {
      lines.push("");
      lines.push("(No article content.)");
    }

    return lines.join("\n").trim();
  }

  const rows = getTweetRows(result);
  if (rows.length === 0) return `${result.label}\n\nNo posts returned.`;

  const blocks = rows.map((row) => {
    const lines: string[] = [tweetHeadingText(row.role, row.index), row.tweet.meta];
    if (row.tweet.url) lines.push(`URL: ${row.tweet.url}`);
    lines.push("Text:");
    lines.push(row.tweet.text);
    if (row.tweet.media.length > 0) {
      lines.push("Media:");
      mediaLines(row.tweet).forEach((line) => lines.push(line));
    }
    return lines.join("\n");
  });

  return [result.label, ...blocks].join("\n\n").trim();
}

function csvEscape(value: string | number | null | undefined): string {
  const normalized = value == null ? "" : String(value);
  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map((cell) => csvEscape(cell)).join(",")).join("\n");
}

function toArticleCsv(result: ResultState & { kind: "article" }): string {
  const headers = [
    "kind",
    "title",
    "byline",
    "preview",
    "cover_image_url",
    "section_index",
    "section_type",
    "section_text",
    "section_url",
  ];

  if (result.sections.length === 0) {
    return toCsv([
      headers,
      [
        result.kind,
        result.title,
        result.byline ?? "",
        result.preview ?? "",
        result.coverImageUrl ?? "",
        "",
        "",
        "",
        "",
      ],
    ]);
  }

  const rows = result.sections.map((block, index) => [
    result.kind,
    result.title,
    result.byline ?? "",
    result.preview ?? "",
    result.coverImageUrl ?? "",
    String(index + 1),
    block.type,
    block.styledText || block.text,
    block.url ?? "",
  ]);

  return toCsv([headers, ...rows]);
}

function toTweetsCsv(result: ResultState): string {
  const headers = [
    "kind",
    "label",
    "position",
    "role",
    "id",
    "meta",
    "url",
    "text",
    "media_urls",
    "media_types",
  ];
  const rows = getTweetRows(result).map((row) => [
    result.kind,
    result.label,
    String(row.index),
    row.role,
    row.tweet.id,
    row.tweet.meta,
    row.tweet.url ?? "",
    row.tweet.text,
    row.tweet.media.map((item) => item.url).join(" | "),
    row.tweet.media.map((item) => item.type).join(" | "),
  ]);

  return toCsv([headers, ...rows]);
}

function toFormattedJson(result: ResultState): string {
  return JSON.stringify(result, null, 2);
}

function serializeByFormat(result: ResultState, format: ResultExportFormat): string {
  if (format === "markdown") return toMarkdown(result);
  if (format === "json") return toFormattedJson(result);
  if (format === "csv") {
    return result.kind === "article" ? toArticleCsv(result) : toTweetsCsv(result);
  }
  return toText(result);
}

function formatMeta(format: ResultExportFormat): {
  extension: string;
  label: string;
  mimeType: string;
} {
  if (format === "markdown") {
    return {
      extension: "md",
      label: "Markdown",
      mimeType: "text/markdown",
    };
  }
  if (format === "json") {
    return {
      extension: "json",
      label: "JSON",
      mimeType: "application/json",
    };
  }
  if (format === "csv") {
    return {
      extension: "csv",
      label: "CSV",
      mimeType: "text/csv",
    };
  }
  return {
    extension: "txt",
    label: "Text",
    mimeType: "text/plain",
  };
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
  const meta = formatMeta(format);

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
    content: serializeByFormat(result, "markdown"),
    label: "Markdown",
  };
}
