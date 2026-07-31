// ---------------------------------------------------------------------------
// Preview offsets — the one number synced lyrics can't be computed without.
//
// Word timings from lrcmux are relative to the FULL recording. The audio we play
// is a 30s preview that starts somewhere inside it, and that somewhere is not
// published: it's absent from the iTunes Search payload, from the preview m4a's
// atoms (iTunSMPB only carries encoder delay), and from Deezer's track object.
// Measured across pairs of Apple/Deezer previews it isn't even a constant — the
// two providers disagree by anywhere from 0.1s to 11s, per track.
//
// So it has to be told to us. This map is that telling: ISRC → ms into the
// recording where the preview begins. A track in here plays fully synced for
// everyone; a track absent from it falls back to the free manual scroller, which
// is what the panel did before any of this existed. Wrong sync is worse than no
// sync, so absence stays the safe default: nothing is ever guessed into this
// map, only clicked into it.
//
// How a track gets in here: play it, click the line you can hear. In dev that
// tap is POSTed to /api/covers/lyric-offset, which rewrites the literal below —
// so the sync is a source change you commit, and production ships it synced for
// everyone. In production the same tap is kept locally (localStorage) for the
// visitor who made it, since it's their ear that confirmed it.
// ---------------------------------------------------------------------------

import { isProdView } from "@/lib/viewMode";

export const PREVIEW_OFFSETS_MS = {
  "GBAAA0001097": 44621,  // XTC — Then She Appeared
  "GBAAM0201126": 39189,  // The Police — Spirits In The Material World
  "GBAAM0201173": 60083,  // The Police — Bring On The Night
  "GBAAM0201177": 45226,  // The Police — The Bed's Too Big Without You
  "GBAKW8701068": 45403,  // The La's — Knock Me Down
  "GBAQT8800001": 43625,  // The La's — There She Goes
  "GBARL0900654": 47748,  // Lisa Mitchell — Neopolitan Dreams
  "GBUM72006890": 44229,  // The Beatles — The Long And Winding Road
  "USNO10480706": 0,  // Sam Phillips — Reflecting Light
  "USSM11900141": 48030,  // Vampire Weekend — This Life
  "USSM19902988": 47829,  // Michael Jackson, Paul McCartney — The Girl Is Mine (with Paul McCartney)
  "USUG10500591": 44918,  // Jack Johnson — Upside Down
};

const LS_KEY = "cv:lyricOffsets";

// A confirmed tap outranks the shipped map — in every environment. It can only
// ever have come from someone listening to this exact preview, which is a better
// source than anything the build could carry.
export function readOverrides() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
  } catch {
    return {};
  }
}

export function writeOverride(isrc, ms) {
  if (!isrc) return;
  try {
    const all = readOverrides();
    if (ms === null) delete all[isrc];
    else all[isrc] = Math.round(ms);
    localStorage.setItem(LS_KEY, JSON.stringify(all));
  } catch {
    /* private mode — calibration just won't persist */
  }
}

// Dev only: send a confirmed tap back to this file, so the calibration survives
// the browser it was made in and ships. Fire-and-forget — a failed write must
// never disturb playback, and the localStorage override has already taken effect
// either way.
export function publishOffset(isrc, ms, note) {
  if (isProdView() || !isrc || typeof ms !== "number") return;
  fetch("/api/covers/lyric-offset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isrc, ms: Math.round(ms), note: note || "" }),
  }).catch(() => {
    /* the override still holds locally */
  });
}

export function resolveOffset(isrc) {
  if (!isrc) return null;
  const o = readOverrides();
  if (typeof o[isrc] === "number") return o[isrc];
  return typeof PREVIEW_OFFSETS_MS[isrc] === "number" ? PREVIEW_OFFSETS_MS[isrc] : null;
}

// A starting point for calibration, so dialling a track in is a nudge rather
// than a search. Apple picks a hook, and a hook is almost always the densest
// stretch of singing — so slide a 30s window over the word timings and take the
// wordiest one. It is a GUESS, only ever used as the seed for the dev nudge.
export function guessOffsetMs(lines, previewMs = 30000) {
  const words = [];
  for (const l of lines || []) {
    for (const w of l.words || []) {
      if ((w.text || "").trim()) words.push(w.start);
    }
    if (!l.words?.length && l.start != null) words.push(l.start);
  }
  if (words.length < 4) return lines?.[0]?.start ?? 0;

  let best = words[0];
  let bestCount = 0;
  for (let i = 0; i < words.length; i++) {
    const start = words[i];
    let n = 0;
    while (i + n < words.length && words[i + n] < start + previewMs) n++;
    if (n > bestCount) {
      bestCount = n;
      best = start;
    }
  }
  // back off a beat so the window opens just before the phrase, not on top of it
  return Math.max(0, best - 1200);
}
