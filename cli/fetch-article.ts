import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, extname } from "node:path";

const API_KEY = process.env.API_KEY!;
const X_API_URL = process.env.X_API_URL!;
const BASE_URL = X_API_URL + "/twitter/article";

interface InlineStyleRange {
  offset: number;
  length: number;
  style: string;
}

interface Author {
  type: string;
  userName: string;
  url?: string;
  id: string;
  name: string;
  isBlueVerified?: boolean;
  verifiedType?: string;
  profilePicture?: string;
  coverPicture?: string;
  description?: string;
  location?: string;
  followers?: number;
  following?: number;
  canDm?: boolean;
  createdAt?: string;
  favouritesCount?: number;
  statusesCount?: number;
  mediaCount?: number;
  isTranslator?: boolean;
  possiblySensitive?: boolean;
  profile_bio?: {
    description?: string;
    entities?: {
      description?: { urls?: AuthorBioUrl[] };
      url?: { urls?: AuthorBioUrl[] };
    };
  };
}

interface AuthorBioUrl {
  display_url: string;
  expanded_url: string;
  indices: [number, number];
  url: string;
}

interface ArticleContent {
  type: string;
  text: string;
  url?: string;
  previewUrl?: string;
  width?: number;
  height?: number;
  inlineStyleRanges?: InlineStyleRange[];
}

interface Article {
  author: Author;
  replyCount?: number;
  likeCount?: number;
  quoteCount?: number;
  viewCount?: number;
  createdAt: string;
  title: string;
  preview_text?: string;
  cover_media_img_url?: string;
  contents: ArticleContent[];
}

interface ArticleResponse {
  article: Article;
  status: "success" | "failed";
  message?: string;
}

function extractTweetId(input: string): string {
  const urlPattern = /(?:twitter\.com|x\.com)\/\w+\/(?:status|article)\/(\d+)/;
  const match = input.match(urlPattern);
  if (match?.[1]) {
    return match[1];
  }
  if (/^\d+$/.test(input)) {
    return input;
  }
  throw new Error(`Invalid input: "${input}". Provide a tweet URL or numeric ID.`);
}

async function fetchArticle(tweetId: string): Promise<Article> {
  const url = new URL(BASE_URL);
  url.searchParams.set("tweet_id", tweetId);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { "X-API-Key": API_KEY },
  });

  const json = (await response.json()) as ArticleResponse;

  if (!response.ok || json.status === "failed") {
    console.error("API Response:", JSON.stringify(json, null, 2));
    throw new Error(`API error: ${response.status} - ${json.message || "Unknown error"}`);
  }

  return json.article;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toISOString().split("T")[0] ?? "";
}

function applyInlineStyles(text: string, ranges?: InlineStyleRange[]): string {
  if (!ranges || ranges.length === 0) return text;

  let result = text;
  const sortedRanges = [...ranges].sort((a, b) => b.offset - a.offset);

  const styleMap: Record<string, string> = {
    Bold: "**",
    Italic: "_",
    BoldItalic: "**_",
    Underline: "<u></u>",
    Strikethrough: "~~",
    Code: "`",
    ItalicCode: "_`",
    BoldCode: "**`",
  };

  for (const range of sortedRanges) {
    const marker = styleMap[range.style]?.[0] || "";
    const markerEnd = styleMap[range.style]?.slice(1) || marker;
    const before = result.slice(0, range.offset);
    const marked = result.slice(range.offset, range.offset + range.length);
    const after = result.slice(range.offset + range.length);
    result = `${before}${marker}${marked}${markerEnd}${after}`;
  }

  return result;
}

type ContentBlock = {
  type: string;
  text?: string;
  url?: string;
  previewUrl?: string;
  width?: number;
  height?: number;
  inlineStyleRanges?: InlineStyleRange[];
};

function renderContentBlock(content: ContentBlock, index: number): string {
  const styledText = applyInlineStyles(content.text || "", content.inlineStyleRanges);

  switch (content.type) {
    case "unstyled":
    case "markdown":
      return styledText;

    case "header-one":
      return `## ${styledText}`;

    case "header-two":
      return `### ${styledText}`;

    case "header-three":
      return `#### ${styledText}`;

    case "unordered-list-item":
      return `- ${styledText}`;

    case "ordered-list-item":
      return `${index + 1}. ${styledText}`;

    case "image": {
      if (!content.url) return "";
      const displayUrl = content.previewUrl || content.url;
      const dims = content.width && content.height ? `=${content.width}x${content.height}` : "";
      return `![](${displayUrl}${dims})`;
    }

    case "gif": {
      if (!content.url) return "";
      const displayUrl = content.previewUrl || content.url;
      return `![](${displayUrl})`;
    }

    case "video":
    case "mp4": {
      if (!content.url) return "";
      return `[Video](${content.url})`;
    }

    case "divider":
      return "---";

    case "blockquote":
      return `> ${styledText}`;

    default:
      return styledText || "";
  }
}

