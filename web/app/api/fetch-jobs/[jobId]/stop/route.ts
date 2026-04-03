import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getJobStatus, requestJobStop } from "@/lib/fetch-job";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { jobId } = await params;
  const job = await getJobStatus(jobId);
  if (!job || job.owner_user_id !== session.user.id) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  const updated = await requestJobStop(jobId);
  if (!updated) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  return NextResponse.json({
    status: updated.status,
    pagesFetched: updated.pages_fetched,
    rawFetchedTweets: updated.raw_fetched_tweets,
    storedTweets: updated.stored_tweets,
    chargedCredits: updated.charged_credits,
    hasNextPage: updated.has_next_page,
    error:
      updated.error_code || updated.error_message
        ? { code: updated.error_code, message: updated.error_message }
        : null,
    updatedAt: updated.updated_at,
  });
}
