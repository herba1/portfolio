import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const LAB = join(ROOT, "src/app/lab");
const OUT = join(LAB, "registry.js");
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}$/;
const STATUSES = new Set(["candidate", "liked", "rejected", "shipped", "broken"]);

mkdirSync(LAB, { recursive: true });

const entries = existsSync(LAB) ? readdirSync(LAB, { withFileTypes: true }) : [];
const items = [];

for (const entry of entries) {
  if (!entry.isDirectory() || !SLUG_RE.test(entry.name)) continue;
  const file = join(LAB, entry.name, "experiment.json");
  if (!existsSync(file)) continue;
  let data;
  try {
    data = JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    continue;
  }
  items.push({
    slug: entry.name,
    title: typeof data.title === "string" ? data.title : entry.name,
    description: typeof data.description === "string" ? data.description : "",
    tags: Array.isArray(data.tags) ? data.tags.filter((t) => typeof t === "string") : [],
    status: STATUSES.has(data.status) ? data.status : "candidate",
    createdAt: typeof data.createdAt === "string" ? data.createdAt : "",
    parentSlug: typeof data.parentSlug === "string" ? data.parentSlug : null,
  });
}

items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

const source = `export const LAB = ${JSON.stringify(items, null, 2)};\n`;
const previous = existsSync(OUT) ? readFileSync(OUT, "utf-8") : null;
if (previous !== source) writeFileSync(OUT, source);

console.log(`lab registry: ${items.length} experiment(s)`);
