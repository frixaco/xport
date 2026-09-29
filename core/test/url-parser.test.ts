import assert from "node:assert/strict";
import test from "node:test";
import { parseTwitterInput, buildRequestConfig, detectUrlType } from "../src/url-parser.ts";

test("source URLs, IDs and usernames route to the correct export", () => {
  for (const input of ["@frixaco", "frixaco", "https://x.com/frixaco", "twitter.com/frixaco"]) {
    assert.deepEqual(parseTwitterInput(input), { type: "user", username: "frixaco" });
  }
  for (const kind of ["status", "thread", "article"]) {
    const input = `https://x.com/frixaco/${kind}/123`;
    assert.deepEqual(parseTwitterInput(input), {
      type: "tweet",
      tweetId: "123",
      username: "frixaco",
    });
    assert.equal(
      buildRequestConfig(input, detectUrlType(input))?.type,
      kind === "article" ? "article" : "thread",
    );
  }
  for (const input of [
    "",
    "@",
    "https://evil.test/frixaco",
    "https://x.com/home",
    "https://x.com/%ZZ",
  ]) {
    assert.equal(parseTwitterInput(input), null);
  }
});
