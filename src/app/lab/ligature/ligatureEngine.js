import { createStage, clamp } from "../_kit/stage";
import { createLigatureSound } from "./ligatureSound";

// AVANT in geometric capitals of our own drawing: straight stems, one
// diagonal slope shared by every letter, pointed apexes. Units are cap
// heights; y runs from the cap line (0) down to the baseline (1).
//
// Drawn, not constructed: the A's apex and the V's point overshoot the cap
// line and baseline (a point that stops on the line looks short), and the
// diagonals are a little lighter than the stems on the perpendicular (a
// diagonal at full stem weight reads heavier than the stem beside it).
//
// Because every diagonal has the same slope, a pair of neighbours can be
// pushed together until two strokes occupy exactly the same band. All
// strokes are filled in one path with the nonzero rule, so overlapping
// pieces are a true union: where strokes coincide there is one stroke, not
// two. The few corners a union would leave sticking out (the V's flat tops
// past the A's apexes, the A's feet past the V's point) are trimmed by the
// neighbour's outer edge, so a locked pair is a drawn ligature.
//
// Locked, the V has no legs of its own: its left leg is the first A's right
// leg and its right leg is the second A's left leg, the way Lubalin's AVANT
// is cut. What is left of the V is the notch between two A's, and A-V-A
// reads as one zigzag of three apexes and two points that runs straight on
// into the N and the T.

const INK = "#111110";
const PAPER = "#f2f0eb";

const S = 0.185; // stem
const SD = S * 0.9; // diagonal stroke, measured on the perpendicular
const HB = 0.16; // horizontal bars, a touch lighter
const D = 0.56; // the one slope: horizontal run per cap height
const O = 0.016; // overshoot of the A's apex and the V's point
const DP = D * (1 + O); // half-width of A and V at their open end
const W = SD * Math.sqrt(1 + D * D); // horizontal width of a diagonal stroke
const NW = 0.86;
const TW = 0.94;
const CB = 0.62; // A crossbar top, low enough to leave the counter open

const N_DIAG = (() => {
  let wd = SD;
  for (let i = 0; i < 8; i += 1) wd = SD * Math.sqrt(1 + (NW - wd) * (NW - wd));
  return wd;
})();

// The advance at which a diagonal of one letter lands exactly on the
// matching diagonal of its neighbour: both outer edges shift by a stroke.
const NEST = DP + D * O - W;
// Horizontal run per unit of perpendicular distance between two parallel
// diagonals: paper between diagonals is measured square to the strokes.
const K = Math.sqrt(1 + D * D);

// Spacing is one number. g is the paper between neighbours, measured at
// their closest point, shared by every pair at every moment, so the word is
// evenly tracked whether it is loose, half shut or a hair from touching. The
// squeeze only ever moves g; each pair finds its own advance from it.
const G0 = 0.22; // the open word: an ordinary, generous fit
const SHUT = 0.96; // the squeeze at which g reaches nothing
// Equal paper is not equal space, though. Two parallel diagonals enclose
// a band of paper exactly as wide as the gap, but a foot meeting a stem
// opens into a wedge above it, and the T's arm overhangs a well of paper
// below it. Those pairs read as looser than their closest point, so they
// carry less of g. The weights are by eye, and every pair still reaches
// nothing at the same moment.
const WEIGHT = { AV: 1, VA: 1, AN: 0.56, NT: 0.5 };
// Advance (left edge to left edge) at which a pair sits at the shared gap g.
const ADVANCE = {
  // AV, VA: the gap between the parallel diagonals, square to the strokes
  AV: (g) => DP + D * O + g * K,
  VA: (g) => DP + D * O + g * K,
  // AN: the A's right foot to the N's stem, at the baseline
  AN: (g) => 2 * DP + g * WEIGHT.AN,
  // NT: the N's right stem to the tip of the T's arm, at the cap line
  NT: (g) => NW + g * WEIGHT.NT,
};

const WORD = ["A", "V", "A", "N", "T"];
const WIDTH = { A: 2 * DP, V: 2 * DP, N: NW, T: TW };
// Left-edge to left-edge advance when a pair is locked.
const LOCK = {
  AV: NEST, // A's right leg and V's left leg become one band
  VA: NEST, // the V's right leg and the second A's left leg, the same
  AN: 2 * DP - S, // the A's foot leans flush into the N's stem
  NT: NW - S, // the T's arm caps the N's right stem
};
// When g reaches nothing the pairs seat one after another, right to left
// and then into the middle: the T's arm caps the N, the A leans into the
// N, the first A takes the V's left leg, and last the V's right leg falls
// into the second A, which is the fuse that makes the word one shape. One
// cascade of four settles about 50 ms apart (they land near 105, 155, 200
// and 250 ms). Each pair is released (ms after g runs out) so it lands on
// its stop in that order.
const RELEASE = { NT: 0, AN: 66, AV: 110, VA: 190 };
// A seating pair is driven a little past its stop so it lands on it with
// some speed and settles, instead of easing in and never quite arriving.
// The last fuse is driven hardest: it closes the two halves of the word on
// each other, so it lands with nearly twice the speed of the first settle.
const PRESS = { AV: 0.12, VA: 0.2, AN: 0.12, NT: 0.12 };
// The last fuse is also heard as the heaviest click.
const HEAVY = "VA";

const rect = (x0, y0, x1, y1) => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

