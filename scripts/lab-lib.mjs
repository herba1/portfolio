import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import crypto from "node:crypto";

export const ROOT = process.cwd();
export const TASTE_DIR = join(ROOT, "taste");
export const LAB_DIR = join(ROOT, "src/app/lab");
export const SKILLS_DIR = join(ROOT, ".claude/skills");
export const TASTE_SKILL = join(SKILLS_DIR, "taste/SKILL.md");
export const BUILD_SKILL = join(SKILLS_DIR, "lab-build/SKILL.md");
export const PROFILE_DIR = join(TASTE_DIR, "profile");
export const ARCHIVE_DIR = join(TASTE_DIR, "archive");
export const RUNS_DIR = join(TASTE_DIR, "runs");
export const VOTES_FILE = join(TASTE_DIR, "votes.jsonl");
export const NOTES_FILE = join(TASTE_DIR, "notes.jsonl");
export const IDEAS_FILE = join(TASTE_DIR, "ideas.jsonl");
export const SEED_FILE = join(TASTE_DIR, "seed.json");
export const SOURCES_FILE = join(TASTE_DIR, "sources.json");
export const BATCH_FILE = join(TASTE_DIR, "batch.json");

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}$/;
export const MODELS = {
  build: process.env.LAB_BUILD_MODEL || "claude-opus-5",
  judge: process.env.LAB_JUDGE_MODEL || "claude-opus-5",
  scout: process.env.LAB_SCOUT_MODEL || "claude-sonnet-5",
};

export const newId = () => crypto.randomBytes(6).toString("hex");
export const now = () => new Date().toISOString();
export const log = (...parts) => console.log(`[lab ${new Date().toISOString().slice(11, 19)}]`, ...parts);

export function args(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i += 1;
      } else out[key] = true;
    } else out._.push(arg);
  }
  return out;
}

export function readJsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
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
}

export function appendJsonl(file, record) {
  mkdirSync(join(file, ".."), { recursive: true });
  appendFileSync(file, JSON.stringify(record) + "\n");
  return record;
}

export function writeJsonl(file, records) {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : ""));
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

export function writeJson(file, data) {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

export function readText(file, fallback = "") {
  try {
    return readFileSync(file, "utf-8");
  } catch {
    return fallback;
  }
}

export function tasteVersion() {
  const match = readText(TASTE_SKILL).match(/^version:\s*(\d+)/m);
  return match ? Number(match[1]) : 0;
}

export function listManifests() {
  if (!existsSync(LAB_DIR)) return [];
  const out = [];
  for (const entry of readdirSync(LAB_DIR)) {
    if (!SLUG_RE.test(entry)) continue;
    const file = join(LAB_DIR, entry, "experiment.json");
    if (!existsSync(file)) continue;
    const data = readJson(file, null);
    if (data) out.push({ slug: entry, ...data });
  }
  return out;
}

export function writeManifest(slug, manifest) {
  const { slug: _slug, ...rest } = manifest;
  writeJson(join(LAB_DIR, slug, "experiment.json"), rest);
}

export function readManifest(slug) {
  const data = readJson(join(LAB_DIR, slug, "experiment.json"), null);
  return data ? { slug, ...data } : null;
}

export function effectiveVerdicts(votes) {
  const bySlug = new Map();
  for (const vote of votes) {
    if (vote.kind !== "verdict" || vote.undone || vote.recheck) continue;
    bySlug.set(vote.slug, vote);
  }
  return bySlug;
}

export function slugify(text) {
  const base = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => !STOP.has(w))
    .slice(0, 4)
    .join("-")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return base.length >= 2 ? base : `lab-${newId().slice(0, 6)}`;
}

export function uniqueSlug(text) {
  let slug = slugify(text);
  while (existsSync(join(LAB_DIR, slug)) || existsSync(join(ARCHIVE_DIR, slug))) {
    slug = `${slugify(text).slice(0, 34)}-${newId().slice(0, 4)}`;
  }
  return slug;
}

