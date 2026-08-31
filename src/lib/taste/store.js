import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

export const ROOT = process.cwd();
export const TASTE_DIR = path.join(ROOT, "taste");
export const LAB_DIR = path.join(ROOT, "src/app/lab");
export const SKILL_PATH = path.join(ROOT, ".claude/skills/taste/SKILL.md");
export const PROFILE_DIR = path.join(TASTE_DIR, "profile");
export const ARCHIVE_DIR = path.join(TASTE_DIR, "archive");

export const VOTES_FILE = path.join(TASTE_DIR, "votes.jsonl");
export const NOTES_FILE = path.join(TASTE_DIR, "notes.jsonl");
export const IDEAS_FILE = path.join(TASTE_DIR, "ideas.jsonl");
export const SEED_FILE = path.join(TASTE_DIR, "seed.json");

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}$/;
export const STATUSES = ["candidate", "liked", "rejected", "shipped", "broken"];
export const VERDICTS = ["like", "dislike", "skip", "continue", "iterate"];
export const POINT_VERDICTS = ["love", "hate"];
export const REASONS = [
  "type",
  "spacing",
  "colour",
  "motion",
  "hierarchy",
  "too-much",
  "too-safe",
  "off-brief",
];
export const VIEWPORTS = [390, 768, 1280];

export const newId = () => crypto.randomBytes(6).toString("hex");
export const now = () => new Date().toISOString();

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function readJsonl(file) {
  try {
    const raw = await fs.readFile(file, "utf-8");
    return raw
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function appendJsonl(file, record) {
  await ensureDir(path.dirname(file));
  await fs.appendFile(file, JSON.stringify(record) + "\n");
  return record;
}

export async function rewriteJsonl(file, records) {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : ""));
}

export async function readManifest(slug) {
  try {
    const raw = await fs.readFile(path.join(LAB_DIR, slug, "experiment.json"), "utf-8");
    return normalizeManifest(slug, JSON.parse(raw));
  } catch {
    return null;
  }
}

export function normalizeManifest(slug, data) {
  return {
    slug,
    title: typeof data?.title === "string" ? data.title : slug,
    description: typeof data?.description === "string" ? data.description : "",
    tags: Array.isArray(data?.tags) ? data.tags.filter((t) => typeof t === "string").slice(0, 8) : [],
    status: STATUSES.includes(data?.status) ? data.status : "candidate",
    createdAt: typeof data?.createdAt === "string" ? data.createdAt : null,
    ideaId: typeof data?.ideaId === "string" ? data.ideaId : null,
    parentSlug: typeof data?.parentSlug === "string" ? data.parentSlug : null,
    tasteVersion: Number.isInteger(data?.tasteVersion) ? data.tasteVersion : null,
    intent: typeof data?.intent === "string" ? data.intent : "",
    building: data?.building === true,
    iteration: Number.isInteger(data?.iteration) ? data.iteration : 0,
    iteratedAt: typeof data?.iteratedAt === "string" ? data.iteratedAt : null,
    changelog: Array.isArray(data?.changelog) ? data.changelog : [],
    source: data?.source && typeof data.source === "object" ? data.source : null,
    generation: data?.generation && typeof data.generation === "object" ? data.generation : null,
  };
}

