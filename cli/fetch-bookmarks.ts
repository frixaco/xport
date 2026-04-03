import { createHash, randomBytes } from "crypto";
import { spawn } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { createServer, type Server } from "http";
import { extname, join } from "path";
import { createInterface } from "readline";

const _X_CLIENT_ID = process.env.X_CLIENT_ID;
const X_CLIENT_SECRET = process.env.X_CLIENT_SECRET;
const REDIRECT_URI = process.env.X_REDIRECT_URI ?? "http://127.0.0.1:3000/callback";
const SCOPES = ["bookmark.read", "tweet.read", "users.read", "offline.access"];
const TOKEN_PATH = "data/bookmarks-auth.json";
const BOOKMARKS_DIR = "data/bookmarks";
const BOOKMARKS_MARKDOWN_PATH = "data/bookmarks.md";
const MEDIA_DIR = join(BOOKMARKS_DIR, "media");
const TOKEN_REFRESH_BUFFER_MS = 60_000;

interface Bookmark {
  edit_history_tweet_ids?: string[];
  id: string;
  text: string;
  author_id: string;
  created_at: string;
  attachments?: {
    media_keys?: string[];
  };
  referenced_tweets?: Array<{
    type: string;
    id: string;
  }>;
  public_metrics?: {
    retweet_count?: number;
    reply_count?: number;
    like_count?: number;
    quote_count?: number;
    bookmark_count?: number;
    impression_count?: number;
  };
  note_tweet?: {
    text?: string;
  };
}

interface ApiUser {
  id: string;
  username?: string;
  name?: string;
}

interface ApiMediaVariant {
  bit_rate?: number;
  content_type?: string;
  url: string;
}

interface ApiMedia {
  media_key: string;
  type: string;
  url?: string;
  preview_image_url?: string;
  alt_text?: string;
  width?: number;
  height?: number;
  duration_ms?: number;
  public_metrics?: {
    view_count?: number;
  };
  variants?: ApiMediaVariant[];
}

interface BookmarkRecord {
  id: string;
  text: string;
  created_at: string;
  author_id: string;
  author?: {
    id: string;
    username?: string;
    name?: string;
  };
  public_metrics?: Bookmark["public_metrics"];
  media: BookmarkMedia[];
  referenced_tweets: Array<{
    type: string;
    id: string;
  }>;
  quoted_tweet?: QuotedTweetRecord;
}

interface BookmarkMedia {
  media_key: string;
  type: string;
  url?: string;
  preview_image_url?: string;
  alt_text?: string;
  width?: number;
  height?: number;
  duration_ms?: number;
  view_count?: number;
  local_path?: string;
}

interface QuotedTweetRecord {
  id: string;
  text: string;
  created_at: string;
  author_id: string;
  author?: {
    id: string;
    username?: string;
    name?: string;
  };
  public_metrics?: Bookmark["public_metrics"];
  media: BookmarkMedia[];
}

interface BookmarkResponse {
  data?: Bookmark[];
  includes?: {
    users?: ApiUser[];
    media?: ApiMedia[];
    tweets?: Bookmark[];
  };
  meta?: {
    result_count: number;
    next_token?: string;
  };
}

interface UserLookupResponse {
  data: {
    id: string;
  };
}

interface OAuthTokenResponse {
  token_type: string;
  expires_in?: number;
  access_token: string;
  scope?: string;
  refresh_token?: string;
}

interface StoredToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType: string;
  scope?: string;
}

interface PkceChallenge {
  state: string;
  verifier: string;
  challenge: string;
}

function getTweetText(tweet: Bookmark): string {
  return tweet.note_tweet?.text || tweet.text;
}

function buildUserMap(users: ApiUser[] = []): Map<string, ApiUser> {
  return new Map(users.map((user) => [user.id, user]));
}

function buildMediaMap(media: ApiMedia[] = []): Map<string, ApiMedia> {
  return new Map(media.map((item) => [item.media_key, item]));
}

