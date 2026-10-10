const PLEASE_PLEASE_ME = [
  ["I Saw Her Standing There", 175],
  ["Misery", 109],
  ["Anna (Go to Him)", 177],
  ["Chains", 145],
  ["Boys", 146],
  ["Ask Me Why", 147],
  ["Please Please Me", 120],
  ["Love Me Do", 142],
  ["P.S. I Love You", 124],
  ["Baby It’s You", 160],
  ["Do You Want to Know a Secret", 119],
  ["A Taste of Honey", 123],
  ["There’s a Place", 111],
  ["Twist and Shout", 153],
];

export const MAX_TRACKS = 40;

const SPOTIFY_COVER_300 = "ab67616d00001e02";
const SPOTIFY_COVER_64 = "ab67616d00004851";
const FIELD_GAP = "  ";
const STRIP_GAP = 6;
const MIN_TRACKS = 3;
const ELLIPSIS = "…";
const DRAWABLE = /[ -~ -ɏ‘’“”–—…]/;
const VERSION_SUFFIX = /\s+[-–]\s+.*\b(remaster(ed)?|version|edit|mix|live|mono|stereo|demo|session|take)\b.*$/i;
const FEATURE_NOTE = /\s*[([](feat\.?|ft\.?|with|from)\b[^)\]]*[)\]]/gi;

function drawable(text) {
  return Array.from(String(text ?? "").normalize("NFC"))
    .filter((character) => DRAWABLE.test(character))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTitle(title) {
  return drawable(String(title ?? "").replace(VERSION_SUFFIX, "").replace(FEATURE_NOTE, ""));
}

function coverThumb(url) {
  if (!url || !url.includes(SPOTIFY_COVER_300)) return url ?? null;
  return url.replace(SPOTIFY_COVER_300, SPOTIFY_COVER_64);
}

function clock(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function tracksFrom(recent) {
  const real = (recent ?? [])
    .slice(0, MAX_TRACKS)
    .filter((track) => track?.title && track.artist)
    .map((track) => ({
      title: cleanTitle(track.title),
      artist: drawable(track.artist),
      time: clock((track.durationMs ?? 0) / 1000),
      image: coverThumb(track.image),
      imageFallback: track.image ?? null,
    }))
    .filter((track) => track.title && track.artist);
  if (real.length >= MIN_TRACKS) return real;
  return PLEASE_PLEASE_ME.map(([title, seconds]) => ({ title, artist: "The Beatles", time: clock(seconds), image: null, imageFallback: null }));
}

function number(index) {
  return String(index + 1).padStart(2, "0");
}

function fieldsOf(track, index) {
  const fields = [`${number(index)} ${track.title}`, track.artist];
  if (track.time) fields.push(track.time);
  return fields;
}

function widthOf(fields) {
  return fields.reduce((sum, field) => sum + field.length, 0) + FIELD_GAP.length * (fields.length - 1);
}

function shorten(text, length) {
  if (text.length <= length) return text;
  if (length <= 1) return text.slice(0, Math.max(0, length));
  return `${text.slice(0, length - 1).trimEnd()}${ELLIPSIS}`;
}

function fit(fields, cols) {
  let fitted = fields.slice();
  if (widthOf(fitted) <= cols) return fitted;
  const titleRoom = cols - (widthOf(fitted) - fitted[0].length);
  if (titleRoom >= 8) {
    fitted[0] = shorten(fitted[0], titleRoom);
    return fitted;
  }
  fitted[0] = shorten(fitted[0], Math.max(8, Math.floor(cols * 0.55)));
  const artistRoom = cols - (widthOf(fitted) - fitted[1].length);
  if (artistRoom >= 4) {
    fitted[1] = shorten(fitted[1], artistRoom);
    return fitted;
  }
  fitted = [shorten(fitted[0], cols)];
  return fitted;
}

export function layoutStrips(tracks, cols, rows) {
  const strips = [];
  let cursor = 0;
  for (let row = 0; row < rows; row += 1) {
    const entries = [];
    let length = 0;
    while (length <= cols) {
      const index = cursor % tracks.length;
      const text = fit(fieldsOf(tracks[index], index), cols).join(FIELD_GAP);
      entries.push({ text, index, start: length });
      length += text.length + STRIP_GAP;
      cursor += 1;
    }
    strips.push({ entries, length });
  }
  const width = strips.reduce((widest, strip) => Math.max(widest, strip.length), 1);
  const owners = new Int16Array(width * rows).fill(-1);
  const lines = [];
  const lengths = strips.map((strip) => strip.length);
  const lead = Math.floor(STRIP_GAP / 2);
  strips.forEach(({ entries, length }, row) => {
    lines.push(entries.map((entry) => entry.text + " ".repeat(STRIP_GAP)).join(""));
    for (const { text, index, start } of entries) {
      for (let cell = start - lead; cell < start + text.length + STRIP_GAP - lead; cell += 1) {
        owners[row * width + (((cell % length) + length) % length)] = index;
      }
    }
  });
  return { lines, owners, lengths, width };
}

export function glyphsOf(lines) {
  const seen = new Set();
  for (const line of lines) for (const character of line) if (character !== " ") seen.add(character);
  return Array.from(seen).sort();
}

export function entryLabel(track, index) {
  return [`${number(index)} ${track.title}`, track.artist, track.time].filter(Boolean).join(", ");
}
