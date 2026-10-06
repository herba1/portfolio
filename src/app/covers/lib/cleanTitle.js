// Spotify track names carry version cruft — "- Remastered 2009", "(2011 Remaster)",
// "- Deluxe Edition", "- Ultimate Mix". Strip it so the grid shows the plain song
// name, and so the lyrics / preview lookups (which search by title) match more
// often. Any trailing mix/remix credit goes too — the grid wants the song title,
// not the pressing.
const NOISE = new RegExp(
  "^(?:" +
    [
      // 2009 Remaster / Digitally Remastered / Remastered Version 2011
      "(?:\\d{4}\\s+)?(?:digital(?:ly)?\\s+)?re-?master(?:ed)?(?:\\s+version)?(?:\\s+\\d{4})?",
      // Mono Version / Single Version
      "(?:mono|stereo|single|album)\\s+version",
      // Deluxe Edition / Expanded Version
      "(?:deluxe|expanded|remastered)\\s+(?:edition|version)",
      // 50th Anniversary Edition
      "\\d+(?:st|nd|rd|th)\\s+anniversary\\s+(?:edition|remaster(?:ed)?|mix)",
      "bonus\\s+track",
      // anything ending in a mix credit: Ultimate Mix, 2019 Mix, Extended Mix,
      // Original Mix, Radio Mix, Steve Aoki Remix, Remix, Mix
      "(?:.*\\s)?(?:re-?)?mix(?:es|ed)?(?:\\s+\\d{4})?",
    ].join("|") +
    ")$",
  "i",
);

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
