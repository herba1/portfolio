import { createHash } from "node:crypto";

export const lyricTexts = (plain) =>
  String(plain || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

export const lyricsHash = (texts) =>
  createHash("sha1").update(texts.join("\n")).digest("hex").slice(0, 12);

const tokenize = (text) => text.split(/(\s+)/).filter(Boolean);
const isSpace = (token) => /^\s+$/.test(token);

export function packLine(text, aligned) {
  if (!aligned || aligned.start == null || aligned.end == null) return null;
  const spoken = text.split(/\s+/).filter(Boolean);
  const timed = aligned.words || [];
  const wordsUsable =
    timed.length === spoken.length && timed.every((w) => w.start != null && w.end != null);
  return [
    Math.round(aligned.start),
    Math.round(aligned.end),
    wordsUsable ? timed.map((w) => [Math.round(w.start), Math.round(w.end)]) : null,
  ];
}

export function unpackLines(texts, packed) {
  const lines = [];
  texts.forEach((text, i) => {
    const entry = packed[i];
    if (!entry) {
      lines.push({ text, start: null, end: null, words: null });
      return;
    }
    const [start, end, wordTimes] = entry;
    let spokenIndex = 0;
    const words = wordTimes
      ? tokenize(text).map((token) => {
          if (isSpace(token)) return { text: token, start, end: start };
          const [wordStart, wordEnd] = wordTimes[spokenIndex++];
          return { text: token, start: wordStart, end: wordEnd };
        })
      : null;
    lines.push({ text, start, end, words });
  });
  return lines;
}

export function previewSyncedLyrics(entry, plain) {
  if (!entry) return null;
  const texts = lyricTexts(plain);
  if (lyricsHash(texts) !== entry.hash) return null;
  const lines = unpackLines(texts, entry.lines);
  if (!lines.some((line) => line.start !== null)) return null;
  return {
    plain: lines.map((line) => line.text).join("\n"),
    lines,
    level: lines.some((line) => line.words) ? "word" : "line",
    source: "words",
    previewSynced: true,
  };
}

const wordSet = (text) =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9'\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean),
  );

const similarity = (a, b) => {
  const left = wordSet(a);
  const right = wordSet(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return shared / Math.max(left.size, right.size);
};

const MATCH_FLOOR = 0.4;
const SKIP_ALLOWANCE = 3;

export function locateWindow(texts, heard) {
  let best = null;
  for (let start = 0; start < texts.length; start++) {
    let cursor = start;
    let score = 0;
    let first = null;
    let last = null;
    for (const spoken of heard) {
      let pick = -1;
      let pickScore = 0;
      for (let i = cursor; i < Math.min(texts.length, cursor + SKIP_ALLOWANCE + 1); i++) {
        const s = similarity(spoken, texts[i]);
        if (s > pickScore) {
          pickScore = s;
          pick = i;
        }
      }
      if (pick !== -1 && pickScore >= MATCH_FLOOR) {
        score += pickScore;
        cursor = pick + 1;
        if (first === null) first = pick;
        last = pick;
      }
    }
    if (first !== null && (!best || score > best.score)) best = { score, first, last };
  }
  return best && best.score >= 1 ? best : null;
}
