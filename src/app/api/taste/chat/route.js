import { execFile } from "child_process";
import { NextResponse } from "next/server";

import { isProdView } from "@/lib/viewMode";
import {
  NOTES_FILE,
  appendJsonl,
  currentTasteVersion,
  pointsFor,
  readManifest,
  readNotes,
  readTasteSkill,
  readVotes,
  rewriteJsonl,
  sanitizeNote,
} from "@/lib/taste/store";

export const maxDuration = 180;

const CHAT_MODEL = process.env.TASTE_CHAT_MODEL || "claude-sonnet-5";

function runClaude(prompt, systemPrompt) {
  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      prompt,
      "--output-format",
      "json",
      "--model",
      CHAT_MODEL,
      "--max-turns",
      "1",
      "--tools",
      "",
      "--append-system-prompt",
      systemPrompt,
    ];
    execFile("claude", args, { cwd: process.cwd(), maxBuffer: 4 * 1024 * 1024, timeout: 170000 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr || error.message));
      const start = stdout.indexOf('{"');
      try {
        const parsed = JSON.parse(stdout.slice(start));
        if (parsed.is_error) return reject(new Error(String(parsed.result).slice(0, 300)));
        const u = parsed.usage || {};
        resolve({
          text: parsed.result || "",
          usage: { input: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), output: u.output_tokens || 0 },
          durationMs: parsed.duration_ms || null,
        });
      } catch {
        resolve({ text: stdout.trim(), usage: null, durationMs: null });
      }
    });
  });
}

function digest(votes, notes, manifest) {
  const verdicts = votes.filter((v) => v.kind === "verdict" && !v.undone).slice(-40);
  const points = votes.filter((v) => v.kind === "point" && !v.undone).slice(-30);
  const lines = [];
  lines.push("Recent verdicts (slug · verdict · reasons):");
  for (const v of verdicts) lines.push(`- ${v.slug} · ${v.verdict}${v.reasons?.length ? " · " + v.reasons.join(", ") : ""}`);
  lines.push("", "Recent pointed elements (slug · love/hate · element · note):");
  for (const p of points) {
    const c = p.point?.computed || {};
    lines.push(
      `- ${p.slug} · ${p.verdict} · <${p.point?.tag}> ${p.point?.selector} · ${c.fontSize || ""} ${c.fontWeight || ""} ${c.color || ""} ${c.backgroundColor || ""}${p.note ? " · " + p.note : ""}`,
    );
  }
  lines.push("", "Recent notes from Herb (and earlier replies):");
  for (const n of notes.slice(-12)) {
    lines.push(`- ${n.slug ? "[" + n.slug + "] " : ""}${n.text}`);
    if (n.reply) lines.push(`  reply: ${n.reply}`);
  }
  if (manifest) {
    lines.push("", "Current candidate on screen:");
    lines.push(JSON.stringify(manifest, null, 2));
    const own = pointsFor(votes, manifest.slug);
    if (own.length) lines.push(`Pointed elements on this one: ${own.length}`);
  }
  return lines.join("\n");
}

export async function POST(request) {
  if (isProdView()) return NextResponse.json({ error: "Not available" }, { status: 403 });
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const note = sanitizeNote(body);
  if (!note) return NextResponse.json({ error: "Empty message" }, { status: 400 });
  note.tasteVersion = await currentTasteVersion();
  note.chat = true;
  await appendJsonl(NOTES_FILE, note);

  const [votes, notes, skill] = await Promise.all([readVotes(), readNotes(), readTasteSkill()]);
  const manifest = note.slug ? await readManifest(note.slug) : null;

  const systemPrompt = [
    "You are the taste agent for herb.art's experiment lab. Herb votes on generated UI experiments; you keep his taste profile and build the next batch.",
    "Answer Herb directly, under 120 words, plain sentences, no headings, no bullet lists, no flattery. If he states a preference, confirm you have it and say how it changes the next batch.",
    "Finish with exactly one line in the form `TASTE NOTE: <one sentence rule worth remembering>` or `TASTE NOTE: none` if nothing new was said about taste.",
    "",
    "Current taste skill:",
    skill || "(no taste skill yet)",
  ].join("\n");

  const prompt = `${digest(votes, notes.slice(0, -1), manifest)}\n\nHerb says: ${note.text}`;

  let reply;
  let usage = null;
  let durationMs = null;
  try {
    const out = await runClaude(prompt, systemPrompt);
    reply = out.text;
    usage = out.usage;
    durationMs = out.durationMs;
  } catch (error) {
    return NextResponse.json({ ok: false, note, error: String(error.message || error).slice(0, 500) }, { status: 502 });
  }

  const match = reply.match(/TASTE NOTE:\s*(.+)$/m);
  const distilled = match && !/^none\.?$/i.test(match[1].trim()) ? match[1].trim() : null;
  const visible = reply.replace(/\n?TASTE NOTE:.*$/m, "").trim();

  const all = await readNotes();
  await rewriteJsonl(
    NOTES_FILE,
    all.map((n) => (n.id === note.id ? { ...n, reply: visible, distilled, usage, durationMs } : n)),
  );

  return NextResponse.json({ ok: true, note: { ...note, reply: visible, distilled }, usage, durationMs });
}
