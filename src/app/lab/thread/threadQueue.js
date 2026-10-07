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
  return [
    `radial-gradient(circle at 32% 28%`,
    `oklch(0.9 0.05 ${hue}) 0%`,
    `oklch(0.84 0.07 ${hue}) 22%`,
    `oklch(0.77 0.09 ${hue}) 46%`,
    `oklch(0.71 0.1 ${hue}) 70%`,
    `oklch(0.67 0.11 ${hue}) 88%`,
    `oklch(0.65 0.11 ${hue}) 100%)`,
  ].join(", ");
}

export function buildQueue(covers, length = QUEUE_LENGTH) {
  return (covers ?? []).slice(0, length).map((cover, index) => {
    const seed = hashString(`${cover.id}:${cover.title}:${index}`);
    const durationMs = cover.durationMs || 150000 + (seed % 140000);
    return {
      id: `${index}-${String(cover.id).replace(/[^a-zA-Z0-9_-]/g, "")}`,
      title: cover.title || "Untitled",
      artist: cover.artist || "Unknown artist",
      image: cover.image,
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
