import { isNonEmptyString, isObject } from "./payload.ts";
import type { ContentBlock, InlineSpan, InlineStyle } from "./types.ts";

const STYLE_ORDER: InlineStyle[] = ["bold", "italic", "strikethrough", "underline", "code"];

const STYLE_ALIASES: Record<string, InlineStyle[]> = {
  bold: ["bold"],
  italic: ["italic"],
  bolditalic: ["bold", "italic"],
  underline: ["underline"],
  strikethrough: ["strikethrough"],
  code: ["code"],
  italiccode: ["italic", "code"],
  boldcode: ["bold", "code"],
};

const MARKERS: Record<Exclude<InlineStyle, "code">, [string, string]> = {
  bold: ["**", "**"],
  italic: ["*", "*"],
  strikethrough: ["~~", "~~"],
  underline: ["<u>", "</u>"],
};

const LIST_TYPES = new Set(["unordered-list-item", "ordered-list-item"]);

// X article style offsets count Unicode code points, not UTF-16 units.
function buildSpans(text: string, ranges: unknown): InlineSpan[] | undefined {
  if (!Array.isArray(ranges) || ranges.length === 0) return undefined;
  const chars = Array.from(text);
  const styles = chars.map(() => new Set<InlineStyle>());

  for (const range of ranges) {
    if (!isObject(range) || typeof range.offset !== "number" || typeof range.length !== "number")
      continue;
    const mapped = isNonEmptyString(range.style)
      ? STYLE_ALIASES[range.style.toLowerCase()]
      : undefined;
    if (!mapped) continue;
    const end = Math.min(chars.length, range.offset + range.length);
    for (let i = Math.max(0, range.offset); i < end; i++)
      for (const style of mapped) styles[i]!.add(style);
  }

  for (const style of STYLE_ORDER) {
    // X splits one styled passage into ranges around each space; rejoin whitespace-only gaps.
    let lastStyled = -1;
    chars.forEach((char, i) => {
      if (!styles[i]!.has(style)) return;
      const gap = chars.slice(lastStyled + 1, i);
      if (lastStyled >= 0 && gap.length > 0 && gap.every((c) => /\s/.test(c)))
        for (let j = lastStyled + 1; j < i; j++) styles[j]!.add(style);
      lastStyled = i;
    });
    // Markdown emphasis cannot open or close on whitespace, so trim each style's merged runs.
    let i = 0;
    while (i < chars.length) {
      if (!styles[i]!.has(style)) {
        i++;
        continue;
      }
      let end = i;
      while (end < chars.length && styles[end]!.has(style)) end++;
      for (let j = i; j < end && /\s/.test(chars[j]!); j++) styles[j]!.delete(style);
      for (let j = end - 1; j >= i && /\s/.test(chars[j]!); j--) styles[j]!.delete(style);
      i = end;
    }
  }

  const spans: InlineSpan[] = [];
  let previousKey: string | null = null;
  chars.forEach((char, i) => {
    const active = STYLE_ORDER.filter((style) => styles[i]!.has(style));
    const key = active.join(",");
    if (key === previousKey) spans[spans.length - 1]!.text += char;
    else spans.push({ text: char, styles: active });
    previousKey = key;
  });

  return spans.some((span) => span.styles.length > 0) ? spans : undefined;
}

function normalizeArticleContentBlock(content: unknown): ContentBlock {
  if (!isObject(content)) return { type: "unstyled", text: "" };

  const type = isNonEmptyString(content.type) ? content.type : "unstyled";
  const text = isNonEmptyString(content.text) ? content.text : "";
  const block: ContentBlock = { type, text };
  const spans = buildSpans(text, content.inlineStyleRanges);
  if (spans) block.spans = spans;
  if (isNonEmptyString(content.url)) block.url = content.url;
  if (isNonEmptyString(content.previewUrl)) block.previewUrl = content.previewUrl;
  if (typeof content.width === "number") block.width = content.width;
  if (typeof content.height === "number") block.height = content.height;
  return block;
}

export function normalizeArticleContents(contents: unknown[]): ContentBlock[] {
  return contents.map(normalizeArticleContentBlock);
}

export function getBlockSpans(block: ContentBlock): InlineSpan[] {
  return block.spans ?? [{ text: block.text, styles: [] }];
}

/** Groups consecutive list items of the same kind so lists render as one list. */
export function groupArticleBlocks(
  blocks: ContentBlock[],
): Array<{ type: string; blocks: ContentBlock[] }> {
  const groups: Array<{ type: string; blocks: ContentBlock[] }> = [];
  for (const block of blocks) {
    const last = groups.at(-1);
    if (last && LIST_TYPES.has(block.type) && last.type === block.type) last.blocks.push(block);
    else groups.push({ type: block.type, blocks: [block] });
  }
  return groups;
}

