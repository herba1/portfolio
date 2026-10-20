import { FORMS, WORDS } from "./dictionary";
import { SONGS } from "./songs";

const TOKEN = /[A-Za-z]+(?:'[A-Za-z]+)?/g;

function tokenize(song) {
  const lines = [];
  const words = [];
  song.verses.forEach((verse, verseIndex) => {
    verse.forEach((text) => {
      const parts = [];
      let last = 0;
      const lineIndex = lines.length;
      for (const match of text.matchAll(TOKEN)) {
        if (match.index > last) parts.push({ sep: text.slice(last, match.index) });
        const norm = match[0].toLowerCase();
        const lemma = FORMS[norm]?.[0] ?? norm;
        parts.push({ i: words.length });
        words.push({ text: match[0], norm, lemma, lineIndex });
        last = match.index + match[0].length;
      }
      if (last < text.length) parts.push({ sep: text.slice(last) });
      lines.push({ verseIndex, parts, text });
    });
  });
  return { ...song, lines, words };
}

export const SONG_DATA = SONGS.map(tokenize);
export const SONG_BY_ID = Object.fromEntries(SONG_DATA.map((song) => [song.id, song]));

export function firstIndexOf(songId, lemma) {
  const song = SONG_BY_ID[songId];
  return Math.max(0, song.words.findIndex((word) => word.lemma === lemma));
}

export function entryFor(songId, index) {
  const song = SONG_BY_ID[songId];
  const word = song.words[index];
  if (!word) return null;
  const form = FORMS[word.norm];
  const [ipa, pos, definition] = WORDS[word.lemma] ?? WORDS[word.norm] ?? ["", "word", "No entry yet."];
  const headword = word.norm === "i'll" ? "I'll" : word.norm;
  const note = form && form[1] ? `${form[1][0].toUpperCase()}${form[1].slice(1)}` : null;
  const count = song.words.filter((w) => w.lemma === word.lemma).length;
  const also = [];
  for (const other of SONG_DATA) {
    if (other.id === songId) continue;
    const at = other.words.findIndex((w) => w.lemma === word.lemma);
    if (at < 0) continue;
    const line = other.lines[other.words[at].lineIndex];
    also.push({ songId: other.id, title: other.title, track: other.track, index: at, line });
  }
  return { headword, lemma: word.lemma, ipa, pos, definition, note, count, also, songTitle: song.title };
}
