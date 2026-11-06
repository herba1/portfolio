import { createStage, clamp } from "../_kit/stage";
import { createLigatureSound } from "./ligatureSound";

// AVANT in geometric capitals of our own drawing: straight stems, one
// diagonal slope shared by every letter, pointed apexes. Units are cap
// heights; y runs from the cap line (0) down to the baseline (1).
//
// Because every diagonal has the same slope, a pair of neighbours can be
// pushed together until two strokes occupy exactly the same band. All
// strokes are filled in one path with the nonzero rule, so overlapping
// pieces are a true union: where strokes coincide there is one stroke, not
// two. The few corners a union would leave sticking out (the V's flat top
// past the A's apex, the A's foot past the V's point) are trimmed by the
// neighbour's outer edge, so a locked pair is a drawn ligature.

const INK = "#111110";
const PAPER = "#f2f0eb";

const S = 0.185; // stem
const HB = 0.16; // horizontal bars, a touch lighter
const D = 0.56; // half-width of A and V at the baseline: the one slope
const W = S * Math.sqrt(1 + D * D); // horizontal width of a diagonal stroke
const NW = 0.86;
const TW = 0.94;
const SB = 0.17; // loose, ordinary side bearing at rest
const CB = 0.6; // A crossbar top

const N_DIAG = (() => {
  let wd = S;
  for (let i = 0; i < 8; i += 1) wd = S * Math.sqrt(1 + (NW - wd) * (NW - wd));
  return wd;
})();

const WORD = ["A", "V", "A", "N", "T"];
const WIDTH = { A: 2 * D, V: 2 * D, N: NW, T: TW };
// Left-edge to left-edge advance when a pair is locked.
const LOCK = {
  AV: D - W, // A's right leg and V's left leg become one band
  // The V keeps one stroke of its own: against the second A it closes to a
  // hairline channel, tight but not touching, so it still reads as a V.
  VA: D + 0.045,
  AN: 2 * D - S, // the A's foot leans flush into the N's stem
  NT: NW - S, // the T's arm caps the N's right stem
};
// The order the pairs give: the NT and AN locks come early, the deep AV
// nests last (t at which each pair reaches its lock).
const AT = [0.94, 0.72, 0.5, 0.3];

const rect = (x0, y0, x1, y1) => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

// Each primitive: { pts, clip: [] } where clip is filled per frame.
function glyph(ch, L) {
  if (ch === "A") {
    const ax = L + D;
    const j = W / D;
    const lc = (y) => ax - D * y + W / 2;
    const rc = (y) => ax + D * y - W / 2;
    return {
      leftLeg: [
        [ax, 0],
        [ax - D, 1],
        [ax - D + W, 1],
        [ax, j],
      ],
      rightLeg: [
        [ax, 0],
        [ax + D, 1],
        [ax + D - W, 1],
        [ax, j],
      ],
      bar: [
        [lc(CB), CB],
        [rc(CB), CB],
        [rc(CB + HB), CB + HB],
        [lc(CB + HB), CB + HB],
      ],
    };
  }
  if (ch === "V") {
    const vx = L + D;
    const j = 1 - W / D;
    return {
      leftLeg: [
        [vx - D, 0],
        [vx - D + W, 0],
        [vx, j],
        [vx, 1],
      ],
      rightLeg: [
        [vx + D, 0],
        [vx + D - W, 0],
        [vx, j],
        [vx, 1],
      ],
    };
  }
  if (ch === "N") {
    return {
      leftStem: rect(L, 0, L + S, 1),
      rightStem: rect(L + NW - S, 0, L + NW, 1),
      diag: [
        [L, 0],
        [L + N_DIAG, 0],
        [L + NW, 1],
        [L + NW - N_DIAG, 1],
      ],
    };
  }
  const c = L + TW / 2;
  return { arm: rect(L, 0, L + TW, HB), stem: rect(c - S / 2, 0, c + S / 2, 1) };
}

