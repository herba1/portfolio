// A stand-in for the iTunes search API, built from the site's own Beatles
// catalogue, for recording pieces whose search can't reach the internet.
import { ALBUMS } from "../../../src/app/lab/_music/catalog.js";
export const itunesMock = {
  url: /\/api\/itunes\/search/,
  json: (u) => {
    const q = (new URL(u).searchParams.get("q") || "").toLowerCase();
    const all = ALBUMS.flatMap((a) => a.tracks.map((t, i) => ({
      id: `${a.id}-${i}`, title: t, artist: a.artist, album: a.title,
      thumb: a.cover, artwork: a.cover, preview: "",
    })));
    const hits = all.filter((t) => t.title.toLowerCase().includes(q) || t.album.toLowerCase().includes(q));
    return { tracks: (hits.length ? hits : all).slice(0, 8) };
  },
};