function buildTweetMap(tweets: Bookmark[] = []): Map<string, Bookmark> {
  return new Map(tweets.map((tweet) => [tweet.id, tweet]));
}

function selectMediaUrl(media: ApiMedia): string | undefined {
  if (media.url) {
    return media.url;
  }

  if (media.variants?.length) {
    return [...media.variants]
      .filter((variant) => variant.content_type === "video/mp4")
      .sort((a, b) => (b.bit_rate ?? 0) - (a.bit_rate ?? 0))[0]?.url;
  }

  return media.preview_image_url;
}

function getExtension(url: string, type: string): string {
  const cleanUrl = url.split("?")[0] ?? url;
  const ext = extname(cleanUrl);
  if (ext) {
    return ext;
  }

  return type === "photo" ? ".jpg" : ".mp4";
}

async function downloadMediaFile(url: string, outputPath: string, type: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    writeFileSync(outputPath, Buffer.from(buffer));
  } catch (error) {
    if (type === "video" || type === "animated_gif") {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn("yt-dlp", ["-q", "-o", outputPath, url], { stdio: "ignore" });
        proc.on("close", (code) =>
          code === 0 ? resolve() : reject(new Error(`yt-dlp exited with ${code}`)),
        );
        proc.on("error", reject);
      });
      return;
    }

    throw error;
  }
}

function extractMedia(tweet: Bookmark, mediaByKey: Map<string, ApiMedia>): BookmarkMedia[] {
  const mediaKeys = tweet.attachments?.media_keys ?? [];
  const media: BookmarkMedia[] = [];

  for (const mediaKey of mediaKeys) {
    const item = mediaByKey.get(mediaKey);
    if (!item) {
      continue;
    }

    media.push({
      media_key: item.media_key,
      type: item.type,
      url: selectMediaUrl(item),
      preview_image_url: item.preview_image_url,
      alt_text: item.alt_text,
      width: item.width,
      height: item.height,
      duration_ms: item.duration_ms,
      view_count: item.public_metrics?.view_count,
    });
  }

  return media;
}

function formatAuthor(authorId: string, usersById: Map<string, ApiUser>): BookmarkRecord["author"] {
  const user = usersById.get(authorId);
  if (!user) {
    return { id: authorId };
  }

  return {
    id: authorId,
    username: user.username,
    name: user.name,
  };
}

function formatQuotedTweet(
  tweet: Bookmark,
  usersById: Map<string, ApiUser>,
  mediaByKey: Map<string, ApiMedia>,
): QuotedTweetRecord {
  return {
    id: tweet.id,
    text: getTweetText(tweet),
    created_at: tweet.created_at,
    author_id: tweet.author_id,
    author: formatAuthor(tweet.author_id, usersById),
    public_metrics: tweet.public_metrics,
    media: extractMedia(tweet, mediaByKey),
  };
}

function formatMissingQuotedTweet(id: string): QuotedTweetRecord {
  return {
    id,
    text: "",
    created_at: "",
    author_id: "",
    media: [],
  };
}

function enrichBookmarks(response: BookmarkResponse): BookmarkRecord[] {
  const usersById = buildUserMap(response.includes?.users);
  const mediaByKey = buildMediaMap(response.includes?.media);
  const tweetsById = buildTweetMap(response.includes?.tweets);

  return (response.data ?? []).map((tweet) => {
    const quotedReference = tweet.referenced_tweets?.find(
      (reference) => reference.type === "quoted",
    );
    const quotedTweet = quotedReference ? tweetsById.get(quotedReference.id) : undefined;

    return {
      id: tweet.id,
      text: getTweetText(tweet),
      created_at: tweet.created_at,
      author_id: tweet.author_id,
      author: formatAuthor(tweet.author_id, usersById),
      public_metrics: tweet.public_metrics,
      media: extractMedia(tweet, mediaByKey),
      referenced_tweets: tweet.referenced_tweets ?? [],
      quoted_tweet: quotedReference
        ? quotedTweet
          ? formatQuotedTweet(quotedTweet, usersById, mediaByKey)
          : formatMissingQuotedTweet(quotedReference.id)
        : undefined,
    };
  });
}

