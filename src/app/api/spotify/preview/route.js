// GET /api/spotify/preview?artist=…&title=… — best-matching 30s preview via the
// iTunes Search API, SCORED against the requested artist+title so we don't proxy
// the wrong song. Streamed same-origin so the client can decode it for a waveform.

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

export async function GET(request) {
  const url = new URL(request.url);
  const artist = (url.searchParams.get("artist") || "").trim();
  const title = (url.searchParams.get("title") || "").trim();
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

    const audio = await fetch(best.r.previewUrl, { cache: "no-store" });
    if (!audio.ok || !audio.body) return new Response("preview fetch failed", { status: 502 });
    return new Response(audio.body, {
      headers: {
        "Content-Type": audio.headers.get("content-type") || "audio/m4a",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new Response("error", { status: 500 });
  }
}