function escapeMarkdownText(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[\\`*~[\]<>]/g, "\\$&")
    .replace(/(^|[^\p{L}\p{N}])_|_(?=$|[^\p{L}\p{N}])/gu, (match) => match.replace("_", "\\_"));
}

function toCodeSpan(text: string): string {
  const fence = text.includes("`") ? "``" : "`";
  const padded = text.startsWith("`") || text.endsWith("`") ? ` ${text} ` : text;
  return `${fence}${padded}${fence}`;
}

function renderInlineMarkdown(spans: InlineSpan[]): string {
  const stack: Array<Exclude<InlineStyle, "code">> = [];
  let out = "";

  const closeTo = (keep: number) => {
    if (stack.length <= keep) return;
    const trailing = /\s*$/.exec(out)![0];
    out = out.slice(0, out.length - trailing.length);
    while (stack.length > keep) out += MARKERS[stack.pop()!][1];
    out += trailing;
  };

  for (const span of spans) {
    const wanted = span.styles.filter(
      (style): style is Exclude<InlineStyle, "code"> => style !== "code",
    );
    let keep = 0;
    while (keep < stack.length && wanted.includes(stack[keep]!)) keep++;
    closeTo(keep);

    const isCode = span.styles.includes("code");
    let text = isCode ? span.text : escapeMarkdownText(span.text);
    const opening = wanted.filter((style) => !stack.includes(style));
    if (opening.length > 0) {
      const leading = /^\s*/.exec(text)![0];
      out += leading;
      text = text.slice(leading.length);
      for (const style of opening) {
        out += MARKERS[style][0];
        stack.push(style);
      }
    }
    out += isCode ? toCodeSpan(text) : text;
  }
  closeTo(0);
  return out;
}

function markdownUrl(url: string): string {
  return url.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
}

function inlineLines(block: ContentBlock, escapeBlockSyntax = true): string[] {
  const lines = renderInlineMarkdown(getBlockSpans(block))
    .split("\n")
    .map((line) => line.trim());
  if (!escapeBlockSyntax) return lines;
  // A leading "#", "-", "+" or "1." would turn prose into block syntax.
  return lines.map((line) =>
    line.replace(/^(#{1,6}\s|[-+]\s)/, "\\$1").replace(/^(\d+)([.)]\s)/, "$1\\$2"),
  );
}

function joinLines(lines: string[], indent = ""): string {
  return lines.filter(Boolean).join(`  \n${indent}`);
}

function renderBlockMarkdown(block: ContentBlock, position: number): string | null {
  switch (block.type) {
    case "header-one":
    case "header-two":
    case "header-three": {
      const level = { "header-one": "##", "header-two": "###", "header-three": "####" }[block.type];
      const text = inlineLines(block, false).filter(Boolean).join(" ");
      return text ? `${level} ${text}` : null;
    }
    case "unordered-list-item": {
      const text = joinLines(inlineLines(block), "  ");
      return text ? `- ${text}` : null;
    }
    case "ordered-list-item": {
      const marker = `${position + 1}.`;
      const text = joinLines(inlineLines(block), " ".repeat(marker.length + 1));
      return text ? `${marker} ${text}` : null;
    }
    case "blockquote": {
      const lines = inlineLines(block).filter(Boolean);
      return lines.length ? lines.map((line) => `> ${line}`).join("\n") : null;
    }
    case "image":
      return block.url ? `![](${markdownUrl(block.url)})` : null;
    case "gif":
      if (!block.url) return null;
      return block.previewUrl
        ? `[![GIF](${markdownUrl(block.previewUrl)})](${markdownUrl(block.url)})`
        : `[GIF](${markdownUrl(block.url)})`;
    case "video":
    case "mp4":
      return block.url ? `[Video](${markdownUrl(block.url)})` : null;
    case "divider":
      return "---";
    case "markdown":
      return block.text.trim() || null;
    default:
      return joinLines(inlineLines(block)) || null;
  }
}

export function articleBlocksToMarkdown(blocks: ContentBlock[]): string {
  return groupArticleBlocks(blocks)
    .map((group) =>
      group.blocks
        .map((block, position) => renderBlockMarkdown(block, position))
        .filter((line): line is string => Boolean(line))
        .join("\n"),
    )
    .filter(Boolean)
    .join("\n\n");
}