async function downloadBookmarkMedia(
  bookmarks: BookmarkRecord[],
): Promise<{ downloaded: number; failed: number }> {
  mkdirSync(MEDIA_DIR, { recursive: true });

  let mediaIndex = 1;
  let failed = 0;
  const downloadedByKey = new Map<string, string>();

  const attachLocalPath = async (media: BookmarkMedia, prefix: string): Promise<void> => {
    const sourceUrl = media.url || media.preview_image_url;
    if (!sourceUrl) {
      return;
    }

    const cachedPath = downloadedByKey.get(media.media_key);
    if (cachedPath) {
      media.local_path = cachedPath;
      return;
    }

    const ext = getExtension(sourceUrl, media.type);
    const filename = `${prefix}-${String(mediaIndex).padStart(3, "0")}${ext}`;
    const absolutePath = join(MEDIA_DIR, filename);
    const relativePath = `media/${filename}`;

    try {
      console.log(`Downloading ${media.type}: ${relativePath}`);
      await downloadMediaFile(sourceUrl, absolutePath, media.type);
      media.local_path = relativePath;
      downloadedByKey.set(media.media_key, relativePath);
      mediaIndex++;
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to download ${sourceUrl}: ${message}`);
    }
  };

  for (const bookmark of bookmarks) {
    for (const media of bookmark.media) {
      await attachLocalPath(media, `bookmark-${bookmark.id}`);
    }

    for (const media of bookmark.quoted_tweet?.media ?? []) {
      await attachLocalPath(media, `quote-${bookmark.quoted_tweet?.id ?? bookmark.id}`);
    }
  }

  return {
    downloaded: downloadedByKey.size,
    failed,
  };
}

function getBookmarkUrl(bookmark: BookmarkRecord): string {
  const username = bookmark.author?.username;
  if (username) {
    return `https://x.com/${username}/status/${bookmark.id}`;
  }

  return `https://x.com/i/status/${bookmark.id}`;
}

function escapeMarkdownText(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function renderMediaMarkdown(media: BookmarkMedia[]): string {
  let markdown = "";

  for (const item of media) {
    const path = item.local_path ? `bookmarks/${item.local_path}` : item.url;
    if (!path) {
      continue;
    }

    if (item.type === "photo") {
      markdown += `![](${path})\n\n`;
      continue;
    }

    markdown += `[${item.type === "animated_gif" ? "GIF" : "Video"}](${path})\n\n`;
  }

  return markdown;
}

function renderQuotedTweetMarkdown(quotedTweet: QuotedTweetRecord): string {
  const author = quotedTweet.author?.username
    ? `@${quotedTweet.author.username}`
    : quotedTweet.author_id || "unknown";

  let markdown = `> Quoted from ${author}\n`;

  if (quotedTweet.text) {
    const quotedLines = escapeMarkdownText(quotedTweet.text)
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    markdown += `${quotedLines}\n`;
  } else {
    markdown += `> [Quoted tweet unavailable]\n`;
  }

  markdown += `>\n\n`;

  const mediaMarkdown = renderMediaMarkdown(quotedTweet.media);
  if (mediaMarkdown) {
    markdown += mediaMarkdown;
  }

  return markdown;
}

function generateBookmarksMarkdown(bookmarks: BookmarkRecord[]): string {
  let markdown = `# Bookmarks\n\n`;
  markdown += `> Exported ${bookmarks.length} bookmarks\n\n`;
  markdown += `---\n\n`;

  for (let index = 0; index < bookmarks.length; index++) {
    const bookmark = bookmarks[index]!;
    const author = bookmark.author?.username ? `@${bookmark.author.username}` : bookmark.author_id;

    markdown += `## ${index + 1}. ${author}\n\n`;
    markdown += `> ${bookmark.created_at}  \n`;
    markdown += `> [View on X](${getBookmarkUrl(bookmark)})\n\n`;
    markdown += `${escapeMarkdownText(bookmark.text)}\n\n`;

    const mediaMarkdown = renderMediaMarkdown(bookmark.media);
    if (mediaMarkdown) {
      markdown += mediaMarkdown;
    }

    if (bookmark.quoted_tweet) {
      markdown += `${renderQuotedTweetMarkdown(bookmark.quoted_tweet)}`;
    }

    if (bookmark.public_metrics) {
      markdown += `*❤️ ${bookmark.public_metrics.like_count ?? 0} · 🔁 ${bookmark.public_metrics.retweet_count ?? 0} · 💬 ${bookmark.public_metrics.reply_count ?? 0} · 🔖 ${bookmark.public_metrics.bookmark_count ?? 0}*\n\n`;
    }

    if (index < bookmarks.length - 1) {
      markdown += `---\n\n`;
    }
  }

  return markdown;
}

function getRequiredEnv(name: string, hint?: string): string {
  const value = (process.env as Record<string, string | undefined>)[name];
  if (!value) {
    const message = hint
      ? `Missing required environment variable: ${name}. ${hint}`
      : `Missing required environment variable: ${name}`;
    throw new Error(message);
  }
  return value;
}

function getClientId(): string {
  return getRequiredEnv(
    "X_CLIENT_ID",
    [
      "Bookmarks require OAuth 2.0 User Context.",
      "X docs say to use OAuth 2.0 PKCE with a Client ID.",
      "Add X_CLIENT_ID from your app's Keys and Tokens page.",
      `Register callback URL: ${REDIRECT_URI}`,
    ].join(" "),
  );
}

async function openBrowser(url: string): Promise<boolean> {
  const platform = process.platform;
  const command =
    platform === "darwin"
      ? ["open", url]
      : platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];

  try {
    const child = spawn(command[0], command.slice(1), {
      stdio: "ignore",
      detached: true,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function generatePkce(): PkceChallenge {
  const state = randomBase64Url(24);
  const verifier = randomBase64Url(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  return { state, verifier, challenge };
}

function randomBase64Url(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function isTokenUsable(token: StoredToken): boolean {
  if (!token.expiresAt) {
    return true;
  }

  return token.expiresAt - TOKEN_REFRESH_BUFFER_MS > Date.now();
}

function loadStoredToken(): StoredToken | null {
  if (!existsSync(TOKEN_PATH)) {
    return null;
  }

  try {
    const raw = readFileSync(TOKEN_PATH, "utf8");
    return JSON.parse(raw) as StoredToken;
  } catch (error) {
    console.warn(`Ignoring invalid token cache at ${TOKEN_PATH}:`, error);
    return null;
  }
}

function saveStoredToken(tokenData: OAuthTokenResponse): StoredToken {
  if (!existsSync("data")) {
    mkdirSync("data", { recursive: true });
  }

  const storedToken: StoredToken = {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt: tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : undefined,
    tokenType: tokenData.token_type,
    scope: tokenData.scope,
  };

  writeFileSync(TOKEN_PATH, JSON.stringify(storedToken, null, 2));
  return storedToken;
}

function buildAuthorizeUrl(pkce: PkceChallenge): URL {
  const clientId = getClientId();
  const authUrl = new URL("https://x.com/i/oauth2/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("scope", SCOPES.join(" "));
  authUrl.searchParams.set("state", pkce.state);
  authUrl.searchParams.set("code_challenge", pkce.challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  return authUrl;
}

function buildTokenRequestHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (X_CLIENT_SECRET) {
    const clientId = getClientId();
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${X_CLIENT_SECRET}`).toString(
      "base64",
    )}`;
  }

  return headers;
}

async function exchangeCodeForToken(code: string, verifier: string): Promise<StoredToken> {
  const clientId = getClientId();
  const body = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });

  if (!X_CLIENT_SECRET) {
    body.set("client_id", clientId);
  }

  const response = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: buildTokenRequestHeaders(),
    body: body.toString(),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status} - ${responseText}`);
  }

  return saveStoredToken(JSON.parse(responseText) as OAuthTokenResponse);
}

async function refreshAccessToken(refreshToken: string): Promise<StoredToken> {
  const clientId = getClientId();
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  if (!X_CLIENT_SECRET) {
    body.set("client_id", clientId);
  }

  const response = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: buildTokenRequestHeaders(),
    body: body.toString(),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status} - ${responseText}`);
  }

  return saveStoredToken(JSON.parse(responseText) as OAuthTokenResponse);
}

async function input(prompt: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(prompt, (out: string) => {
      rl.close();
      resolve(out.trim());
    });
  });
}

async function waitForCallback(expectedState: string): Promise<string> {
  const redirectUrl = new URL(REDIRECT_URI);
  const isLocalRedirect =
    redirectUrl.protocol === "http:" &&
    (redirectUrl.hostname === "127.0.0.1" || redirectUrl.hostname === "localhost");

  if (isLocalRedirect) {
    return waitForLocalCallback(redirectUrl, expectedState);
  }

  console.log(`After approval, paste the full callback URL here. Redirect URI: ${REDIRECT_URI}`);
  const callbackUrl = await input("Callback URL: ");
  return extractCodeFromCallback(callbackUrl, expectedState);
}

async function waitForLocalCallback(redirectUrl: URL, expectedState: string): Promise<string> {
  const port = Number(redirectUrl.port || (redirectUrl.protocol === "https:" ? 443 : 80));
  const host = redirectUrl.hostname;
  const pathname = redirectUrl.pathname || "/";

  return new Promise((resolve, reject) => {
    let server: Server | undefined;
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      if (server) {
        server.close(() => fn());
      } else {
        fn();
      }
    };

    server = createServer((req, res) => {
      try {
        if (!req.url) {
          throw new Error("Callback request missing URL");
        }

        const callbackUrl = new URL(req.url, `${redirectUrl.protocol}//${redirectUrl.host}`);
        if (callbackUrl.pathname !== pathname) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }

        const code = extractCodeFromCallback(callbackUrl.toString(), expectedState);
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Authorization received. You can return to the terminal.");
        finish(() => resolve(code));
      } catch (error) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Authorization failed. Check the terminal for details.");
        finish(() => reject(error));
      }
    });

    server.once("error", (error) => {
      finish(() => reject(error));
    });

    server.listen(port, host, () => {
      console.log(`Waiting for OAuth callback on ${REDIRECT_URI}`);
    });
  });
}

