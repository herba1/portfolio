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
        title: tr.title,
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
      };
    });
  } catch {
    return null;
  }
}
