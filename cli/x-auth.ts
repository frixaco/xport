import { createHash, randomBytes } from "crypto";
import { spawn } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { createServer, type Server } from "http";
import { createInterface } from "readline";

const X_CLIENT_SECRET = process.env.X_CLIENT_SECRET;
const REDIRECT_URI = process.env.X_REDIRECT_URI ?? "http://127.0.0.1:3000/callback";
const TOKEN_REFRESH_BUFFER_MS = 60_000;

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
      "X API requires OAuth 2.0 User Context.",
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

function loadStoredToken(tokenPath: string): StoredToken | null {
  if (!existsSync(tokenPath)) {
    return null;
  }

  try {
    const raw = readFileSync(tokenPath, "utf8");
    return JSON.parse(raw) as StoredToken;
  } catch (error) {
    console.warn(`Ignoring invalid token cache at ${tokenPath}:`, error);
    return null;
  }
}

function saveStoredToken(tokenPath: string, tokenData: OAuthTokenResponse): StoredToken {
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

  writeFileSync(tokenPath, JSON.stringify(storedToken, null, 2));
  return storedToken;
}

function buildAuthorizeUrl(scopes: string[], pkce: PkceChallenge): URL {
  const clientId = getClientId();
  const authUrl = new URL("https://x.com/i/oauth2/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("scope", scopes.join(" "));
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

async function exchangeCodeForToken(
  tokenPath: string,
  code: string,
  verifier: string,
): Promise<StoredToken> {
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

  return saveStoredToken(tokenPath, JSON.parse(responseText) as OAuthTokenResponse);
}

async function refreshAccessToken(tokenPath: string, refreshToken: string): Promise<StoredToken> {
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

  return saveStoredToken(tokenPath, JSON.parse(responseText) as OAuthTokenResponse);
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

export async function getAccessToken(scopes: string[], tokenPath: string): Promise<string> {
  const storedToken = loadStoredToken(tokenPath);
  if (storedToken && isTokenUsable(storedToken)) {
    return storedToken.accessToken;
  }

  if (storedToken?.refreshToken) {
    try {
      console.log("Refreshing cached OAuth token...");
      const refreshedToken = await refreshAccessToken(tokenPath, storedToken.refreshToken);
      return refreshedToken.accessToken;
    } catch (error) {
      console.warn("Refresh failed, falling back to interactive authorization:", error);
    }
  }

  const pkce = generatePkce();
  const authUrl = buildAuthorizeUrl(scopes, pkce);
  console.log(`Please go here and authorize: ${authUrl.toString()}`);
  if (!(await openBrowser(authUrl.toString()))) {
    console.log("Browser auto-open failed. Open the URL manually.");
  }

  const code = await waitForCallback(pkce.state);
  const token = await exchangeCodeForToken(tokenPath, code, pkce.verifier);
  return token.accessToken;
}

export async function getUserId(accessToken: string): Promise<string> {
  const response = await fetch("https://api.x.com/2/users/me", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Failed to get user ID: ${response.status} - ${responseText}`);
  }

  const data = JSON.parse(responseText) as { data: { id: string } };
  return data.data.id;
}
