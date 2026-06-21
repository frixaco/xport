import { auth } from "@/lib/auth";
import {
  BillingAccessError,
  ingestCreditsUsage,
  type CreditsUsageMetadata,
} from "@/lib/billing-access";
import { buildUsageMetadata, withUsageMetadata, type XportUsageMetadata } from "@/lib/credits";
import { getJobStatus, type FetchJobRow } from "@/lib/fetch-job";
import { XApiError } from "@/lib/x-api";

type JsonObject = Record<string, unknown>;

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
    return errorJson(error.message, error.status, { details: error.details });
  }

  return errorJson(fallbackMessage, 500);
}

export async function withApiRouteErrors(
  operation: () => Promise<Response>,
  fallbackMessage: string,
): Promise<Response> {
  try {
    return await operation();
  } catch (error) {
    return handleApiRouteError(error, fallbackMessage);
  }
}

export async function jsonWithChargedUsage<T extends object>(
  request: Request,
  payload: T,
  usage: CreditsUsageMetadata & { tweetCount?: number },
): Promise<Response> {
  const charged = await ingestCreditsUsage(request, { credits: usage.credits });
  const usageMetadata = buildUsageMetadata({
    charged,
    chargedCredits: usage.credits,
    tweetCount: usage.tweetCount,
  });

  return Response.json(withUsageMetadata(payload, usageMetadata), {
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
    pagesFetched: job.pagesFetched,
    rawFetchedTweets: job.rawFetchedTweets,
    storedTweets: job.storedTweets,
    chargedCredits: job.chargedCredits,
    hasNextPage: job.hasNextPage,
    error:
      job.errorCode || job.errorMessage ? { code: job.errorCode, message: job.errorMessage } : null,
    updatedAt: job.updatedAt,
  };

  if (options.includeInput) {
    payload.requestType = job.requestType;
    payload.inputRaw = job.inputRaw;
    payload.inputNormalized = job.inputNormalized;
  }

  return payload;
}
