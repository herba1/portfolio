import { spawn } from "child_process";
import fs from "fs/promises";
import { openSync } from "fs";
import path from "path";
import { NextResponse } from "next/server";

import { isProdView } from "@/lib/viewMode";
import { ROOT, SLUG_RE, TASTE_DIR, listManifests, readManifest, readNotes } from "@/lib/taste/store";

const RUNS_DIR = path.join(TASTE_DIR, "runs");
const LIVE_FILE = path.join(RUNS_DIR, "live.json");
const QUEUE_FILE = path.join(RUNS_DIR, "queue.json");
const LOG_FILE = path.join(RUNS_DIR, "live.log");

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8"));
  } catch {
    return fallback;
  }
}

function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function launch(job) {
  await fs.mkdir(RUNS_DIR, { recursive: true });
  await fs.writeFile(LOG_FILE, `[dashboard] ${job.label}\n`);
  const out = openSync(LOG_FILE, "a");
  const child = spawn("node", job.args, { cwd: ROOT, detached: true, stdio: ["ignore", out, out], env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
  child.unref();
  const live = { ...job, pid: child.pid, startedAt: new Date().toISOString() };
  await fs.writeFile(LIVE_FILE, JSON.stringify(live, null, 2) + "\n");
  return live;
}

async function usageToday() {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const since = dayStart.toISOString();
  const [manifests, notes] = await Promise.all([listManifests(), readNotes()]);
  const runs = [];
  for (const m of manifests) {
    if (m.generation?.finishedAt >= since && m.generation.usage) runs.push({ ...m.generation.usage, ms: m.generation.durationMs || 0 });
    for (const c of m.changelog || []) if (c.at >= since && c.usage) runs.push({ ...c.usage, ms: c.durationMs || 0 });
  }
  for (const n of notes) if (n.ts >= since && n.usage) runs.push({ ...n.usage, ms: n.durationMs || 0 });
  return {
    runs: runs.length,
    input: runs.reduce((a, r) => a + (r.input || 0), 0),
    output: runs.reduce((a, r) => a + (r.output || 0), 0),
    minutes: Math.round(runs.reduce((a, r) => a + (r.ms || 0), 0) / 60000),
  };
}

async function recentEvents() {
  const manifests = await listManifests();
  const titles = Object.fromEntries(manifests.map((m) => [m.slug, m.title]));
  const events = [];
  for (const m of manifests) {
    if (m.generation?.finishedAt) {
      const from = m.parentSlug ? ` from ${titles[m.parentSlug] || m.parentSlug}` : "";
      events.push({ at: m.generation.finishedAt, text: m.generation.ok ? `Built ${m.title}${from}` : `Build failed: ${m.title}` });
    } else if (m.createdAt) events.push({ at: m.createdAt, text: `${m.building ? "Building" : "Started"} ${m.title}` });
    for (const c of m.changelog || []) events.push({ at: c.at, text: `Rebuilt ${m.title} (iteration ${c.iteration})` });
  }
  return events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
}

async function status() {
  const live = await readJson(LIVE_FILE, null);
  let queue = await readJson(QUEUE_FILE, []);
  let running = Boolean(live && alive(live.pid));
  let current = live;
  if (!running && queue.length) {
    const [next, ...rest] = queue;
    current = await launch(next);
    queue = rest;
    await fs.writeFile(QUEUE_FILE, JSON.stringify(queue, null, 2) + "\n");
    running = true;
  }
  let log = "";
  try {
    log = await fs.readFile(LOG_FILE, "utf-8");
  } catch {
    log = "";
  }
  const building = (await listManifests()).filter((m) => m.building).map((m) => ({ slug: m.slug, title: m.title, since: m.createdAt }));
  return { running, live: current, queue: queue.map((j) => j.label), tail: log.split("\n").filter(Boolean).slice(-12), usage: await usageToday(), recent: await recentEvents(), building };
}

function jobFor(body) {
  if (body?.mode === "evolve" || body?.mode === "iterate") {
    const slug = String(body.slug || "");
    if (!SLUG_RE.test(slug)) return { error: "Unknown experiment" };
    return { mode: body.mode, slug, label: `${body.mode} ${slug}`, args: ["scripts/lab-generate.mjs", "--parallel", "1", `--${body.mode}`, slug] };
  }
  if (body?.mode === "polish") {
    const slugs = String(body.slugs || "").split(",").map((x) => x.trim()).filter((x) => SLUG_RE.test(x));
    if (!slugs.length) return { error: "No experiments" };
    return { mode: "polish", label: `polish ${slugs.join(", ")}`, args: ["scripts/lab-generate.mjs", "--parallel", "3", "--polish", slugs.join(",")] };
  }
  if (body?.mode === "briefs") {
    const ids = String(body.briefs || "").split(",").map((b) => b.trim()).filter((b) => /^[a-z0-9-]+$/.test(b));
    if (!ids.length) return { error: "No briefs" };
    return { mode: "briefs", label: `build ${ids.join(", ")}`, args: ["scripts/lab-generate.mjs", "--parallel", "3", "--briefs", ids.join(",")] };
  }
  if (body?.mode === "idea") {
    const idea = String(body.idea || "").trim().slice(0, 600);
    if (idea.length < 8) return { error: "Describe the idea in a sentence" };
    return { mode: "idea", label: `build: ${idea.slice(0, 40)}`, args: ["scripts/lab-generate.mjs", "--parallel", "1", "--idea", idea] };
  }
  const count = Math.min(6, Math.max(1, Number(body?.count) || 3));
  return { mode: "batch", label: `batch of ${count}`, args: ["scripts/lab-run.mjs", "--count", String(count), "--parallel", "2", "--no-build", ...(body?.scout ? [] : ["--no-scout"])] };
}

export async function GET() {
  if (isProdView()) return NextResponse.json({ error: "Not available" }, { status: 403 });
  return NextResponse.json(await status());
}

export async function POST(request) {
  if (isProdView()) return NextResponse.json({ error: "Not available" }, { status: 403 });
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const job = jobFor(body);
  if (job.error) return NextResponse.json({ error: job.error }, { status: 400 });
  if (job.slug && !(await readManifest(job.slug))) return NextResponse.json({ error: "Unknown experiment" }, { status: 404 });

  const current = await status();
  if (current.running) {
    const queue = await readJson(QUEUE_FILE, []);
    if (!queue.some((j) => j.label === job.label) && current.live?.label !== job.label) {
      queue.push(job);
      await fs.writeFile(QUEUE_FILE, JSON.stringify(queue, null, 2) + "\n");
    }
    return NextResponse.json({ ok: true, queued: true, ...(await status()) });
  }
  await launch(job);
  return NextResponse.json({ ok: true, queued: false, ...(await status()) });
}
