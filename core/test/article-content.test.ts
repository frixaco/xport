import assert from "node:assert/strict";
import test from "node:test";
import { getDownloadPayload } from "../src/copy-formats.ts";
import { normalizeResult } from "../src/result-normalization.ts";

function articleMarkdown(contents: unknown[]): string {
  const result = normalizeResult(
    {
      article: {
        title: "  Spaced   title ",
        author: { userName: "writer" },
        createdAt: "Mon Feb 09 15:43:47 +0000 2026",
        contents,
      },
    },
    "article",
    "https://x.com/writer/article/1",
  );
  const body = getDownloadPayload(result, "markdown").content.split("\n---\n\n")[1] ?? "";
  return body.split("\n\n").slice(2).join("\n\n").trimEnd();
}

test("article markdown applies code-point style offsets after emoji and rejoins split ranges", () => {
  const text = "💡 Resource Tip: read **Google **now";
  const markdown = articleMarkdown([
    {
      type: "blockquote",
      text,
      inlineStyleRanges: [
        { offset: 0, length: 1, style: "Italic" },
        { offset: 2, length: 13, style: "Italic" },
        { offset: 2, length: 13, style: "Bold" },
        { offset: 16, length: 4, style: "Italic" },
      ],
    },
  ]);
  assert.equal(markdown, "> *💡 **Resource Tip:** read* \\*\\*Google \\*\\*now");
});

test("article markdown keeps whitespace outside markers and nests overlapping styles", () => {
  const markdown = articleMarkdown([
    {
      type: "unstyled",
      text: "key words here and Google to see",
      inlineStyleRanges: [
        { offset: 0, length: 9, style: "Bold" },
        { offset: 4, length: 10, style: "Italic" },
        { offset: 19, length: 7, style: "Bold" },
      ],
    },
  ]);
  assert.equal(markdown, "**key *words*** *here* and **Google** to see");
});

test("article markdown renders tight lists, clean images, headings and escaped prose", () => {
  const markdown = articleMarkdown([
    { type: "header-two", text: "   3. Dive in" },
    { type: "ordered-list-item", text: "first" },
    { type: "ordered-list-item", text: "second" },
    { type: "unordered-list-item", text: "bullet" },
    { type: "image", url: "https://pbs.twimg.com/media/a.png", width: 609, height: 395 },
    { type: "unstyled", text: '# not a heading <img src=x onerror="alert(1)">' },
    { type: "ordered-list-item", text: "restart" },
  ]);
  assert.equal(
    markdown,
    [
      "### 3. Dive in",
      "1. first\n2. second",
      "- bullet",
      "![](https://pbs.twimg.com/media/a.png)",
      '\\# not a heading \\<img src=x onerror="alert(1)"\\>',
      "1. restart",
    ].join("\n\n"),
  );
});

test("article markdown starts with the trimmed title and a linked byline", () => {
  const result = normalizeResult(
    { article: { title: "  Spaced   title ", author: { userName: "writer" }, contents: [] } },
    "article",
    "https://x.com/writer/article/1",
  );
  const content = getDownloadPayload(result, "markdown").content;
  assert.match(content, /^title: "Spaced title"$/m);
  assert.match(
    content,
    /\n---\n\n# Spaced title\n\nBy \[@writer\]\(https:\/\/x\.com\/writer\) · \[View on X\]\(https:\/\/x\.com\/writer\/article\/1\)\n$/,
  );
});
