import { auth } from "@/lib/auth";
import { BillingAccessError, getBillingUser } from "@/lib/billing-access";
import { getCreditBalance } from "./credit-ledger.ts";
import { getDirectResult, settleDirectResult, type DirectResult } from "./direct-billing.ts";
import { buildUsageMetadata, withUsageMetadata, type XportUsageMetadata } from "@/lib/credits";
import { FetchJobLimitError, getJobStatus, type FetchJobRow } from "@/lib/fetch-job";
import { captureServerEvent, captureServerException } from "@/lib/server-telemetry";
import { XApiError } from "@/lib/x-api";
import { isTrustedMutationRequest, publicJobError } from "@/lib/request-security";

type JsonObject = Record<string, unknown>;

interface ApiTelemetryContext {
  route: string;
  fallbackMessage: string;
  inputNormalized?: string;
  jobId?: string;
  requestType?: string;
  userId?: string | null;
}

function toResponseStatus(status: number): number {
  return status >= 400 && status <= 599 ? status : 500;
}

export function errorJson(message: string, status: number, extra: JsonObject = {}): Response {
  return Response.json({ error: message, ...extra }, { status: toResponseStatus(status) });
}

export function firstSearchParam(url: URL, names: string[]): string | null {
  for (const name of names) {
    const value = url.searchParams.get(name);
    if (value) return value;
  }
  return null;
}

export function parseBooleanSearchParam(value: string | null): boolean {
  return value ? ["1", "true", "yes"].includes(value.trim().toLowerCase()) : false;
}

function handleApiRouteError(error: unknown, fallbackMessage: string): Response {
  if (error instanceof BillingAccessError) {
    return errorJson(error.message, error.status, { code: error.code });
  }

  if (error instanceof XApiError) {
    return errorJson("The source service could not complete the request.", 502, {
      code: "UPSTREAM_ERROR",
    });
  }

  if (error instanceof FetchJobLimitError) {
    return errorJson(error.message, 429, { code: "JOB_LIMIT_REACHED" });
  }

  return errorJson(fallbackMessage, 500);
}

export function requireTrustedMutation(request: Request): Response | null {
  if (isTrustedMutationRequest(request)) return null;
  return errorJson("Cross-origin request denied.", 403, { code: "INVALID_ORIGIN" });
}

export async function withApiRouteTelemetry(
  request: Request,
  context: ApiTelemetryContext,
  operation: (context: ApiTelemetryContext) => Promise<Response>,
): Promise<Response> {
  let response: Response;
  let error: unknown;

  try {
    response = await operation(context);
  } catch (routeError) {
    error = routeError;
    response = handleApiRouteError(routeError, context.fallbackMessage);
  }

  await reportApiFailure(request, response, context, error);
  return response;
}

export async function jsonWithChargedUsage(
  request: Request,
  fingerprint: string,
  fetchResult: () => Promise<DirectResult>,
): Promise<Response> {
  const originError = requireTrustedMutation(request);
  if (originError) return originError;
  const userId = await getBillingUser(request);
  const key = request.headers.get("Idempotency-Key");
  if (!key || !/^[a-zA-Z0-9_-]{1,128}$/.test(key)) {
    throw new BillingAccessError(
      "A valid Idempotency-Key header is required.",
      400,
      "INVALID_OPERATION_KEY",
    );
  }
  const operationKey = `direct:${userId}:${key}`;
  let result = await getDirectResult(operationKey, userId, fingerprint);
  if (!result) {
    if ((await getCreditBalance(userId)) < 1)
      throw new BillingAccessError("Insufficient credits.", 402, "INSUFFICIENT_CREDITS");
    result = await settleDirectResult(operationKey, userId, fingerprint, await fetchResult());
  }
  const usageMetadata = buildUsageMetadata({
    charged: true,
    chargedCredits: result.credits,
    tweetCount: result.tweetCount,
  });
  return Response.json(withUsageMetadata(result.payload, usageMetadata), {
    status: 200,
    headers: usageHeaders(usageMetadata),
  });
}

function usageHeaders(metadata: XportUsageMetadata): HeadersInit {
  return {
    "Cache-Control": "no-store",
    "X-Xport-Credits-Charged": String(metadata.chargedCredits),
  };
}

export async function getOwnedJobOrResponse(
  request: Request,
  jobId: string,
): Promise<{ job: FetchJobRow } | { response: Response }> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return { response: errorJson("Authentication required.", 401) };
  }

  const job = await getJobStatus(jobId);
  if (!job || job.ownerUserId !== session.user.id) {
    return { response: errorJson("Job not found.", 404) };
  }

  return { job };
}

export function jobStatusJson(
  job: FetchJobRow,
  options: { includeInput?: boolean } = {},
): JsonObject {
  const payload: JsonObject = {
    status: job.status,
    stopRequested: job.stopRequested,
    pagesFetched: job.pagesFetched,
    rawFetchedTweets: job.rawFetchedTweets,
    storedTweets: job.storedTweets,
    chargedCredits: job.chargedCredits,
    hasNextPage: job.hasNextPage,
    error: publicJobError(job.errorCode),
    updatedAt: job.updatedAt,
  };

  if (options.includeInput) {
    payload.requestType = job.requestType;
    payload.inputRaw = job.inputRaw;
    payload.inputNormalized = job.inputNormalized;
  }

  return payload;
}

async function reportApiFailure(
  request: Request,
  response: Response,
  context: ApiTelemetryContext,
  error: unknown,
): Promise<void> {
  if (response.ok) return;

  const payload = await response
    .clone()
    .json()
    .catch(() => null);
  const userId = context.userId ?? (await getRequestUserId(request));
  const properties = {
    route: context.route,
    method: request.method,
    status: response.status,
    error_code:
      isObject(payload) && typeof payload.code === "string"
        ? payload.code
        : `HTTP_${response.status}`,
    details_category: getDetailsCategory(payload),
    user_id: userId,
    job_id: context.jobId,
    request_type: context.requestType,
    input_normalized: context.inputNormalized,
  };

  captureServerEvent("api request failed", {
    distinctId: userId,
    properties,
  });
  captureServerException(error ?? new Error(`API request failed (${response.status})`), {
    distinctId: userId,
    properties,
  });
}

async function getRequestUserId(request: Request): Promise<string | null> {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    return session?.user.id ?? null;
  } catch {
    return null;
  }
}

function getDetailsCategory(payload: unknown): string | undefined {
  if (!isObject(payload) || !("details" in payload)) return undefined;

  const details = payload.details;
  if (details === null || details === undefined) return undefined;
  if (isObject(details) && typeof details.status === "string") return `status:${details.status}`;
  return Array.isArray(details) ? "array" : typeof details;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
