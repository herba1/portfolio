import { isProdView } from "@/lib/viewMode";
import LYRIC_VOICES from "./lyricVoices.json";

export { LYRIC_VOICES };

const LS_KEY = "cv:lyricVoices";

export function fingerprint(lines) {
  if (!lines?.length) return null;
  return `${lines.length}:${(lines[0].text || "").slice(0, 24)}`;
}

export function readVoiceOverrides() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
  } catch {
    return {};
  }
}

export function writeVoiceOverride(isrc, entry) {
  if (!isrc) return;
  try {
    const all = readVoiceOverrides();
    if (entry === null) delete all[isrc];
    else all[isrc] = entry;
    localStorage.setItem(LS_KEY, JSON.stringify(all));
  } catch {
    return;
  }
}

export function resolveVoices(isrc) {
  if (!isrc) return null;
  if (typeof window !== "undefined") {
    const local = readVoiceOverrides()[isrc];
    if (local) return local;
  }
  return LYRIC_VOICES[isrc] || null;
}

export function publishVoices(isrc, entry) {
  if (isProdView() || !isrc || !entry) return;
  fetch("/api/covers/lyric-voices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isrc, entry }),
  }).catch(() => {});
}

function toExtras(note) {
  if (Array.isArray(note.extras)) return note.extras;
  return (note.adlibs || []).map((lib, i) => ({
    id: lib.id || `x${i}`,
    text: lib.text || "",
    start: lib.at ?? 0,
    end: (lib.at ?? 0) + (lib.dur ?? 600),
    singers: lib.singers || [],
  }));
}

export function migrateNote(note) {
  if (!note) return null;
  if (Array.isArray(note.singers)) {
    return Array.isArray(note.extras) ? note : { ...note, extras: toExtras(note) };
  }

  if (note.voices) {
    const words = {};
    for (const [index, at] of Object.entries(note.words || {})) words[index] = Object.keys(at);
    return { singers: Object.keys(note.voices), words, extras: toExtras(note) };
  }

  const words = {};
  for (const index of note.bg || []) if (note.agent) words[index] = [note.agent];
  return { singers: note.agent ? [note.agent] : [], words, extras: [] };
}

export function migrateEntry(entry, timedLines) {
  if (!entry?.lines) return entry;
  const lines = {};
  const secondary = [...(entry.secondary || [])];

  for (const [key, note] of Object.entries(entry.lines)) {
    const next = migrateNote(note);
    if (!next) continue;
    for (const extra of next.extras || []) {
      const resolved = resolveExtra(extra, timedLines?.[Number(key)]?.words);
      const people = extra.singers?.length ? extra.singers : [null];
      for (const singer of people) {
        secondary.push({
          id: `${extra.id}-${singer || "any"}`,
          singer,
          text: extra.text || "",
          start: resolved.start,
          end: resolved.end,
        });
      }
    }
    delete next.extras;
    if (next.singers.length || Object.keys(next.words).length) lines[key] = next;
  }

  return { ...entry, lines, secondary: secondary.sort((a, b) => a.start - b.start) };
}

export function singersAt(note, wordIndex) {
  if (!note) return [];
  if (wordIndex == null) return note.singers || [];
  const override = note.words?.[String(wordIndex)] ?? note.words?.[wordIndex];
  return override ?? note.singers ?? [];
}

export function resolveExtra(extra, words) {
  const from = Number.isInteger(extra.from) ? extra.from : null;
  const to = Number.isInteger(extra.to) ? extra.to : from;
  if (words?.length && from != null && words[from]) {
    const tail = words[Math.min(to, words.length - 1)] || words[from];
    return {
      ...extra,
      from,
      to,
      start: words[from].start,
      end: tail.end ?? tail.start + 400,
    };
  }
  return { ...extra, start: extra.start ?? 0, end: extra.end ?? (extra.start ?? 0) + 800 };
}

export function annotateLines(lines, entry) {
  if (!lines?.length || !entry?.lines) return lines;
  if (entry.fingerprint && entry.fingerprint !== fingerprint(lines)) return lines;

  return lines.map((line, i) => {
    const note = entry.lines[i];
    if (!note) return line;
    return {
      ...line,
      singers: note.singers || [],
      words:
        line.words?.map((w, wi) => ({
          ...w,
          singers: singersAt(note, wi),
          overridden: (note.words?.[String(wi)] ?? note.words?.[wi]) !== undefined,
        })) || null,
    };
  });
}

export function castMap(entry) {
  const out = {};
  for (const member of entry?.cast || []) out[member.id] = member;
  return out;
}