export async function listManifests() {
  let entries = [];
  try {
    entries = await fs.readdir(LAB_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !SLUG_RE.test(entry.name)) continue;
    const manifest = await readManifest(entry.name);
    if (manifest) out.push(manifest);
  }
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function writeManifest(slug, manifest) {
  const file = path.join(LAB_DIR, slug, "experiment.json");
  const { slug: _slug, ...rest } = manifest;
  await fs.writeFile(file, JSON.stringify(rest, null, 2) + "\n");
}

export async function setStatus(slug, status) {
  const manifest = await readManifest(slug);
  if (!manifest) return null;
  const next = { ...manifest, status };
  await writeManifest(slug, next);
  return next;
}

export async function readVotes() {
  return readJsonl(VOTES_FILE);
}

export async function readNotes() {
  return readJsonl(NOTES_FILE);
}

export async function readIdeas() {
  return readJsonl(IDEAS_FILE);
}

export async function readSeed() {
  try {
    const data = JSON.parse(await fs.readFile(SEED_FILE, "utf-8"));
    return {
      loved: Array.isArray(data.loved) ? data.loved : [],
      hated: Array.isArray(data.hated) ? data.hated : [],
    };
  } catch {
    return { loved: [], hated: [] };
  }
}

export async function writeSeed(seed) {
  await ensureDir(TASTE_DIR);
  await fs.writeFile(SEED_FILE, JSON.stringify(seed, null, 2) + "\n");
}

export async function readTasteSkill() {
  try {
    return await fs.readFile(SKILL_PATH, "utf-8");
  } catch {
    return "";
  }
}

export function tasteVersionOf(skillText) {
  const match = skillText.match(/^version:\s*(\d+)/m);
  return match ? Number(match[1]) : 0;
}

export async function currentTasteVersion() {
  return tasteVersionOf(await readTasteSkill());
}

export function effectiveVerdicts(votes) {
  const bySlug = new Map();
  for (const vote of votes) {
    if (vote.kind !== "verdict" || vote.undone) continue;
    bySlug.set(vote.slug, vote);
  }
  return bySlug;
}

export function awaitingJudgement(manifest, verdict) {
  if (manifest.building) return false;
  if (!verdict) return true;
  return (manifest.iteration || 0) > (verdict.iteration || 0);
}

export function pointsFor(votes, slug) {
  return votes.filter((v) => v.kind === "point" && v.slug === slug && !v.undone);
}

export function sanitizeVerdict(body) {
  const slug = String(body?.slug || "");
  if (!SLUG_RE.test(slug)) return null;
  if (!VERDICTS.includes(body?.verdict)) return null;
  const reasons = Array.isArray(body?.reasons) ? body.reasons.filter((r) => REASONS.includes(r)) : [];
  return {
    id: newId(),
    ts: now(),
    kind: "verdict",
    slug,
    verdict: body.verdict,
    reasons: [...new Set(reasons)],
    msToDecide: Number.isFinite(body?.msToDecide) ? Math.round(body.msToDecide) : null,
    viewport: VIEWPORTS.includes(body?.viewport) ? body.viewport : null,
    recheck: body?.recheck === true,
    iteration: Number.isInteger(body?.iteration) ? body.iteration : 0,
    tasteVersion: Number.isInteger(body?.tasteVersion) ? body.tasteVersion : null,
    session: typeof body?.session === "string" ? body.session.slice(0, 32) : null,
    undone: false,
  };
}

const clip = (value, max) => (typeof value === "string" ? value.slice(0, max) : "");

export function sanitizePoint(body) {
  const slug = String(body?.slug || "");
  if (!SLUG_RE.test(slug)) return null;
  if (!POINT_VERDICTS.includes(body?.verdict)) return null;
  const point = body?.point && typeof body.point === "object" ? body.point : {};
  const rect = point.rect && typeof point.rect === "object" ? point.rect : {};
  const computed = point.computed && typeof point.computed === "object" ? point.computed : {};
  const safeComputed = {};
  for (const [key, value] of Object.entries(computed)) {
    if (typeof value === "string" && Object.keys(safeComputed).length < 40) safeComputed[key] = value.slice(0, 200);
  }
  const reasons = Array.isArray(body?.reasons) ? body.reasons.filter((r) => REASONS.includes(r)) : [];
  return {
    id: newId(),
    ts: now(),
    kind: "point",
    slug,
    verdict: body.verdict,
    reasons: [...new Set(reasons)],
    note: clip(body?.note, 500),
    viewport: VIEWPORTS.includes(body?.viewport) ? body.viewport : null,
    tasteVersion: Number.isInteger(body?.tasteVersion) ? body.tasteVersion : null,
    point: {
      selector: clip(point.selector, 300),
      tag: clip(point.tag, 32),
      text: clip(point.text, 160),
      html: clip(point.html, 1200),
      rect: {
        x: Number(rect.x) || 0,
        y: Number(rect.y) || 0,
        w: Number(rect.w) || 0,
        h: Number(rect.h) || 0,
      },
      computed: safeComputed,
    },
    undone: false,
  };
}

export function sanitizeNote(body) {
  const text = clip(body?.text, 4000).trim();
  if (!text) return null;
  const slug = typeof body?.slug === "string" && SLUG_RE.test(body.slug) ? body.slug : null;
  return {
    id: newId(),
    ts: now(),
    slug,
    text,
    reply: null,
    tasteVersion: Number.isInteger(body?.tasteVersion) ? body.tasteVersion : null,
  };
}

export function reasonAffinity(votes) {
  const table = {};
  for (const reason of REASONS) table[reason] = { like: 0, dislike: 0, love: 0, hate: 0 };
  for (const vote of votes) {
    if (vote.undone) continue;
    for (const reason of vote.reasons || []) {
      if (!table[reason]) continue;
      if (vote.kind === "verdict" && (vote.verdict === "like" || vote.verdict === "dislike")) table[reason][vote.verdict] += 1;
      if (vote.kind === "point") table[reason][vote.verdict] += 1;
    }
  }
  return table;
}

export function consistency(votes) {
  const first = new Map();
  let agree = 0;
  let total = 0;
  for (const vote of votes) {
    if (vote.kind !== "verdict" || vote.undone || vote.verdict === "skip") continue;
    if (!vote.recheck) {
      if (!first.has(vote.slug)) first.set(vote.slug, vote.verdict);
      continue;
    }
    const earlier = first.get(vote.slug);
    if (!earlier) continue;
    total += 1;
    const same = (earlier === "dislike") === (vote.verdict === "dislike");
    if (same) agree += 1;
  }
  return { agree, total };
}
