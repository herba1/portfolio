// ---------------------------------------------------------------------------
// Pulls the owner's most-played Spotify tracks (via /api/spotify/recent) and
// maps them into the cover shape the grid + player use, including rank.
// Returns null if Spotify isn't configured / reachable → grid uses placeholders.
// ---------------------------------------------------------------------------

import { COUNT } from "./config";

const TINTS = [
  "#E9A89A", "#9CB6C4", "#B6C4A6", "#E5C29A", "#C2A9C6", "#EBD79A",
  "#A6AFD2", "#E0AEB9", "#A2C6B4", "#D6A78D", "#AEC2D6", "#BCA9D2",
];

// Spotify track names carry version cruft — "- Remastered 2009", "(2011 Remaster)",
// "- Deluxe Edition". Strip it so the grid shows the plain song name, and so the
// lyrics / preview lookups (which search by title) match more often. Only the
// clearly-redundant tags go; real variants like "Radio Edit", "Live", "Extended
// Mix" or a remix credit stay, since those are different recordings.
const NOISE =
  /^(?:(?:\d{4}\s+)?(?:digital(?:ly)?\s+)?re-?master(?:ed)?(?:\s+version)?(?:\s+\d{4})?|(?:mono|stereo|single|album)\s+version|(?:deluxe|expanded|remastered)\s+(?:edition|version)|\d+(?:st|nd|rd|th)\s+anniversary\s+(?:edition|remaster(?:ed)?|mix)|bonus\s+track)$/i;

export function cleanTitle(raw = "") {
  let out = String(raw);

  // (Remastered 2011) / [2011 Remaster]
  out = out.replace(/\s*[([]([^)\]]*)[)\]]/g, (m, inner) =>
    NOISE.test(inner.trim()) ? "" : m,
  );

  // trailing " - Remastered 2009" / " – 2009 Remaster", possibly stacked
  let prev;
  do {
    prev = out;
    out = out.replace(/\s*[-–—]\s*([^-–—]+)$/, (m, tail) =>
      NOISE.test(tail.trim()) ? "" : m,
    );
  } while (out !== prev);

  return out.trim() || String(raw);
}

export async function fetchSpotifyCovers() {
  try {
    const res = await fetch("/api/spotify/recent");
    if (!res.ok) return null;
    const { tracks, mode } = await res.json();
    if (!tracks?.length) return null;
    const label = mode === "top" ? "most played" : "recently played";

    return Array.from({ length: COUNT }, (_, i) => {
      const idx = i % tracks.length;
      const tr = tracks[idx];
      const tint = TINTS[i % TINTS.length];
      return {
        index: i,
        title: cleanTitle(tr.title),
        sub: tr.artist,
        artistImage: tr.artistImage || null,
        type: "track",
        hasAudio: true,
        color: tint,
        color2: tint,
        image: tr.image,
        imageLarge: tr.imageLarge || tr.image,
        url: tr.url,
        rank: idx + 1,
        rankLabel: label,
        duration: 200,
        // carried through for the lyrics lookup — see /api/spotify/lyrics
        isrc: tr.isrc || null,
        durationSec: tr.durationMs ? Math.round(tr.durationMs / 1000) : null,
      };
    });
  } catch {
    return null;
  }
}
