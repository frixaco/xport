const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function configuredOrigin(): string | null {
  const value = process.env.BETTER_AUTH_URL;
  if (!value) return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function isTrustedMutationRequest(request: Request): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true;
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;

  const origin = request.headers.get("origin");
  if (!origin) {
    return request.headers.get("authorization")?.startsWith("Bearer ") ?? false;
  }

  const allowedOrigins = new Set([new URL(request.url).origin]);
  const publicOrigin = configuredOrigin();
  if (publicOrigin) allowedOrigins.add(publicOrigin);
  return allowedOrigins.has(origin);
}

export function publicJobError(code: string | null): { code: string; message: string } | null {
  if (!code) return null;

  if (code === "FETCH_LIMIT_REACHED") {
    return {
      code,
      message: "The export reached its safe fetch limit. Partial results are available.",
    };
  }
  if (code === "UPSTREAM_ERROR") {
    return {
      code,
      message: "The source service could not complete this export. Please try again.",
    };
  }
  return {
    code: "FETCH_JOB_ERROR",
    message: "The export could not be completed. Please try again.",
  };
}
