import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getJobStatus, getJobTweets } from "@/lib/fetch-job";

export const runtime = "nodejs";

export async function GET(
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

  const searchParams = request.nextUrl.searchParams;
  const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10) || 0);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10) || 20));

  const result = await getJobTweets(jobId, offset, limit);

  if (job.request_type === "thread") {
    return NextResponse.json({
      mainTweet: result.mainTweet,
      tweets: result.tweets,
      total: result.total,
    });
  }

  return NextResponse.json({
    tweets: result.tweets,
    total: result.total,
  });
}
