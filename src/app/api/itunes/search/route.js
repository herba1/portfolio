const MAX_QUERY = 64;
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 400;
const WINDOW_MS = 60 * 1000;
const WINDOW_MAX = 30;
const BUCKETS_MAX = 5000;
const UPSTREAM_TIMEOUT_MS = 4000;
const CACHE_HEADER = "public, max-age=3600, s-maxage=604800, stale-while-revalidate=604800";

const cache = new Map();
const buckets = new Map();
const inflight = new Map();

function normalize(raw) {
  return raw.trim().replace(/\s+/g, " ").slice(0, MAX_QUERY).toLowerCase();
}

function clientKey(request) {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  return forwarded.split(",")[0].trim() || request.headers.get("x-real-ip") || "anonymous";
}

function overLimit(key, now) {
  if (buckets.size > BUCKETS_MAX) {
    for (const [id, hits] of buckets) {
      if (!hits.length || now - hits[hits.length - 1] > WINDOW_MS) buckets.delete(id);
    }
  }
  const hits = (buckets.get(key) || []).filter((at) => now - at < WINDOW_MS);
  if (hits.length >= WINDOW_MAX) {
    buckets.set(key, hits);
    return Math.ceil((WINDOW_MS - (now - hits[0])) / 1000);
  }
  hits.push(now);
  buckets.set(key, hits);
  return 0;
}

function readCache(query, now) {
  const hit = cache.get(query);
  if (!hit) return null;
  if (now - hit.at > CACHE_TTL_MS) {
    cache.delete(query);
    return null;
  }
  cache.delete(query);
  cache.set(query, hit);
  return hit.tracks;
}

function writeCache(query, tracks, now) {
  cache.set(query, { tracks, at: now });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

function shape(results) {
  const seen = new Set();
  const tracks = [];
  for (const result of results) {
    if (!result.previewUrl || !result.artworkUrl100) continue;
    const key = `${result.artistName}::${result.trackName}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tracks.push({
      id: result.trackId,
      title: result.trackName,
      artist: result.artistName,
      album: result.collectionName || "",
      thumb: result.artworkUrl100,
      artwork: result.artworkUrl100.replace("100x100bb", "600x600bb"),
      preview: result.previewUrl,
    });
  }
  return tracks;
}

async function lookup(query) {
  const pending = inflight.get(query);
  if (pending) return pending;

  const task = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const response = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=20`,
        { signal: controller.signal, cache: "no-store" },
      );
      if (!response.ok) return null;
      const data = await response.json();
      return shape(data.results || []);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      inflight.delete(query);
    }
  })();

  inflight.set(query, task);
  return task;
}

export async function GET(request) {
  const query = normalize(new URL(request.url).searchParams.get("q") || "");
  if (query.length < 2) return Response.json({ tracks: [] });

  const now = Date.now();
  const cached = readCache(query, now);
  if (cached) {
    return Response.json(
      { tracks: cached },
      { headers: { "Cache-Control": CACHE_HEADER, "X-Cache": "hit" } },
    );
  }

  const retryAfter = overLimit(clientKey(request), now);
  if (retryAfter) {
    return Response.json(
      { tracks: [], error: "rate_limited" },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" },
      },
    );
  }

  const tracks = await lookup(query);
  if (!tracks) {
    return Response.json(
      { tracks: [], error: "upstream" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  writeCache(query, tracks, now);
  return Response.json(
    { tracks },
    { headers: { "Cache-Control": CACHE_HEADER, "X-Cache": "miss" } },
  );
}