// Each primitive: { pts, clip: [] } where clip is filled per frame.
function glyph(ch, L) {
  if (ch === "A") {
    const ax = L + DP;
    const j = W / D - O;
    const lc = (y) => ax - D * (y + O) + W / 2;
    const rc = (y) => ax + D * (y + O) - W / 2;
    return {
      leftLeg: [
        [ax, -O],
        [ax - DP, 1],
        [ax - DP + W, 1],
        [ax, j],
      ],
      rightLeg: [
        [ax, -O],
        [ax + DP, 1],
        [ax + DP - W, 1],
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
    const vx = L + DP;
    const j = 1 + O - W / D;
    return {
      leftLeg: [
        [vx - DP, 0],
        [vx - DP + W, 0],
        [vx, j],
        [vx, 1 + O],
      ],
      rightLeg: [
        [vx + DP, 0],
        [vx + DP - W, 0],
        [vx, j],
        [vx, 1 + O],
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
    return { key, advance: ADVANCE[key], lock: LOCK[key], release: RELEASE[key], press: PRESS[key], locked: false, inside: false, contact: false, lastClick: 0 };
  });
  const letters = WORD.map(() => ({ x: 0, v: 0 }));

  let t = still ?? 0; // squeeze target, 0..1 (a little below 0 stretches)
  let size = 100; // px per cap height, sprung toward fitSize()
  let sizeV = 0;
  let held = false;

  // The word is set to a measure, not a size, the way a compositor sets a
  // line to fit: its outer width is held, so as the squeeze takes paper out
  // the type grows to fill the line, and the locked ligature lands at sleeve
  // scale instead of shrinking to a mark in the middle of the paper.
  const measure = () => stage.width * (embedded ? 0.84 : 0.78);
  const outerWidth = () => letters[letters.length - 1].x - letters[0].x + WIDTH[WORD[WORD.length - 1]];
  const fitSize = () => Math.min(measure() / outerWidth(), stage.height * 0.42);

  // The shared paper gap for a squeeze: straight down from the open fit to
  // nothing, so every pair closes at the same visible rate.
  const gapAt = (squeeze) => Math.max(0, G0 * (1 - squeeze / SHUT));

  // Where each pair wants to be for a given squeeze. Once g is gone the
  // pairs seat into their locks in a quick cascade from the outside in; a
  // seated pair holds until the squeeze lets off a little.
  let shutAt = null;
  function gapsFor(squeeze, latch) {
    const g = gapAt(squeeze);
    if (latch) {
      const now = performance.now();
      if (squeeze < SHUT - 0.06) {
        shutAt = null;
        for (const p of pairs) p.locked = false;
      } else if (g <= 0) {
        if (shutAt == null) shutAt = now;
        for (const p of pairs) {
          if (still != null || now - shutAt >= p.release) p.locked = true;
        }
      }
    }
    return pairs.map((p) => (p.locked ? p.lock - (still == null ? p.press : 0) : p.advance(g)));
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

  // A resize is not a gesture: the size jumps straight to the new fit.
  stage.onResize(() => {
    size = fitSize();
    sizeV = 0;
  });

  // Input: push the word in from either end, or pinch it.
  const touches = new Map();
  let start = null;
  // The drag is measured against the line's measure, which holds still while
  // the type grows, so the gesture keeps one gain all the way to the lock.
  const span = () => measure() * 0.46;
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
      // Until it is seated a pair stops at touching: a
      // knock from a neighbour's settle cannot shove it in early. Seated, a
      // pair cannot pass through itself: contact is a stop with a little
      // give, which is the settle.
      for (let i = 0; i < pairs.length; i += 1) {
        const p = pairs[i];
        const a = letters[i];
        const b = letters[i + 1];
        const gap = b.x - a.x;
        const seat = p.advance(0);
        if (p.locked) p.inside = true;
        else if (gap >= seat) p.inside = false;
        if (!p.inside && gap < seat) {
          const fix = (seat - gap) / 2;
          a.x -= fix;
          b.x += fix;
          const vrel = b.v - a.v;
          if (vrel < 0) {
            a.v += vrel / 2;
            b.v -= vrel / 2;
          }
        } else if (gap < p.lock) {
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
              sound.lock(clamp(-vrel / 3, 0, 1), ((a.x + b.x) / 2) * size / (stage.width / 2), p.key === HEAVY);
            }
          }
          p.contact = true;
        } else if (gap > p.lock + 0.02) {
          if (p.contact && held) sound.part(0.3, ((a.x + b.x) / 2) * size / (stage.width / 2));
          p.contact = false;
        }
      }
      // The size follows the live width on its own spring, softer than the
      // letters, so the scale trails the spacing: each lock settle comes
      // through as a small step up, never as a flutter. Let go, the letters
      // spring open faster than any size could follow, so the size answers
      // more firmly on the way out, and the word never spills off the paper.
      const sk = held ? 160 : 300;
      const sc = 2 * Math.sqrt(sk) * 0.9;
      sizeV += (sk * (fitSize() - size) - sc * sizeV) * h;
      size += sizeV * h;
      const most = (stage.width * 0.94) / outerWidth();
      if (size > most) {
        size = most;
        sizeV = Math.min(sizeV, 0);
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
        const vx = R + DP;
        a.rightLeg = clipPoly(a.rightLeg, [vx + DP, 0], [vx, 1 + O], 1);
        const ax = L + DP;
        b.leftLeg = clipPoly(b.leftLeg, [ax, -O], [ax - DP, 1], -1);
      } else if (p.key === "VA") {
        // The mirror of the AV: the V's flat top is cut back to the second
        // A's apex, and the A's left foot stops at the V's point.
        const ax = R + DP;
        a.rightLeg = clipPoly(a.rightLeg, [ax, -O], [ax + DP, 1], 1);
        const vx = L + DP;
        b.leftLeg = clipPoly(b.leftLeg, [vx - DP, 0], [vx, 1 + O], -1);
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
    else size = fitSize();
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
