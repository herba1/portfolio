const THREAD_TOKEN = "--red-600";
const THREAD_FALLBACK = "#dc2626";
const THREAD_DEEPEN = 0.14;
const THREAD_WIDTH = 2;

export const THREAD_SWATCH = `color-mix(in srgb, var(${THREAD_TOKEN}, ${THREAD_FALLBACK}) ${Math.round((1 - THREAD_DEEPEN) * 100)}%, var(--color-ink, #1a1a1a))`;

export function readToken(element, property, fallback) {
  const value = getComputedStyle(element).getPropertyValue(property).trim();
  return value || fallback;
}

export function colorChannels(color) {
  const probe = document.createElement("canvas");
  probe.width = 1;
  probe.height = 1;
  const context = probe.getContext("2d", { willReadFrequently: true });
  context.fillStyle = "#000";
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const data = context.getImageData(0, 0, 1, 1).data;
  return [data[0], data[1], data[2]];
}

export function resolveThread(element) {
  const channels = colorChannels(readToken(element, THREAD_TOKEN, THREAD_FALLBACK));
  const ink = colorChannels(readToken(element, "--color-ink", "#1a1a1a"));
  const rgb = channels.map((channel, index) => Math.round(channel + (ink[index] - channel) * THREAD_DEEPEN));
  return { rgb, weight: THREAD_WIDTH };
}
