import assert from "node:assert/strict";
import test from "node:test";
import { affordableItems, BOOKMARK_RATE, calculateTweetListCredits } from "../src/credits.ts";

// Net revenue per credit from the $10 / 1,250 pack after Polar's 4% + $0.40 fee.
const NET_PER_CREDIT = (10 - 0.4 - 0.4) / 1250;
const X_COST_PER_BOOKMARK = 0.005;

test("bookmarks cost 7 credits per 10 and never cost less than X charges", () => {
  assert.equal(calculateTweetListCredits(1, BOOKMARK_RATE), 1);
  assert.equal(calculateTweetListCredits(3, BOOKMARK_RATE), 3);
  assert.equal(calculateTweetListCredits(10, BOOKMARK_RATE), 7);
  assert.equal(calculateTweetListCredits(100, BOOKMARK_RATE), 70);
  assert.equal(calculateTweetListCredits(800, BOOKMARK_RATE), 560);
  assert.equal(affordableItems(0, BOOKMARK_RATE), 0);
  assert.equal(affordableItems(1, BOOKMARK_RATE), 1);
  assert.equal(affordableItems(3, BOOKMARK_RATE), 4);
  assert.equal(affordableItems(7, BOOKMARK_RATE), 10);

  for (let count = 1; count <= 800; count++) {
    const credits = calculateTweetListCredits(count, BOOKMARK_RATE);
    assert.ok(affordableItems(credits, BOOKMARK_RATE) >= count, `${count} bookmarks fit`);
    assert.ok(credits * NET_PER_CREDIT >= count * X_COST_PER_BOOKMARK, `${count} bookmarks pay X`);
  }
  for (let credits = 1; credits <= 600; credits++) {
    const count = affordableItems(credits, BOOKMARK_RATE);
    assert.ok(calculateTweetListCredits(count, BOOKMARK_RATE) <= credits, `${credits} credits`);
  }
});

test("posts keep 20 per credit", () => {
  assert.equal(calculateTweetListCredits(20), 1);
  assert.equal(calculateTweetListCredits(21), 2);
});