const STOP = new Set(
  "a an the and or of to in on for with by from at as is are was be this that it its into over under your you we our their via using use made make built build new".split(" "),
);

export function tokens(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP.has(t)),
  );
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

export function textFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(jsx?|mjs|css|json|md|glsl)$/.test(entry)) out.push(full);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

export function run(cmd, cmdArgs, { cwd = ROOT, env = process.env, input, timeoutMs = 20 * 60 * 1000, stream = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (d) => {
      stdout += d;
      if (stream) process.stdout.write(d);
    });
    child.stderr.on("data", (d) => {
      stderr += d;
      if (stream) process.stderr.write(d);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(error) });
    });
    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

export async function claude({
  prompt,
  systemPrompt,
  model = MODELS.build,
  maxTurns = 30,
  budgetUsd = 2,
  tools,
  allowedTools,
  permissionMode,
  bare = false,
  effort,
  jsonSchema,
  settings,
  resume,
  cwd = ROOT,
  env = {},
  timeoutMs,
}) {
  const cli = ["-p", "--output-format", "json", "--model", model, "--max-turns", String(maxTurns), "--max-budget-usd", String(budgetUsd)];
  if (resume) cli.push("--resume", resume);
  if (bare) cli.push("--bare");
  if (systemPrompt) cli.push("--append-system-prompt", systemPrompt);
  if (tools !== undefined) cli.push("--tools", tools);
  if (allowedTools) cli.push("--allowedTools", allowedTools);
  if (permissionMode) cli.push("--permission-mode", permissionMode);
  if (effort) cli.push("--effort", effort);
  if (jsonSchema) cli.push("--json-schema", JSON.stringify(jsonSchema));
  if (settings) cli.push("--settings", JSON.stringify(settings));
  const { code, stdout, stderr } = await run("claude", cli, { cwd, env: { ...process.env, ...env }, input: prompt, timeoutMs });
  const parsed = parseResultJson(stdout);
  return {
    code,
    ok: code === 0 && parsed && !parsed.is_error,
    result: parsed?.result ?? stdout.trim(),
    structured: parsed?.structured_output ?? null,
    costUsd: parsed?.total_cost_usd ?? null,
    usage: usageOf(parsed),
    durationMs: parsed?.duration_ms ?? null,
    turns: parsed?.num_turns ?? null,
    sessionId: parsed?.session_id ?? null,
    stderr: stderr.trim(),
    raw: parsed ? "" : stdout.slice(0, 2000),
    reason: parsed?.terminal_reason ?? null,
  };
}

export function usageOf(parsed) {
  const u = parsed?.usage;
  if (!u) return null;
  return {
    input: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
    output: u.output_tokens || 0,
  };
}

export const fmtTokens = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n || 0));
export const fmtDuration = (ms) => (ms ? `${Math.floor(ms / 60000)}m${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}s` : "?");
export const fmtRun = (out) => `${out.turns ?? "?"} turns · ${fmtDuration(out.durationMs)} · ${fmtTokens(out.usage?.input)} in / ${fmtTokens(out.usage?.output)} out`;

export function parseResultJson(stdout) {
  const start = stdout.indexOf('{"');
  if (start === -1) return null;
  try {
    return JSON.parse(stdout.slice(start));
  } catch {
    const lines = stdout.split("\n").filter((l) => l.startsWith("{"));
    for (const line of lines.reverse()) {
      try {
        return JSON.parse(line);
      } catch {
        continue;
      }
    }
    return null;
  }
}

export function stripFences(text) {
  const match = String(text).match(/```(?:json|markdown|md)?\s*([\s\S]*?)```/);
  return (match ? match[1] : String(text)).trim();
}

export function parseJsonLoose(text) {
  const body = stripFences(text);
  try {
    return JSON.parse(body);
  } catch {
    const start = body.search(/[[{]/);
    const end = Math.max(body.lastIndexOf("]"), body.lastIndexOf("}"));
    if (start === -1 || end === -1) return null;
    try {
      return JSON.parse(body.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}
