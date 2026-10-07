import LYRIC_VOICES from "@/app/covers/lib/lyricVoices.json";

import { LOOP_SECONDS, LOOP_START_SECONDS, TRACK } from "./tapeConstants";

const fingerprintOf = (lines) => `${lines.length}:${(lines[0]?.text || "").slice(0, 24)}`;

function spread(line, next) {
  const tokens = String(line.text || "").split(/\s+/).filter(Boolean);
  const start = line.start;
  const end = line.end ?? next?.start ?? start + 3000;
  const each = Math.max(120, (end - start) / Math.max(1, tokens.length));
  return tokens.map((text, i) => ({ text, start: start + i * each, end: start + (i + 1) * each }));
}

export async function fetchTapeWords(signal) {
  const query = new URLSearchParams({
    artist: TRACK.artist,
    title: TRACK.title,
    isrc: TRACK.isrc,
    duration: String(TRACK.durationSec),
  });
  const response = await fetch(`/api/spotify/lyrics?${query}`, { signal });
  if (!response.ok) return [];
  const payload = await response.json();
  const lines = Array.isArray(payload?.lines) ? payload.lines : [];
  if (!lines.length) return [];

  const voices = LYRIC_VOICES[TRACK.isrc];
  const voiced = voices && voices.fingerprint === fingerprintOf(lines) ? voices.lines || {} : {};
  const words = [];

  lines.forEach((line, lineIndex) => {
    if (typeof line.start !== "number") return;
    const note = voiced[lineIndex];
    const lineSingers = note?.singers?.length ? note.singers : ["john"];
    const tokens = line.words?.length ? line.words : spread(line, lines[lineIndex + 1]);
    tokens.forEach((word, wordIndex) => {
      const text = String(word.text || "").trim();
      if (!text || typeof word.start !== "number") return;
      const singers = note?.words?.[wordIndex]?.length ? note.words[wordIndex] : lineSingers;
      words.push({
        text,
        start: word.start / 1000,
        end: (typeof word.end === "number" ? word.end : word.start + 320) / 1000,
        line: lineIndex,
        singers: singers.join(" "),
      });
    });
  });

  return words.sort((a, b) => a.start - b.start);
}

export function clipWords(words, offset) {
  const shift = offset + LOOP_START_SECONDS;
  const clipped = [];
  for (const word of words) {
    const start = word.start - shift;
    if (start < -0.08 || start > LOOP_SECONDS - 0.2) continue;
    const from = Math.max(0, start);
    clipped.push({ ...word, start: from, end: Math.max(from + 0.14, word.end - shift) });
  }
  return clipped;
}
