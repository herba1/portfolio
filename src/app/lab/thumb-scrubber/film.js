export const FPS = 24;

const RAW = [
  { id: "beams", src: "/scorch/beams.webp", title: "Floodlights", dur: 9, from: [1.1, -3, 1], to: [1.22, 3, -1] },
  { id: "clock", src: "/scorch/clock.webp", title: "The clock face", dur: 8, from: [1.24, 0, 4], to: [1.12, 0, -2] },
  { id: "meadow", src: "/scorch/meadow.webp", title: "Meadow", dur: 11, from: [1.08, 3, 0], to: [1.16, -3, 2] },
  { id: "reading", src: "/scorch/reading.webp", title: "Morning paper", dur: 10, from: [1.1, 0, -2], to: [1.26, 1, 3] },
  { id: "valley", src: "/scorch/valley.webp", title: "The valley", dur: 12, from: [1.2, -4, 2], to: [1.1, 2, -1] },
  { id: "visitor", src: "/scorch/visitor.webp", title: "The visitor", dur: 13, from: [1.12, 0, 3], to: [1.3, 0, -3] },
  { id: "wires", src: "/scorch/wires.webp", title: "Wires at dusk", dur: 9, from: [1.18, 4, 0], to: [1.08, -2, 1] },
];

let cursor = 0;
export const SHOTS = RAW.map((shot) => {
  const start = cursor;
  cursor += shot.dur;
  return { ...shot, start };
});

export const TOTAL = cursor;

export function shotIndexAt(t) {
  for (let i = SHOTS.length - 1; i >= 0; i -= 1) if (t >= SHOTS[i].start) return i;
  return 0;
}

export function frameTransform(index, t, still = false) {
  const shot = SHOTS[index];
  const p = still ? 0.5 : Math.min(1, Math.max(0, (t - shot.start) / shot.dur));
  const s = shot.from[0] + (shot.to[0] - shot.from[0]) * p;
  const x = shot.from[1] + (shot.to[1] - shot.from[1]) * p;
  const y = shot.from[2] + (shot.to[2] - shot.from[2]) * p;
  return `translate3d(${x.toFixed(3)}%, ${y.toFixed(3)}%, 0) scale(${s.toFixed(4)})`;
}

const pad = (n) => String(n).padStart(2, "0");

export function frameOf(t) {
  return Math.min(Math.floor(t * FPS + 1e-6), Math.round(TOTAL * FPS));
}

export function timecode(t) {
  const frames = frameOf(t);
  const ff = frames % FPS;
  const whole = Math.floor(frames / FPS);
  return `${pad(Math.floor(whole / 60))}:${pad(whole % 60)}:${pad(ff)}`;
}

export function spokenTime(t) {
  const whole = Math.floor(t);
  return `${Math.floor(whole / 60)} minutes ${whole % 60} seconds, ${SHOTS[shotIndexAt(t)].title}`;
}
