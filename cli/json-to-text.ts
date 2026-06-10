import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { basename, join } from "path";

const inputFile = process.argv[2];
if (!inputFile) {
  console.error("Usage: pnpm exec tsx json-to-text.ts <input.json> [items-per-file]");
  process.exit(1);
}

const _itemsPerFile = parseInt(process.argv[3] || "100", 10);
const data = JSON.parse(readFileSync(inputFile, "utf-8"));

if (!Array.isArray(data)) {
  console.error("Error: JSON must contain an array");
  process.exit(1);
}

function formatValue(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (value === null || value === undefined) return `${pad}_null_`;
  if (typeof value === "string") return `${pad}${value}`;
  if (typeof value === "number" || typeof value === "boolean") return `${pad}${value}`;
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}_empty array_`;
    return value.map((v, _i) => `${pad}- ${formatValue(v, 0)}`).join("\n");
  }
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([k, v]) => `${pad}**${k}**: ${formatValue(v, 0)}`)
      .join("\n");
  }
  return `${pad}${String(value)}`;
}

function formatItem(item: unknown, index: number): string {
  if (typeof item !== "object" || item === null) {
    return `### Item ${index + 1}\n${formatValue(item)}`;
  }

  const lines: string[] = [`### Item ${index + 1}`];
  for (const [key, value] of Object.entries(item)) {
    if (Array.isArray(value) && value.length > 0) {
      lines.push(`**${key}**:`);
      lines.push(formatValue(value, 1));
    } else {
      lines.push(`**${key}**: ${formatValue(value)}`);
    }
  }
  return lines.join("\n");
}

const baseName = basename(inputFile, ".json");
const outputFile = join("data", `${baseName}.md`);

if (!existsSync("data")) {
  mkdirSync("data", { recursive: true });
}
const formatted = data.map((item, idx) => formatItem(item, idx)).join("\n\n---\n\n");
writeFileSync(outputFile, formatted);

console.log(`Converted ${data.length} items to ${outputFile}`);