function extractCodeFromCallback(callbackUrl: string, expectedState: string): string {
  let parsed: URL;

  try {
    parsed = new URL(callbackUrl);
  } catch {
    if (!callbackUrl.startsWith("?")) {
      throw new Error("Callback must be a full URL or query string");
    }
    parsed = new URL(`${REDIRECT_URI}${callbackUrl}`);
  }

  const state = parsed.searchParams.get("state");
  const code = parsed.searchParams.get("code");
  const error = parsed.searchParams.get("error");
  const errorDescription = parsed.searchParams.get("error_description");

  if (error) {
    throw new Error(
      `Authorization rejected: ${error}${errorDescription ? ` - ${errorDescription}` : ""}`,
    );
  }

  if (state !== expectedState) {
    throw new Error("OAuth state mismatch");
  }

  if (!code) {
    throw new Error("No authorization code received");
  }

  return code;
}

async function getAccessToken(): Promise<string> {
  const storedToken = loadStoredToken();
  if (storedToken && isTokenUsable(storedToken)) {
    return storedToken.accessToken;
  }

  if (storedToken?.refreshToken) {
    try {
      console.log("Refreshing cached OAuth token...");
      const refreshedToken = await refreshAccessToken(storedToken.refreshToken);
      return refreshedToken.accessToken;
    } catch (error) {
      console.warn("Refresh failed, falling back to interactive authorization:", error);
    }
  }

  const pkce = generatePkce();
  const authUrl = buildAuthorizeUrl(pkce);
  console.log(`Please go here and authorize: ${authUrl.toString()}`);
  if (!(await openBrowser(authUrl.toString()))) {
    console.log("Browser auto-open failed. Open the URL manually.");
  }

  const code = await waitForCallback(pkce.state);
  const token = await exchangeCodeForToken(code, pkce.verifier);
  return token.accessToken;
}

