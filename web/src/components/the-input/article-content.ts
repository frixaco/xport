import type { ContentBlock, MediaItem } from "./types";
import { isNonEmptyString, isObject } from "./payload";
import { extractMediaFromText } from "./tweet-card";

const STYLE_MAP: Record<string, { marker: string; markerEnd: string }> = {
  Bold: { marker: "**", markerEnd: "**" },
  Italic: { marker: "_", markerEnd: "_" },
  BoldItalic: { marker: "**_", markerEnd: "_**" },
  Underline: { marker: "<u>", markerEnd: "</u>" },
  Strikethrough: { marker: "~~", markerEnd: "~~" },
  Code: { marker: "`", markerEnd: "`" },
  ItalicCode: { marker: "_`", markerEnd: "`_" },
  BoldCode: { marker: "**`", markerEnd: "`**" },
};

interface InlineStyleRange {
  offset: number;
  length: number;
  style: string;
}

function applyInlineStyles(text: string, ranges: InlineStyleRange[] | undefined): string {
  if (!ranges || ranges.length === 0) return text;

  // oxlint-disable-next-line unicorn/no-array-sort -- toSorted is not in this package's TS lib target.
  const sorted = [...ranges].sort((a, b) => b.offset - a.offset);
  let result = text;

  for (const range of sorted) {
    const style = STYLE_MAP[range.style];
    if (!style) continue;

    const before = result.slice(0, range.offset);
    const marked = result.slice(range.offset, range.offset + range.length);
    const after = result.slice(range.offset + range.length);
    result = `${before}${style.marker}${marked}${style.markerEnd}${after}`;
  }

  return result;
}

function renderContentBlock(
  block: {
    type?: string;
    text?: string;
    url?: string;
    previewUrl?: string;
    width?: number;
    height?: number;
    inlineStyleRanges?: InlineStyleRange[];
  },
  orderedIndex: number,
): { text: string; media: MediaItem[] } {
  const styledText = applyInlineStyles(block.text || "", block.inlineStyleRanges);
  const media: MediaItem[] = [];

  switch (block.type) {
    case "header-one":
      return { text: `## ${styledText}`, media };

    case "header-two":
      return { text: `### ${styledText}`, media };

    case "header-three":
      return { text: `#### ${styledText}`, media };

    case "unordered-list-item":
      return { text: `- ${styledText}`, media };

    case "ordered-list-item":
      return { text: `${orderedIndex + 1}. ${styledText}`, media };

    case "image": {
      if (!block.url) return { text: "", media };
      const displayUrl = block.previewUrl || block.url;
      const dims = block.width && block.height ? `=${block.width}x${block.height}` : "";
      return { text: `![](${displayUrl}${dims})`, media };
    }

    case "gif": {
      if (!block.url) return { text: "", media };
      const displayUrl = block.previewUrl || block.url;
      return { text: `![](${displayUrl})`, media };
    }

    case "divider":
      return { text: "---", media };

    case "blockquote":
      return { text: `> ${styledText}`, media };

    case "unstyled":
    case "markdown":
    default: {
      const textMedia = extractMediaFromText(block.text || "");
      textMedia.forEach((item) => {
        if (!media.some((m) => m.url === item.url)) {
          media.push(item);
        }
      });
      return { text: styledText, media };
    }
  }
}

function normalizeArticleContentBlock(content: unknown, orderedIndex: number): ContentBlock {
  if (!isObject(content)) {
    return { type: "unstyled", text: "", styledText: "" };
  }

  const type = isNonEmptyString(content.type) ? content.type : "unstyled";
  const text = isNonEmptyString(content.text) ? content.text : "";
  const url = isNonEmptyString(content.url) ? content.url : undefined;
  const previewUrl = isNonEmptyString(content.previewUrl) ? content.previewUrl : undefined;
  const width = typeof content.width === "number" ? content.width : undefined;
  const height = typeof content.height === "number" ? content.height : undefined;

  const inlineStyleRanges: InlineStyleRange[] = [];
  if (Array.isArray(content.inlineStyleRanges)) {
    for (const range of content.inlineStyleRanges) {
      if (
        isObject(range) &&
        typeof range.offset === "number" &&
        typeof range.length === "number" &&
        isNonEmptyString(range.style)
      ) {
        inlineStyleRanges.push({
          offset: range.offset,
          length: range.length,
          style: range.style,
        });
      }
    }
  }

  const rendered = renderContentBlock(
    { type, text, url, previewUrl, width, height, inlineStyleRanges },
    orderedIndex,
  );

  return {
    type,
    text: rendered.text,
    url,
    previewUrl,
    width,
    height,
    styledText: rendered.text,
  };
}

export function normalizeArticleContents(contents: unknown[]): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let orderedIndex = 0;

  for (const content of contents) {
    const block = normalizeArticleContentBlock(content, orderedIndex);

    if (block.type === "ordered-list-item") {
      blocks.push(block);
      orderedIndex++;
    } else {
      blocks.push(block);
      if (block.type !== "unordered-list-item") {
        orderedIndex = 0;
      }
    }
  }

  return blocks;
}
