import assert from "node:assert/strict";
import test from "node:test";
import { getDownloadPayload } from "../src/copy-formats.ts";
import { buildFetchJobResult } from "../src/fetch-job-result.ts";
import { normalizeTweetCards } from "../src/tweet-card.ts";
import type { FetchJobStatusResponse } from "../src/types.ts";

const status: FetchJobStatusResponse = {
  status: "completed",
  stopRequested: false,
  pagesFetched: 1,
  rawFetchedTweets: 2,
  storedTweets: 2,
  chargedCredits: 1,
  hasNextPage: false,
  error: null,
  updatedAt: "2026-09-03T00:00:00.000Z",
};

test("account exports identify replies and link to their parent posts", () => {
  const [post, reply] = normalizeTweetCards([
    {
      id: "100",
      text: "A normal post",
      url: "https://x.com/example/status/100",
      author: { userName: "example" },
      createdAt: "2026-09-01T00:00:00.000Z",
    },
    {
      id: "200",
      text: "A reply",
      url: "https://x.com/example/status/200",
      author: { userName: "example" },
      createdAt: "2026-09-02T00:00:00.000Z",
      isReply: true,
      inReplyToId: "150",
      inReplyToUsername: "target",
    },
  ]);

  assert.ok(post);
  assert.ok(reply);
  assert.equal(post.replyTo, null);
  assert.deepEqual(reply.replyTo, {
    id: "150",
    username: "target",
    url: "https://x.com/target/status/150",
  });

  const timeline = buildFetchJobResult("timeline", [post, reply], null, status, "example");
  const markdown = getDownloadPayload(timeline, "markdown");
  assert.equal(markdown.filename, "example-user-posts.md");
  assert.match(markdown.content, /## Post 1/);
  assert.match(markdown.content, /## Reply 2/);
  assert.match(
    markdown.content,
    /Reply to \[@target's post\]\(https:\/\/x\.com\/target\/status\/150\)/,
  );

  const replies = buildFetchJobResult("replies", [reply], null, status, "example");
  assert.equal(getDownloadPayload(replies, "json").filename, "example-replies.json");
  assert.match(getDownloadPayload(replies, "json").content, /"replyTo"/);
});
