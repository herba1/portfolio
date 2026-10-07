export const QUEUE_LENGTH = 10;

function hashString(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function formatDuration(durationMs) {
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function beadFill(hue) {
  return `oklch(0.86 0.06 ${hue})`;
}

function monogram(artist) {
  const words = String(artist || "")
    .replace(/^the\s+/i, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (!words.length) return "";
  if (words.length === 1) {
    const [first = "", second = ""] = Array.from(words[0]);
    return first.toUpperCase() + second.toLowerCase();
  }
  return (Array.from(words[0])[0] + Array.from(words[1])[0]).toUpperCase();
}

export function buildQueue(covers, length = QUEUE_LENGTH) {
  return (covers ?? []).slice(0, length).map((cover, index) => {
    const seed = hashString(`${cover.id}:${cover.title}:${index}`);
    const durationMs = cover.durationMs || 150000 + (seed % 140000);
    return {
      id: `${index}-${String(cover.id).replace(/[^a-zA-Z0-9_-]/g, "")}`,
      title: cover.title || "Untitled",
      artist: cover.artist || "Unknown artist",
      image: cover.image || null,
      monogram: monogram(cover.artist),
      durationMs,
      duration: formatDuration(durationMs),
      fill: beadFill(seed % 360),
    };
  });
}

export function totalMinutes(tracks) {
  let total = 0;
  for (const track of tracks) total += track.durationMs;
  return Math.round(total / 60000);
}