function generateMarkdown(article: Article, originalUrl: string): string {
  const publishedDate = formatDate(article.createdAt);
  const createdDate = new Date().toISOString().split("T")[0];

  let md = "---\n";
  md += `title: "${article.title.replace(/"/g, '\\"')}"\n`;
  md += `source: "${originalUrl}"\n`;
  md += "author:\n";
  md += `  - name: "${article.author.name}"\n`;
  md += `    userName: "${article.author.userName}"\n`;
  md += `    followers: ${article.author.followers ?? 0}\n`;
  md += `    following: ${article.author.following ?? 0}\n`;
  md += `    statusesCount: ${article.author.statusesCount ?? 0}\n`;
  if (article.author.verifiedType) {
    md += `    verifiedType: "${article.author.verifiedType}"\n`;
  }
  md += `published: ${publishedDate}\n`;
  md += `created: ${createdDate}\n`;
  if (article.preview_text) {
    md += `description: "${article.preview_text.replace(/"/g, '\\"').replace(/\n/g, " ")}"\n`;
  }
  md += "tags:\n";
  md += '  - "clippings"\n';
  md += "---\n\n";

  if (article.cover_media_img_url) {
    md += `![Cover](${article.cover_media_img_url})\n\n`;
  }

  let orderedListIndex = 0;

  for (const content of article.contents) {
    let blockText = "";

    if (content.type === "ordered-list-item") {
      blockText = renderContentBlock(content, orderedListIndex);
      orderedListIndex++;
    } else {
      blockText = renderContentBlock(content, 0);
      if (content.type !== "unordered-list-item" && content.type !== "ordered-list-item") {
        orderedListIndex = 0;
      }
    }

    if (blockText) {
      md += blockText + "\n\n";
    }
  }

  return md.trim() + "\n";
}

function sanitizeFilename(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80)
    .replace(/^-|-$/g, "");
}

function generateFilename(article: Article, tweetId: string): string {
  const sanitized = sanitizeFilename(article.title);
  const dirName = sanitized || `article-${tweetId}`;
  return `data/${dirName}/${dirName}.md`;
}

// ============ Media Download ============

function extractImageUrls(markdown: string): string[] {
  const imageRegex = /!\[.*?\]\((https?:\/\/[^)]+)\)/g;
  const urls: string[] = [];
  let match;
  while ((match = imageRegex.exec(markdown)) !== null) {
    if (match[1]) urls.push(match[1]);
  }
  return urls;
}

function getExtension(url: string): string {
  const cleanUrl = stripImageDimensions(url).split("?")[0] ?? url;
  const ext = extname(cleanUrl);
  return ext || ".jpg";
}

function stripImageDimensions(url: string): string {
  return url.replace(/=\d+x\d+$/, "");
}

async function downloadImage(url: string, outputPath: string): Promise<void> {
  const cleanUrl = stripImageDimensions(url);
  const response = await fetch(cleanUrl);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${cleanUrl}`);
  const buffer = await response.arrayBuffer();
  await writeFile(outputPath, Buffer.from(buffer));
}

async function downloadAllImages(
  markdown: string,
  mediaDir: string,
  slug: string,
): Promise<string> {
  const urls = extractImageUrls(markdown);
  if (urls.length === 0) return markdown;

  await mkdir(mediaDir, { recursive: true });
  console.log(`Downloading ${urls.length} images...`);

  let result = markdown;
  let index = 1;

  for (const url of urls) {
    const ext = getExtension(url);
    const filename = `${slug}-${String(index).padStart(2, "0")}${ext}`;
    const localPath = join(mediaDir, filename);

    try {
      await downloadImage(url, localPath);
      console.log(`  Downloaded: ${filename}`);
      result = result.replace(url, `media/${filename}`);
      index++;
    } catch {
      console.error(`  Failed to download: ${url}`);
    }
  }

  return result;
}

async function main() {
  if (!API_KEY) {
    console.error("Error: API_KEY environment variable is required");
    process.exit(1);
  }

  const input = process.argv[2];
  if (!input) {
    console.error("Usage: node fetch-article.ts <tweet-url-or-id>");
    console.error("Example: node fetch-article.ts https://x.com/user/status/1234567890");
    console.error("Example: node fetch-article.ts 1234567890");
    process.exit(1);
  }

  const tweetId = extractTweetId(input);
  console.log(`Fetching article for tweet ID: ${tweetId}`);

  const originalUrl =
    input.includes("twitter.com") || input.includes("x.com")
      ? input
      : `https://x.com/i/status/${tweetId}`;

  const article = await fetchArticle(tweetId);
  console.log(`Fetched article: "${article.title}"`);

  let markdown = generateMarkdown(article, originalUrl);
  const filename = generateFilename(article, tweetId);
  const baseDir = dirname(filename);
  const mediaDir = join(baseDir, "media");
  const slug = sanitizeFilename(article.title) || `article-${tweetId}`;

  await mkdir(baseDir, { recursive: true });

  markdown = await downloadAllImages(markdown, mediaDir, slug);

  await writeFile(filename, markdown, "utf8");
  console.log(`Article saved to ${filename}`);
}

main().catch(console.error);
