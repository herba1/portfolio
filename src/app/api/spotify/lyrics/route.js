// GET /api/spotify/lyrics?artist=…&title=…&isrc=…&duration=…
//
// Lyrics for a track, best source first, degrading instead of failing:
//   1. lrcmux by ISRC        — the EXACT recording, plus word-level timing when
//                              the aggregator has it (Musixmatch/KuGou/NetEase)
//   2. lrcmux by artist+title — same aggregator, fuzzy match, for the rare track
//                              Spotify hands us without an ISRC
//   3. lrclib by artist+title — the original source, kept as the floor
//
// ISRC matching is what makes this worth doing: fuzzy artist+title chokes on the
// version cruft Spotify ships ("- Remastered 2009", "- 2022 Mix") and on anything
// obscure. Measured over the owner's real top 50, artist+title found lyrics for
// 15 tracks; ISRC found all 50, two-thirds of them word-synced.
//
// Returns { plain, lines, level, source }. `plain` is always filled in when we
// have anything at all, so callers that only render text need no changes; `lines`
// carries [{ text, start, end, words }] in ms when a timed source answered.

const UA = { "User-Agent": "herb.art covers (https://herb.art)" };
const TIMEOUT = 6000;

async function json(url) {
  try {
    const r = await fetch(url, {
      headers: UA,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT),
    });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

// lrcmux → our shape. Timed lines only count if they actually carry timestamps;
// the aggregator will happily return a plain-text provider under the same schema.
function fromMux(d) {
  if (!d?.lines?.length) return null;
  const lines = d.lines.map((l) => ({
    text: (l.text || "").trim(),
    start: typeof l.start === "number" ? l.start : null,
    end: typeof l.end === "number" ? l.end : null,
    words: l.words?.length
      ? l.words.map((w) => ({ text: w.text, start: w.start, end: w.end }))
      : null,
  }));
  const plain = lines.map((l) => l.text).join("\n").trim() || null;
  if (!plain) return null;
  // Derive the level from the payload rather than trusting meta.level, which
  // reports "none" for untimed providers — a value callers would have to special-
  // case. What we hand back is always one of word | line | plain.
  const timed = lines.some((l) => l.start !== null);
  const level = lines.some((l) => l.words) ? "word" : timed ? "line" : "plain";
  return {
    plain,
    lines: timed ? lines : null,
    level,
    source: d.meta?.source?.id || "lrcmux",
  };
}

// lrclib → our shape. It hands back LRC text, so pull the [mm:ss.xx] tags into
// real timestamps and let each line run until the next one starts.
function fromLrclib(d) {
  if (!d) return null;
  const lrc = d.syncedLyrics;
  if (lrc) {
    const lines = [];
    for (const raw of lrc.split("\n")) {
      const m = raw.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
      if (!m) continue;
      lines.push({
        text: m[3].trim(),
        start: Math.round((Number(m[1]) * 60 + Number(m[2])) * 1000),
        end: null,
        words: null,
      });
    }
    for (let i = 0; i < lines.length - 1; i++) lines[i].end = lines[i + 1].start;
    if (lines.length) {
      return {
        plain: lines.map((l) => l.text).join("\n").trim() || null,
        lines,
        level: "line",
        source: "lrclib",
      };
    }
  }
  const plain = (d.plainLyrics || "").trim();
  return plain ? { plain, lines: null, level: "plain", source: "lrclib" } : null;
}

// Some community sources (NetEase, KuGou) store whole songs in caps — 3 of the
// owner's top 50 come back shouting. Only fold a track that is caps end to end,
// so a deliberately-shouted line inside a normal lyric keeps its emphasis.
const SHOUTING = (s) => {
  const letters = (s.match(/[A-Za-z]/g) || []).length;
  return letters >= 4 && (s.match(/[A-Z]/g) || []).length / letters > 0.8;
};

function unshout(res) {
  const texts = (res.lines || res.plain.split("\n").map((t) => ({ text: t })))
    .map((l) => l.text)
    .filter((t) => t.trim());
  if (texts.length < 2) return res;
  if (texts.filter(SHOUTING).length / texts.length <= 0.8) return res;

  // \b sits either side of a lone "i", and an apostrophe is a word boundary too,
  // so this lifts "i" and "i'm" alike without touching words that contain an i.
  const soften = (t) => t.toLowerCase().replace(/\bi\b/g, "I");
  const openUpper = (t) => t.replace(/(\p{L})/u, (c) => c.toUpperCase());

  const lines = res.lines?.map((l) => {
    let opened = false;
    const words = l.words?.map((w) => {
      let t = soften(w.text);
      if (!opened && /\p{L}/u.test(t)) {
        t = openUpper(t);
        opened = true;
      }
      return { ...w, text: t };
    });
    return { ...l, text: openUpper(soften(l.text)), words: words || null };
  });

  return {
    ...res,
    lines: lines || null,
    plain: (lines ? lines.map((l) => l.text) : res.plain.split("\n").map((t) => openUpper(soften(t))))
      .join("\n")
      .trim(),
  };
}

export async function GET(request) {
  const url = new URL(request.url);
  const artist = (url.searchParams.get("artist") || "").trim();
  const title = (url.searchParams.get("title") || "").trim();
  const isrc = (url.searchParams.get("isrc") || "").trim();
  const duration = (url.searchParams.get("duration") || "").trim();

  const empty = { plain: null, lines: null, level: null, source: null };
  if (!title && !isrc) return Response.json(empty);

  const cached = { "Cache-Control": "public, max-age=86400" };

  // 1 — exact recording
  if (isrc) {
    const hit = fromMux(
      await json(
        `https://api.lrcmux.dev/get?${new URLSearchParams({
          isrc,
          level: "word",
          ...(duration ? { duration } : {}),
        })}`,
      ),
    );
    if (hit) return Response.json(unshout(hit), { headers: cached });
  }

  if (!title) return Response.json(empty);

  // 2 — same aggregator, fuzzy
  const fuzzy = fromMux(
    await json(
      `https://api.lrcmux.dev/get?${new URLSearchParams({
        artist,
        title,
        level: "word",
        ...(duration ? { duration } : {}),
      })}`,
    ),
  );
  if (fuzzy) return Response.json(unshout(fuzzy), { headers: cached });

  // 3 — the floor we shipped on
  const base = fromLrclib(
    await json(
      `https://lrclib.net/api/get?${new URLSearchParams({
        artist_name: artist,
        track_name: title,
        ...(duration ? { duration } : {}),
      })}`,
    ),
  );
  if (base) return Response.json(unshout(base), { headers: cached });

  return Response.json(empty);
}
