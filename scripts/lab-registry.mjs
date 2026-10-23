import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const LAB = join(ROOT, "src/app/lab");
const OUT = join(LAB, "registry.js");
const PIECES_OUT = join(LAB, "pieces.js");
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
    // A study on the experiments index is a whole row ("wide") or half of one
    // ("tall"), and as tall as the screen either way.
    // An older manifest's { cols, rows } maps across: three of six columns or
    // fewer was a half.
    tile: data.tile && typeof data.tile === "object" ? { shape: data.tile.shape ? (data.tile.shape === "tall" ? "tall" : "wide") : Number(data.tile.cols) <= 3 ? "tall" : "wide" } : null,
    // How the piece is played, for its tile on the experiments index (see
    // src/app/experiments/layouts/hints.js for the shape).
    hint: data.hint && typeof data.hint === "object" && typeof data.hint.text === "string" ? data.hint : null,
    embeddable: existsSync(join(LAB, entry.name, "Piece.jsx")),
  });
}

items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

const source = `export const LAB = ${JSON.stringify(
  items.map(({ embeddable, ...item }) => item),
  null,
  2,
)};\n`;
const previous = existsSync(OUT) ? readFileSync(OUT, "utf-8") : null;
if (previous !== source) writeFileSync(OUT, source);

const embedded = items.filter((item) => item.status === "shipped" && item.embeddable);
const piecesSource = `export const LAB_PIECES = {\n${embedded
  .map((item) => `  ${JSON.stringify(item.slug)}: () => import("./${item.slug}/Piece"),\n`)
  .join("")}};\n`;
const previousPieces = existsSync(PIECES_OUT) ? readFileSync(PIECES_OUT, "utf-8") : null;
if (previousPieces !== piecesSource) writeFileSync(PIECES_OUT, piecesSource);

console.log(`lab registry: ${items.length} experiment(s)`);
