import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, extname } from "node:path";
import { articleBlocksToMarkdown, normalizeArticleContents } from "../core/src/article-content.ts";

const X_API_KEY = process.env.X_API_KEY;
const X_API_URL = process.env.X_API_URL;
if (!X_API_KEY) throw new Error("X_API_KEY environment variable is required");
if (!X_API_URL) throw new Error("X_API_URL environment variable is required");
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
  id?: string;
  author: Author;
  replyCount?: number;
  likeCount?: number;
  quoteCount?: number;
  viewCount?: number | string;
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
    headers: { "X-API-Key": X_API_KEY },
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

function generateMarkdown(article: Article, originalUrl: string): string {
  const publishedDate = formatDate(article.createdAt);
  const createdDate = new Date().toISOString().split("T")[0];

  let md = "---\n";
  if (article.id) {
    md += `article_id: "${article.id}"\n`;
  }
  md += `title: "${article.title.trim().replace(/"/g, '\\"')}"\n`;
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
    md += `description: "${article.preview_text.trim().replace(/\s+/g, " ").replace(/"/g, '\\"')}"\n`;
  }
  md += "tags:\n";
  md += '  - "clippings"\n';
  md += "---\n\n";

  md += `# ${article.title.trim()}\n\n`;

  if (article.cover_media_img_url) {
    md += `![Cover](${article.cover_media_img_url})\n\n`;
  }

  md += articleBlocksToMarkdown(normalizeArticleContents(article.contents));

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
