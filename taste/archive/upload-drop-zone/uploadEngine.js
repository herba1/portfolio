export const TICK_MS = 90;
export const FAILURE_RATE = 0.22;

const FAILURE_REASONS = [
  "Connection reset",
  "Server timed out",
  "Upload interrupted",
];

export function speedMsForFile(file) {
  const sizeFactor = Math.min(file.size / 4_000_000, 1);
  return 1100 + sizeFactor * 2600;
}

export function tickProgress(progress, speedMs) {
  const wobble = 0.55 + Math.random() * 0.9;
  const step = (TICK_MS / speedMs) * 100 * wobble;
  return Math.min(100, progress + step);
}

export function randomFailureReason() {
  return FAILURE_REASONS[Math.floor(Math.random() * FAILURE_REASONS.length)];
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function kindForFile(file) {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type === "application/pdf" || file.type.startsWith("text/")) return "document";
  return "file";
}
