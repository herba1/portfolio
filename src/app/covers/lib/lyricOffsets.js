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
// sync, so absence is the safe default and the calibration below never ships a
// guess to visitors.
// ---------------------------------------------------------------------------

export const PREVIEW_OFFSETS_MS = {
  // "GBAYE9200070": 61200,
};

const LS_KEY = "cv:lyricOffsets";

// Dev-only overrides live in localStorage so calibrating a track doesn't need a
// rebuild. Never consulted in production — visitors only ever see the map above.
export function readOverrides() {
  if (process.env.NODE_ENV === "production") return {};
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
  } catch {
    return {};
  }
}

export function writeOverride(isrc, ms) {
  if (process.env.NODE_ENV === "production" || !isrc) return;
  try {
    const all = readOverrides();
    if (ms === null) delete all[isrc];
    else all[isrc] = Math.round(ms);
    localStorage.setItem(LS_KEY, JSON.stringify(all));
  } catch {
    /* private mode — calibration just won't persist */
  }
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
