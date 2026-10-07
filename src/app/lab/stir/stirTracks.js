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

const FIELD_GAP = "  ";
const ENTRY_GAP = 4;
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

function clock(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function tracksFrom(recent) {
  const real = (recent ?? [])
    .filter((track) => track?.title && track.artist)
    .map((track) => ({
      title: cleanTitle(track.title),
      artist: drawable(track.artist),
      time: clock((track.durationMs ?? 0) / 1000),
    }))
    .filter((track) => track.title && track.artist);
  if (real.length >= MIN_TRACKS) return real;
  return PLEASE_PLEASE_ME.map(([title, seconds]) => ({ title, artist: "The Beatles", time: clock(seconds) }));
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

function justify(parts, cols) {
  if (parts.length === 1) return parts[0].padEnd(cols, " ").slice(0, cols);
  const used = parts.reduce((sum, part) => sum + part.length, 0);
  const gaps = parts.length - 1;
  const spare = Math.max(gaps, cols - used);
  const base = Math.floor(spare / gaps);
  const extra = spare % gaps;
  let line = parts[0];
  for (let index = 1; index < parts.length; index += 1) {
    line += " ".repeat(base + (index <= extra ? 1 : 0)) + parts[index];
  }
  return line.padEnd(cols, " ").slice(0, cols);
}

export function layoutWall(tracks, cols, rows) {
  const lines = [];
  let cursor = 0;
  for (let row = 0; row < rows; row += 1) {
    const picked = [];
    let used = 0;
    for (;;) {
      const index = cursor % tracks.length;
      const fields = fit(fieldsOf(tracks[index], index), cols);
      const length = widthOf(fields);
      const needed = picked.length ? used + ENTRY_GAP + length : length;
      if (picked.length && needed > cols) break;
      picked.push(fields);
      used = needed;
      cursor += 1;
      if (used >= cols) break;
    }
    lines.push(picked.length === 1 ? justify(picked[0], cols) : justify(picked.map((fields) => fields.join(FIELD_GAP)), cols));
  }
  return lines;
}

export function glyphsOf(lines) {
  const seen = new Set();
  for (const line of lines) for (const character of line) if (character !== " ") seen.add(character);
  return Array.from(seen).sort();
}

export function entryLabel(track, index) {
  return [`${number(index)} ${track.title}`, track.artist, track.time].filter(Boolean).join(", ");
}
