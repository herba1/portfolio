import { isProdView } from "@/lib/viewMode";
import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const FILE = "src/app/covers/lib/lyricVoices.json";
const ISRC_RE = /^[A-Za-z0-9]{5,24}$/;
const ID_RE = /^[a-z0-9-]{1,24}$/;
const MAX_CAST = 12;
const MAX_LINES = 400;

function sanitizeCast(raw) {
  if (!Array.isArray(raw)) return null;
  const seen = new Set();
  const cast = [];
  for (const member of raw.slice(0, MAX_CAST)) {
    const id = String(member?.id || "").trim();
    if (!ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    cast.push({
      id,
      name: String(member?.name || id).replace(/[\r\n]+/g, " ").trim().slice(0, 40),
      color: /^#[0-9a-fA-F]{6}$/.test(member?.color || "") ? member.color : null,
    });
  }
  return cast;
}

const MAX_EXTRAS = 60;

function sanitizeSingers(raw, castIds) {
  if (!Array.isArray(raw)) return null;
  return [...new Set(raw.filter((id) => castIds.has(id)))];
}

function sanitizeExtras(raw, castIds) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const extra of raw.slice(0, MAX_EXTRAS)) {
    const from = Number(extra?.from);
    const anchored = Number.isInteger(from) && from >= 0 && from < 600;
    const start = Number(extra?.start);
    if (!anchored && (!Number.isFinite(start) || start < 0)) continue;
    const text = String(extra?.text || "")
      .replace(/[\r\n]+/g, " ")
      .trim()
      .slice(0, 48);
    if (!text) continue;
    const to = Number(extra?.to);
    const end = Number(extra?.end);
    const row = {
      id: String(extra?.id || "").slice(0, 24) || `x${out.length}`,
      text,
      singers: sanitizeSingers(extra?.singers, castIds) || [],
    };
    if (anchored) {
      row.from = from;
      row.to = Number.isInteger(to) && to >= from && to < 600 ? to : from;
    } else {
      row.start = Math.round(start);
      row.end = Math.round(Number.isFinite(end) && end > start ? end : start + 600);
    }
    out.push(row);
  }
  return out.sort((a, b) => (a.from ?? a.start ?? 0) - (b.from ?? b.start ?? 0));
}

function sanitizeSecondary(raw, castIds) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const seg of raw.slice(0, 400)) {
    const start = Number(seg?.start);
    const end = Number(seg?.end);
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(end) || end <= start) continue;
    const text = String(seg?.text || "")
      .replace(/[\r\n]+/g, " ")
      .trim()
      .slice(0, 48);
    out.push({
      id: String(seg?.id || "").slice(0, 32) || `s${out.length}`,
      singer: castIds.has(seg?.singer) ? seg.singer : null,
      text,
      start: Math.round(start),
      end: Math.round(end),
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

function sanitizeLines(raw, castIds) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  for (const [key, note] of Object.entries(raw).slice(0, MAX_LINES)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= MAX_LINES) continue;

    const singers = sanitizeSingers(note?.singers, castIds) || [];
    const words = {};
    for (const [wordKey, at] of Object.entries(note?.words || {}).slice(0, 600)) {
      const wordIndex = Number(wordKey);
      if (!Number.isInteger(wordIndex) || wordIndex < 0 || wordIndex >= 600) continue;
      const cleaned = sanitizeSingers(at, castIds);
      if (cleaned) words[wordIndex] = cleaned;
    }
    const extras = sanitizeExtras(note?.extras, castIds);

    const entry = {};
    if (singers.length) entry.singers = singers;
    if (Object.keys(words).length) entry.words = words;
    if (extras.length) entry.extras = extras;
    if (Object.keys(entry).length) out[index] = entry;
  }
  return out;
}

export async function POST(request) {
  if (isProdView()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { isrc, entry } = body || {};
  if (typeof isrc !== "string" || !ISRC_RE.test(isrc)) {
    return NextResponse.json({ error: "Invalid isrc" }, { status: 400 });
  }

  const filePath = path.join(process.cwd(), FILE);
  let all = {};
  try {
    all = JSON.parse(await fs.readFile(filePath, "utf-8")) || {};
  } catch {
    all = {};
  }

  if (entry === null) {
    delete all[isrc];
  } else {
    const cast = sanitizeCast(entry?.cast);
    if (!cast) return NextResponse.json({ error: "Invalid cast" }, { status: 400 });
    const lines = sanitizeLines(entry?.lines, new Set(cast.map((m) => m.id)));
    if (!lines) return NextResponse.json({ error: "Invalid lines" }, { status: 400 });
    all[isrc] = {
      title: String(entry?.title || "").replace(/[\r\n]+/g, " ").trim().slice(0, 120),
      fingerprint: String(entry?.fingerprint || "").slice(0, 64) || null,
      cast,
      lines,
      secondary: sanitizeSecondary(entry?.secondary, new Set(cast.map((m) => m.id))),
    };
  }

  const sorted = Object.fromEntries(Object.entries(all).sort(([a], [b]) => a.localeCompare(b)));
  await fs.writeFile(filePath, `${JSON.stringify(sorted, null, 2)}\n`, "utf-8");

  return NextResponse.json({ isrc, count: Object.keys(sorted).length });
}
