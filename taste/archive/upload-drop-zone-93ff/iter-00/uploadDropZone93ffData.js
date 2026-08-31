export const TICK_MS = 100;
export const CONCURRENCY = 2;
export const MAX_FILES = 8;

const SUNSET =
  "linear-gradient(148deg, #f7dfc4 0%, #eec295 17%, #dd9670 36%, #b96a62 57%, #7c4a67 79%, #3b3352 100%)";
const HARBOUR =
  "linear-gradient(158deg, #dfe9f0 0%, #b8cfe0 16%, #86adca 35%, #5c86ac 56%, #3c5a83 78%, #23324f 100%)";
const STAGE =
  "linear-gradient(142deg, #2a2340 0%, #46305a 18%, #7a3f63 38%, #b4595c 60%, #dc8a5f 80%, #f2c184 100%)";
const FIELD =
  "linear-gradient(152deg, #eef1e2 0%, #cfd9b4 18%, #a4b982 38%, #74965f 58%, #4a6a4a 79%, #27392f 100%)";
const NEON =
  "linear-gradient(136deg, #1d2237 0%, #2f3f66 19%, #4a6aa1 39%, #7f9ac4 59%, #c2b7d4 80%, #efd9dd 100%)";

export const SEED_FILES = [
  { name: "sleeve-front-2400.png", bytes: 4_412_000, kind: "image", duration: 3.4, preview: SUNSET, at: 1 },
  { name: "studio-loop-1080.mp4", bytes: 122_339_000, kind: "video", duration: 7.6, preview: STAGE, failAt: 0.61, at: 0.44 },
  { name: "mixdown-take-14.wav", bytes: 38_642_000, kind: "audio", duration: 6.2, at: 0.23 },
  { name: "press-notes-final.pdf", bytes: 812_000, kind: "doc", duration: 2.4 },
  { name: "contact-sheet-03.jpg", bytes: 6_118_000, kind: "image", duration: 4.1, preview: HARBOUR },
];

export const POOL = [
  { name: "sleeve-back-2400.png", bytes: 3_904_000, kind: "image", duration: 3.2, preview: FIELD },
  { name: "b-side-rough.wav", bytes: 21_447_000, kind: "audio", duration: 5.1 },
  { name: "rehearsal-cam.mp4", bytes: 64_820_000, kind: "video", duration: 6.8, preview: NEON },
  { name: "tour-dates-2027.pdf", bytes: 438_000, kind: "doc", duration: 2.1 },
  { name: "band-portrait-05.jpg", bytes: 8_712_000, kind: "image", duration: 4.4, preview: SUNSET },
];

export const megabytes = (bytes) => (bytes / 1_000_000).toFixed(1);

export const kindOf = (name) => {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  if (["png", "jpg", "jpeg", "webp", "gif", "tif", "avif"].includes(ext)) return "image";
  if (["mp4", "mov", "webm", "avi"].includes(ext)) return "video";
  if (["wav", "mp3", "aiff", "flac", "m4a"].includes(ext)) return "audio";
  return "doc";
};

const fingerprint = (text) => {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0) / 4294967295;
};

const waveformFor = (name) => {
  const seed = fingerprint(name) * 60;
  return Array.from({ length: 11 }, (_, index) => {
    const grain = Math.sin(seed + index * 1.73) * Math.sin(seed * 0.41 + index * 0.62);
    const envelope = Math.sin(((index + 0.5) / 11) * Math.PI) ** 0.55;
    return Math.round(5 + 27 * envelope * (0.42 + 0.58 * (0.5 + 0.5 * grain)));
  });
};

const rulesFor = (name) => {
  const seed = fingerprint(name) * 40;
  return Array.from({ length: 4 }, (_, index) =>
    46 + Math.round(52 * (0.5 + 0.5 * Math.sin(seed + index * 2.31))),
  );
};

export const makeFile = (spec, id, enterDelay) => {
  const at = Math.min(1, spec.at ?? 0);
  return {
    id,
    name: spec.name,
    bytes: spec.bytes,
    kind: spec.kind,
    preview: spec.preview ?? HARBOUR,
    waveform: waveformFor(spec.name),
    rules: rulesFor(spec.name),
    speed: 1 / spec.duration,
    failAt: spec.failAt ?? null,
    attempt: 0,
    status: at >= 1 ? "done" : at > 0 ? "uploading" : "queued",
    progress: at,
    ticks: id * 7,
    wait: 0,
    enterDelay,
  };
};

const dt = TICK_MS / 1000;

export function advance(files) {
  let active = files.filter((file) => file.status === "uploading").length;
  let moved = false;

  const next = files.map((file) => {
    if (file.status === "retrying") {
      moved = true;
      const wait = file.wait - 1;
      return wait <= 0 ? { ...file, status: "queued", wait: 0 } : { ...file, wait };
    }
    if (file.status === "queued" && active < CONCURRENCY) {
      active += 1;
      moved = true;
      return { ...file, status: "uploading" };
    }
    if (file.status !== "uploading") return file;

    moved = true;
    const ticks = file.ticks + 1;
    const wobble = 0.78 + 0.44 * (0.5 + 0.5 * Math.sin(ticks * 0.63 + file.id));
    const progress = file.progress + file.speed * dt * wobble;

    if (file.failAt != null && file.attempt === 0 && progress >= file.failAt) {
      return { ...file, status: "error", progress: file.failAt, ticks };
    }
    if (progress >= 1) return { ...file, status: "done", progress: 1, ticks };
    return { ...file, progress, ticks };
  });

  return moved ? next : files;
}
