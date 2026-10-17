import { INK_RES, SLOT_COLS, SLOT_ROWS, SLOTS } from "./letterpressType";

const W = INK_RES * SLOT_COLS;
const H = INK_RES * SLOT_ROWS;
export const INK_MAX = 1.5;

function hash(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function smooth(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function createInk() {
  const thickness = Array.from({ length: SLOTS }, () => new Float32Array(INK_RES * INK_RES));
  const masks = Array.from({ length: SLOTS }, () => new Float32Array(INK_RES * INK_RES));
  const bytes = new Uint8Array(W * H);
  const dirty = new Set();

  function setMask(slot, low) {
    masks[slot].set(low);
    thickness[slot].fill(0);
    dirty.add(slot);
  }

  function clear(slot) {
    thickness[slot].fill(0);
    dirty.add(slot);
  }

  function prime(slot, amount, seed) {
    const t = thickness[slot];
    const m = masks[slot];
    for (let y = 0; y < INK_RES; y += 1) {
      for (let x = 0; x < INK_RES; x += 1) {
        const i = y * INK_RES + x;
        if (m[i] < 0.02) continue;
        const wobble = 0.82 + 0.3 * hash(x >> 2, y >> 3, seed) + 0.08 * hash(x, y, seed + 3);
        t[i] = Math.min(INK_MAX, amount * wobble);
      }
    }
    dirty.add(slot);
  }

  function roll(slot, sa, sb, va, vb, gain, patch, seed) {
    const t = thickness[slot];
    const m = masks[slot];
    const x0 = Math.max(0, Math.ceil(sa * INK_RES - 0.5));
    const x1 = Math.min(INK_RES - 1, Math.ceil(sb * INK_RES - 0.5) - 1);
    const y0 = Math.max(0, Math.ceil(va * INK_RES - 0.5));
    const y1 = Math.min(INK_RES - 1, Math.floor(vb * INK_RES - 0.5));
    if (x1 < x0 || y1 < y0) return 0;
    let touched = 0;
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const i = y * INK_RES + x;
        if (m[i] < 0.04) continue;
        const now = t[i];
        const n = 0.55 * hash(x >> 1, y >> 2, seed) + 0.45 * hash(x, y, seed + 11);
        const gate = smooth(patch - 0.2, patch + 0.2, n + now * 0.9);
        const room = Math.max(0, 1 - now / INK_MAX);
        t[i] = Math.min(INK_MAX, now + gain * gate * room * (0.8 + 0.4 * n));
        touched += 1;
      }
    }
    if (touched) dirty.add(slot);
    return touched;
  }

  function lift(slot, fraction) {
    const t = thickness[slot];
    for (let i = 0; i < t.length; i += 1) t[i] *= 1 - fraction * (0.75 + 0.5 * hash(i, slot, 91));
    dirty.add(slot);
  }

  function coverage(slots) {
    let sum = 0;
    let area = 0;
    for (const slot of slots) {
      const t = thickness[slot];
      const m = masks[slot];
      for (let i = 0; i < t.length; i += 1) {
        if (m[i] < 0.3) continue;
        area += 1;
        sum += Math.min(1, t[i]);
      }
    }
    return area ? sum / area : 0;
  }

  function flush() {
    if (!dirty.size) return false;
    for (const slot of dirty) {
      const ox = (slot % SLOT_COLS) * INK_RES;
      const oy = Math.floor(slot / SLOT_COLS) * INK_RES;
      const t = thickness[slot];
      for (let y = 0; y < INK_RES; y += 1) {
        for (let x = 0; x < INK_RES; x += 1) {
          bytes[(oy + y) * W + ox + x] = Math.round((Math.min(INK_MAX, t[y * INK_RES + x]) / INK_MAX) * 255);
        }
      }
    }
    dirty.clear();
    return true;
  }

  return { bytes, width: W, height: H, setMask, clear, prime, roll, lift, coverage, flush };
}
