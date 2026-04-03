import { readFileSync, existsSync } from "fs";

const filePath = "./data/posts.json";
if (existsSync(filePath)) {
  const content = readFileSync(filePath, "utf8");
  const j = JSON.parse(content);
  console.log(Array.isArray(j) ? j.length : 0);
} else {
  console.log(0);
}
