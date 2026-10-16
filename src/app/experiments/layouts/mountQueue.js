"use client";

// Mounting a piece is the one expensive moment on the index: a chunk is
// parsed, a component tree commits, a shader compiles. Two of those in one
// frame is a dropped frame, so every tile waits its turn here — one mount
// per idle slot, the tile nearest the middle of the screen first.

const jobs = new Set();
let scheduled = false;

const idle =
  typeof window !== "undefined" && "requestIdleCallback" in window
    ? (fn) => window.requestIdleCallback(fn, { timeout: 120 })
    : (fn) => setTimeout(fn, 16);

function distance(job) {
  const rect = job.element.getBoundingClientRect();
  const mid = window.innerHeight / 2;
  if (rect.bottom > 0 && rect.top < window.innerHeight) return Math.abs((rect.top + rect.bottom) / 2 - mid) - 1e6;
  return Math.min(Math.abs(rect.top - mid), Math.abs(rect.bottom - mid));
}

function pump() {
  scheduled = false;
  const ready = [...jobs].filter((job) => job.ready);
  if (!ready.length) return;
  let best = ready[0];
  let bestDistance = distance(best);
  for (let i = 1; i < ready.length; i += 1) {
    const d = distance(ready[i]);
    if (d < bestDistance) {
      best = ready[i];
      bestDistance = d;
    }
  }
  jobs.delete(best);
  best.run();
  if ([...jobs].some((job) => job.ready)) schedule();
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => idle(pump));
}

export function enqueueMount(element, load, run) {
  const job = { element, ready: false, run };
  jobs.add(job);
  Promise.resolve(load()).finally(() => {
    if (!jobs.has(job)) return;
    job.ready = true;
    schedule();
  });
  return () => jobs.delete(job);
}

export function runWhenIdle(fn) {
  let cancelled = false;
  requestAnimationFrame(() =>
    idle(() => {
      if (!cancelled) fn();
    }),
  );
  return () => {
    cancelled = true;
  };
}
