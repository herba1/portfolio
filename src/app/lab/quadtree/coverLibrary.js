import { buildSource } from "./quadTree";

const KEEP = 2;

export function createCoverLibrary() {
  const cache = new Map();
  let idleHandle = 0;

  const get = (src) => {
    const hit = cache.get(src);
    if (hit) {
      cache.delete(src);
      cache.set(src, hit);
      return hit;
    }
    const pending = buildSource(src);
    pending.catch(() => cache.delete(src));
    cache.set(src, pending);
    while (cache.size > KEEP) cache.delete(cache.keys().next().value);
    return pending;
  };

  const prefetch = (src) => {
    if (!src || cache.has(src) || typeof window === "undefined") return;
    const run = () => {
      idleHandle = 0;
      get(src).catch(() => {});
    };
    if (typeof window.requestIdleCallback === "function") idleHandle = window.requestIdleCallback(run, { timeout: 1200 });
    else idleHandle = window.setTimeout(run, 240);
  };

  const dispose = () => {
    if (idleHandle && typeof window !== "undefined") {
      if (typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idleHandle);
      else window.clearTimeout(idleHandle);
    }
    cache.clear();
  };

  return { get, prefetch, dispose };
}