async function getUserId(accessToken: string): Promise<string> {
  const response = await fetch("https://api.x.com/2/users/me", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Failed to get user ID: ${response.status} - ${responseText}`);
  }

  const data = JSON.parse(responseText) as UserLookupResponse;
  return data.data.id;
}

async function fetchBookmarks(accessToken: string): Promise<BookmarkRecord[]> {
  const userId = await getUserId(accessToken);
  const allBookmarks: BookmarkRecord[] = [];
  let paginationToken: string | undefined;

  do {
    const url = new URL(`https://api.x.com/2/users/${userId}/bookmarks`);
    url.searchParams.set(
      "tweet.fields",
      [
        "attachments",
        "author_id",
        "created_at",
        "note_tweet",
        "public_metrics",
        "referenced_tweets",
      ].join(","),
    );
    url.searchParams.set("user.fields", ["id", "name", "username"].join(","));
    url.searchParams.set(
      "media.fields",
      [
        "alt_text",
        "duration_ms",
        "height",
        "media_key",
        "preview_image_url",
        "public_metrics",
        "type",
        "url",
        "variants",
        "width",
      ].join(","),
    );
    url.searchParams.set(
      "expansions",
      [
        "attachments.media_keys",
        "author_id",
        "referenced_tweets.id",
        "referenced_tweets.id.attachments.media_keys",
        "referenced_tweets.id.author_id",
      ].join(","),
    );
    url.searchParams.set("max_results", "100");
    if (paginationToken) {
      url.searchParams.set("pagination_token", paginationToken);
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(`Bookmarks fetch failed: ${response.status} - ${responseText}`);
    }

    const data = JSON.parse(responseText) as BookmarkResponse;
    const enriched = enrichBookmarks(data);

    if (enriched.length > 0) {
      allBookmarks.push(...enriched);
      console.log(`Fetched ${allBookmarks.length} bookmarks so far...`);
    }

    paginationToken = data.meta?.next_token;
    if (paginationToken) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } while (paginationToken);

  return allBookmarks;
}

async function main() {
  try {
    console.log("Getting access token...");
    const accessToken = await getAccessToken();

    console.log("Fetching bookmarks...");
    const bookmarks = await fetchBookmarks(accessToken);

    console.log(`Downloading media to ${MEDIA_DIR}/...`);
    const mediaResult = await downloadBookmarkMedia(bookmarks);

    if (!existsSync(BOOKMARKS_DIR)) {
      mkdirSync(BOOKMARKS_DIR, { recursive: true });
    }

    writeFileSync("data/bookmarks.json", JSON.stringify(bookmarks, null, 2));
    writeFileSync(BOOKMARKS_MARKDOWN_PATH, generateBookmarksMarkdown(bookmarks));
    console.log(`Saved ${bookmarks.length} bookmarks to data/bookmarks.json`);
    console.log(`Saved markdown to ${BOOKMARKS_MARKDOWN_PATH}`);
    console.log(
      `Saved ${mediaResult.downloaded} media files to ${MEDIA_DIR}/` +
        (mediaResult.failed ? ` (${mediaResult.failed} failed)` : ""),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error:", message);
    process.exit(1);
  }
}

main();