// Keep the side of the line P→Q where cross(Q-P, X-P) * sign >= 0.
function clipPoly(pts, P, Q, sign) {
  const out = [];
  const ex = Q[0] - P[0];
  const ey = Q[1] - P[1];
  const side = (p) => (ex * (p[1] - P[1]) - ey * (p[0] - P[0])) * sign;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const sa = side(a);
    const sb = side(b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) {
      const k = sa / (sa - sb);
      out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]);
    }
  }
  return out;
}

const area = (pts) => {
  let s = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
};

function readStill() {
  try {
    const q = new URLSearchParams(window.location.search).get("t");
    if (q == null) return null;
    const v = parseFloat(q);
    return Number.isFinite(v) ? clamp(v, 0, 1) : null;
  } catch {
    return null;
  }
}

export function createLigature(host, { embedded = false } = {}) {
  const stage = createStage(host, { dpr: 2 });
  const { ctx, canvas } = stage;
  const sound = createLigatureSound();
  const still = readStill();

  const pairs = WORD.slice(0, -1).map((ch, i) => {
    const key = ch + WORD[i + 1];
    const rest = WIDTH[ch] + SB;
    return { key, rest, lock: LOCK[key], at: AT[i], locked: false, contact: false, lastClick: 0 };
  });
  const letters = WORD.map(() => ({ x: 0, v: 0 }));

  let t = still ?? 0; // squeeze target, 0..1 (a little below 0 stretches)
  let size = 100;
  let held = false;

  // Where each pair wants to be for a given squeeze, with a detent: a pair
  // close to its lock is pulled the rest of the way in, and once in it
  // holds until the squeeze lets off a little further.
  function gapsFor(squeeze, latch) {
    return pairs.map((p) => {
      const raw = squeeze / p.at;
      if (latch) {
        if (!p.locked && raw > 0.9) p.locked = true;
        else if (p.locked && raw < 0.8) p.locked = false;
      }
      const prog = p.locked ? 1 : clamp(raw, -0.2, 1);
      return p.rest - (p.rest - p.lock) * prog;
    });
  }

  function targets(squeeze, latch) {
    const gaps = gapsFor(squeeze, latch);
    const xs = [0];
    for (const g of gaps) xs.push(xs[xs.length - 1] + g);
    const total = xs[xs.length - 1] + WIDTH[WORD[WORD.length - 1]];
    return xs.map((x) => x - total / 2);
  }

  // Start set at rest (or at the still's squeeze).
  targets(t, true).forEach((x, i) => {
    letters[i].x = x;
  });

  stage.onResize((w, h) => {
    const restWidth = pairs.reduce((s, p) => s + p.rest, 0) + WIDTH.T;
    size = Math.min((w * (embedded ? 0.74 : 0.66)) / restWidth, h * 0.3);
  });

  // Input: push the word in from either end, or pinch it.
  const touches = new Map();
  let start = null;
  const span = () => stage.width * 0.36;
  const rubber = (v) => {
    if (v >= 0 && v <= 1) return v;
    const over = v < 0 ? -v : v - 1;
    const r = 0.14 * (1 - 1 / (over / 0.14 + 1));
    return v < 0 ? -r : 1 + r;
  };
  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const pinchDist = () => {
    const [a, b] = [...touches.values()];
    return Math.abs(a[0] - b[0]);
  };
  const onDown = (e) => {
    if (still != null) return;
    sound.start();
    touches.set(e.pointerId, local(e));
    canvas.setPointerCapture?.(e.pointerId);
    held = true;
    if (touches.size === 2) start = { pinch: pinchDist(), t };
    else if (touches.size === 1) {
      const [x] = local(e);
      start = { x, t, sign: x < stage.width / 2 ? 1 : -1 };
    }
  };
  const onMove = (e) => {
    if (!touches.has(e.pointerId) || !start) return;
    touches.set(e.pointerId, local(e));
    if (touches.size >= 2 && start.pinch != null) {
      t = rubber(start.t + (start.pinch - pinchDist()) / span());
    } else if (start.x != null) {
      const [x] = local(e);
      t = rubber(start.t + (start.sign * (x - start.x)) / span());
    }
  };
  const onUp = (e) => {
    if (!touches.has(e.pointerId)) return;
    touches.delete(e.pointerId);
    if (touches.size === 1) {
      const [p] = [...touches.values()];
      start = { x: p[0], t, sign: p[0] < stage.width / 2 ? 1 : -1 };
      return;
    }
    if (touches.size === 0) {
      held = false;
      start = null;
      t = 0;
    }
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.style.cursor = "ew-resize";

  function step(dt) {
    const goal = targets(t, true);
    // Firm and nearly critical while held; a little looser on the way back
    // open so the word breathes out.
    const k = held ? 300 : 210;
    const c = 2 * Math.sqrt(k) * (held ? 0.92 : 0.8);
    const sub = 3;
    const h = dt / sub;
    for (let n = 0; n < sub; n += 1) {
      for (let i = 0; i < letters.length; i += 1) {
        const l = letters[i];
        l.v += (k * (goal[i] - l.x) - c * l.v) * h;
        l.x += l.v * h;
      }
      // A locked pair cannot pass through itself: contact is a stop with a
      // little give, which is the settle.
      for (let i = 0; i < pairs.length; i += 1) {
        const p = pairs[i];
        const a = letters[i];
        const b = letters[i + 1];
        const gap = b.x - a.x;
        if (gap < p.lock) {
          const fix = (p.lock - gap) / 2;
          a.x -= fix;
          b.x += fix;
          const vrel = b.v - a.v;
          if (vrel < 0) {
            const j = (-vrel * 1.22) / 2;
            a.v -= j;
            b.v += j;
            const now = performance.now();
            if (!p.contact && now - p.lastClick > 140 && -vrel > 0.25) {
              p.lastClick = now;
              sound.lock(clamp(-vrel / 3, 0, 1), ((a.x + b.x) / 2) * size / (stage.width / 2));
            }
          }
          p.contact = true;
        } else if (gap > p.lock + 0.02) {
          if (p.contact && held) sound.part(0.3, ((a.x + b.x) / 2) * size / (stage.width / 2));
          p.contact = false;
        }
      }
    }
  }

  function draw() {
    const { width: w, height: hgt, dpr } = stage;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, w, hgt);

    const gs = letters.map((l, i) => glyph(WORD[i], l.x));
    const prims = gs.map((g) => Object.fromEntries(Object.entries(g).map(([k, pts]) => [k, pts])));

    // Trim what a union would leave poking out of a nested pair.
    for (let i = 0; i < pairs.length; i += 1) {
      const p = pairs[i];
      const L = letters[i].x;
      const R = letters[i + 1].x;
      const a = prims[i];
      const b = prims[i + 1];
      if (p.key === "AV") {
        const vx = R + D;
        a.rightLeg = clipPoly(a.rightLeg, [vx + D, 0], [vx, 1], 1);
        const ax = L + D;
        b.leftLeg = clipPoly(b.leftLeg, [ax, 0], [ax - D, 1], -1);
      } else if (p.key === "VA") {
        const ax = R + D;
        a.rightLeg = clipPoly(a.rightLeg, [ax, 0], [ax + D, 1], 1);
        const vx = L + D;
        b.leftLeg = clipPoly(b.leftLeg, [vx - D, 0], [vx, 1], -1);
      } else if (p.key === "AN") {
        a.rightLeg = clipPoly(a.rightLeg, [R + S, 0], [R + S, 1], 1);
      }
    }

    const ox = w / 2;
    const oy = Math.round(hgt / 2 - size / 2);
    ctx.beginPath();
    for (const g of prims) {
      for (const pts of Object.values(g)) {
        if (pts.length < 3) continue;
        const list = area(pts) < 0 ? [...pts].reverse() : pts;
        ctx.moveTo(ox + list[0][0] * size, oy + list[0][1] * size);
        for (let i = 1; i < list.length; i += 1) ctx.lineTo(ox + list[i][0] * size, oy + list[i][1] * size);
        ctx.closePath();
      }
    }
    ctx.fillStyle = INK;
    ctx.fill("nonzero");
  }

  stage.onFrame((dt) => {
    if (still == null) step(dt);
    draw();
  });

  return {
    destroy() {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      sound.destroy();
      stage.destroy();
    },
  };
}
