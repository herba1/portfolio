// Dev-only: the write end of click-to-sync.
//
// Clicking the lyric line you can hear produces the one number synced lyrics
// can't be computed from (see covers/lib/lyricOffsets.js). Kept only in the
// browser, that number dies with the tab it was made in. So in dev the tap is
// posted here and rewritten into the PREVIEW_OFFSETS_MS literal in source —
// making the calibration a normal file change to review and commit, after which
// production serves that track synced for everyone.
//
// Rewriting the literal rather than appending to a JSON sidecar keeps the map
// readable and diffable, and keeps a track's offset next to the essay
// explaining why it has to exist at all.
import { isProdView } from "@/lib/viewMode";
import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const FILE = "src/app/covers/lib/lyricOffsets.js";
const ISRC_RE = /^[A-Za-z0-9]{5,24}$/;
const BLOCK_RE = /export const PREVIEW_OFFSETS_MS = \{[\s\S]*?\n\};/;
const ENTRY_RE = /^"([^"]+)"\s*:\s*(-?\d+)\s*,?\s*(?:\/\/\s*(.*))?$/;

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

  const { isrc, ms } = body || {};
  if (typeof isrc !== "string" || !ISRC_RE.test(isrc)) {
    return NextResponse.json({ error: "Invalid isrc" }, { status: 400 });
  }
  if (!Number.isFinite(ms) || ms < 0 || ms > 60 * 60 * 1000) {
    return NextResponse.json({ error: "Invalid offset" }, { status: 400 });
  }
  // The note is a comment in source, so it can't be allowed to close one.
  const note = String(body.note || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\*\//g, " ")
    .trim()
    .slice(0, 80);

  const filePath = path.join(process.cwd(), FILE);
  const src = await fs.readFile(filePath, "utf-8");
  const block = src.match(BLOCK_RE);
  if (!block) {
    return NextResponse.json({ error: "PREVIEW_OFFSETS_MS not found" }, { status: 500 });
  }

  // Read what's already there rather than blindly appending, so re-calibrating a
  // track replaces its line instead of leaving two entries for the same ISRC
  // (the second of which would silently win).
  const entries = new Map();
  for (const raw of block[0].split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("//") || line.startsWith("export") || line === "};") continue;
    const m = line.match(ENTRY_RE);
    if (m) entries.set(m[1], { ms: Number(m[2]), note: (m[3] || "").trim() });
  }
  entries.set(isrc, { ms: Math.round(ms), note });

  const rows = [...entries.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `  "${k}": ${v.ms},${v.note ? `  // ${v.note}` : ""}`)
    .join("\n");

  // Function form: an artist name carrying a `$` would otherwise be read as a
  // replacement pattern rather than as text.
  const next = src.replace(
    BLOCK_RE,
    () => `export const PREVIEW_OFFSETS_MS = {\n${rows}\n};`,
  );
  await fs.writeFile(filePath, next, "utf-8");

  return NextResponse.json({ isrc, ms: Math.round(ms), count: entries.size });
}
