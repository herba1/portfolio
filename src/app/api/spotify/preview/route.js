// GET /api/spotify/preview?artist=…&title=… — resolves the best-matching 30s
// preview via the iTunes Search API, SCORED against the requested artist+title
// so we never hand back the wrong song.
//
// It returns the URL as JSON rather than the audio, and that is the whole point.
// Apple's preview CDN answers with `access-control-allow-origin: *`, an moov
// atom at the front of the file, `accept-ranges: bytes` and a year-long
// max-age — so the browser can stream the media itself, start playing off a
// prefix, and cache it. Proxying it meant ~1MB travelling twice (Apple → us →
// client) with nothing audible until the last byte of it landed. This response
// is a few hundred bytes and caches at the edge.
//
// ?stream=1 keeps the old proxy behaviour as a fallback, for the case where
// direct playback fails on the client (see the engine's error path).

function norm(s) {
  return (s || "")
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(
      /\b(remaster(ed)?|deluxe|expanded|anniversary|mono|stereo|live|version|edit|single|album|feat\.?|featuring|original)\b/g,
      " ",
    )
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scoreParts(reqArtist, reqTitle, r) {
  const a = norm(r.artistName);
  const t = norm(r.trackName);
  const ra = norm(reqArtist);
  const rt = norm(reqTitle);

  let ts;
  if (t === rt) ts = 5;
  else if (rt && (t.includes(rt) || rt.includes(t))) ts = 3.5;
  else {
    const set = new Set(t.split(" "));
    const words = rt.split(" ").filter(Boolean);
    ts = 4 * (words.filter((w) => set.has(w)).length / Math.max(1, words.length));
  }

  let as;
  if (a === ra) as = 4;
  else if (ra && (a.includes(ra) || ra.includes(a))) as = 2.5;
  else {
    const set = new Set(a.split(" "));
    const words = ra.split(" ").filter(Boolean);
    as = 2 * (words.filter((w) => set.has(w)).length / Math.max(1, words.length));
  }

  return { ts, as, total: ts + as };
}

// The lookup is worth caching hard and the audio is worth caching harder: a
// track's preview URL does not change, and neither does the search result for
// the same artist+title. stale-while-revalidate keeps a slow iTunes day from
// being the user's problem.
const CACHE = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";

export async function GET(request) {
  const url = new URL(request.url);
  const artist = (url.searchParams.get("artist") || "").trim();
  const title = (url.searchParams.get("title") || "").trim();
  const stream = url.searchParams.get("stream") === "1";
  if (!title) return new Response("missing title", { status: 400 });

  try {
    const term = encodeURIComponent(`${artist} ${title}`.trim());
    const lookup = await fetch(
      `https://itunes.apple.com/search?term=${term}&media=music&entity=song&limit=15`,
      { cache: "no-store" },
    );
    if (!lookup.ok) return new Response("lookup failed", { status: 502 });
    const data = await lookup.json();

    const scored = (data.results || [])
      .filter((r) => r.previewUrl)
      .map((r) => ({ r, ...scoreParts(artist, title, r) }))
      .sort((x, y) => y.total - x.total);

    // require both a decent title AND artist match, else bail (no wrong song)
    const best = scored.find((s) => s.ts >= 2.5 && s.as >= 1.5);
    if (!best) return new Response("no confident match", { status: 404 });

    // The normal path: hand back the address and let the browser do the rest.
    if (!stream) {
      return Response.json(
        {
          url: best.r.previewUrl,
          artist: best.r.artistName,
          title: best.r.trackName,
        },
        { headers: { "Cache-Control": CACHE } },
      );
    }

    const audio = await fetch(best.r.previewUrl, { cache: "no-store" });
    if (!audio.ok || !audio.body) return new Response("preview fetch failed", { status: 502 });
    const headers = {
      "Content-Type": audio.headers.get("content-type") || "audio/m4a",
      "Cache-Control": CACHE,
    };
    // Pass the size through. The bytes are piped byte-for-byte, so upstream's
    // count is still correct — and without it the client has no denominator,
    // which is the difference between a preview that loads to "62%" on a slow
    // connection and one that shows an indefinite spinner. Audio is already
    // compressed, so nothing downstream re-encodes it and invalidates this.
    const len = audio.headers.get("content-length");
    if (len) headers["Content-Length"] = len;
    return new Response(audio.body, { headers });
  } catch {
    return new Response("error", { status: 500 });
  }
}
