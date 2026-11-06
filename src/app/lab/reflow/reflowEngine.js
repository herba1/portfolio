import { createStage, clamp } from "../_kit/stage";
import { TITLE, VERSES } from "./reflowText";
import { hyphenateToken } from "./hyphenate";

// One enormous S, the initial of the song, sits in a column of small
// justified text. The letter is Geist itself: rasterised once from the real
// font, read back as ink spans per pixel row, and dilated by a round gutter.
// Every frame each line of the baseline grid is cut by the letter into free
// segments, and every verse is broken into those segments with Knuth–Plass
// total-fit line breaking (Liang hyphenation, hanging punctuation). The text
// is a block of columns filling the sheet between equal margins; the letter
// stands in it and runs off the foot, as on the Stedelijk posters.

const FAMILY = '"Reflow Geist", Geist, system-ui, sans-serif';
const INK = "#0a0a0a";
const PAPER = "#ffffff";

const SIZE = 12; // text px; the tracking law gives 0 at 12px
const LEAD = 16; // whole-pixel leading on the 4px grid
const CAP = 8.8; // ink band of a line above the baseline
const DESC = 2.8; // and below it
const GUTTER = 14; // round clearance between letter ink and text ink
const MIN_SEG = 84; // narrower slivers stay empty
const DEPTH = 3; // and so does any free region shallower than this many lines
const MEASURE = 360; // column width: about 56 characters of the ballad
const COL_GAP = 24;
const PASSES = 6;
// Justified lines may stretch their spaces this far (r); a line that cannot
// is set ragged, flush left, rather than loose or left out.
// The search itself looks further (EMERGENCY) so one hard line ahead does
// not stop the lines before it from finding an even set; Knuth's cubic
// badness keeps it from choosing loose lines it does not need.
const TOLERANCE = 1.3;
const FULL_TOLERANCE = 2;
const EMERGENCY = 3;
const SHORT = 0.6; // of the measure

// Knuth–Plass constants (TeX's, tightened for a narrow measure).
const STRETCH = 0.55;
const SHRINK = 0.2;
const LINE_PENALTY = 10;
const HYPHEN_PENALTY = 50;
const FLAGGED = 3000;
const FITNESS = 3000;
const INF = 1e7;

const BOX = 0;
const GLUE = 1;
const PEN = 2;

const weight = (name, fallback) => {
  const v = parseInt(getComputedStyle(document.documentElement).getPropertyValue(`--font-weight-${name}`), 10);
  return Number.isFinite(v) ? v : fallback;
};

async function loadFont() {
  try {
    const face = new FontFace("Reflow Geist", "url(/fonts/Geist-Variable.woff2)", { weight: "100 900" });
    await face.load();
    document.fonts.add(face);
  } catch {
    /* falls back to the page's Geist */
  }
  await document.fonts.ready;
}

// ---------------------------------------------------------------- letter

function rasterLetter(char, px, w) {
  const probe = document.createElement("canvas").getContext("2d");
  probe.font = `${w} ${px}px ${FAMILY}`;
  const m = probe.measureText(char);
  const left = Math.ceil(m.actualBoundingBoxLeft);
  const right = Math.ceil(m.actualBoundingBoxRight);
  const asc = Math.ceil(m.actualBoundingBoxAscent);
  const desc = Math.ceil(m.actualBoundingBoxDescent);
  const pad = 2;
  const cw = left + right + pad * 2;
  const ch = asc + desc + pad * 2;
  const c = document.createElement("canvas");
  c.width = cw;
  c.height = ch;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.font = probe.font;
  g.fillStyle = "#000";
  g.fillText(char, pad + left, pad + asc);
  const data = g.getImageData(0, 0, cw, ch).data;

  // Raw ink spans per row, then a round dilation by the gutter.
  const raw = [];
  for (let y = 0; y < ch; y += 1) {
    const runs = [];
    let start = -1;
    for (let x = 0; x <= cw; x += 1) {
      const on = x < cw && data[(y * cw + x) * 4 + 3] > 127;
      if (on && start < 0) start = x;
      else if (!on && start >= 0) {
        runs.push(start, x);
        start = -1;
      }
    }
    raw.push(runs);
  }
  const G = GUTTER;
  const rows = [];
  for (let y = -G; y < ch + G; y += 1) {
    const spans = [];
    for (let dy = -G; dy <= G; dy += 1) {
      const r = raw[y + dy];
      if (!r) continue;
      const e = Math.sqrt(G * G - dy * dy);
      for (let i = 0; i < r.length; i += 2) spans.push([r[i] - e, r[i + 1] + e]);
    }
    rows.push(mergeSpans(spans));
  }
  // The pixel origin of the bitmap relative to the glyph's ink centre.
  return {
    rows,
    rowOrigin: -G - ch / 2,
    ox: -cw / 2,
    oy: -ch / 2,
    w: cw,
    h: ch,
    drawX: pad + left - cw / 2,
    drawY: pad + asc - ch / 2,
    font: probe.font,
    hit(x, y) {
      const px = Math.floor(x + cw / 2);
      const py = Math.floor(y + ch / 2);
      if (px < 0 || py < 0 || px >= cw || py >= ch) return false;
      return data[(py * cw + px) * 4 + 3] > 40;
    },
  };
}

function mergeSpans(spans) {
  if (spans.length < 2) return spans;
  spans.sort((a, b) => a[0] - b[0]);
  const out = [spans[0].slice()];
  for (let i = 1; i < spans.length; i += 1) {
    const last = out[out.length - 1];
    if (spans[i][0] <= last[1]) last[1] = Math.max(last[1], spans[i][1]);
    else out.push(spans[i].slice());
  }
  return out;
}

// ---------------------------------------------------------------- text

function buildParagraphs(ctx, wBody, wTitle) {
  const fBody = `${wBody} ${SIZE}px ${FAMILY}`;
  const fTitle = `${wTitle} ${SIZE}px ${FAMILY}`;
  const cache = new Map();
  const measure = (s, f) => {
    const k = f + s;
    let v = cache.get(k);
    if (v === undefined) {
      ctx.font = f;
      v = ctx.measureText(s).width;
      cache.set(k, v);
    }
    return v;
  };
  const space = measure(" ", fBody);
  const hyphen = measure("-", fBody);
  const tspace = measure(" ", fTitle) * 1.2;
  const hang = (s, f) => {
    const last = s[s.length - 1];
    if (".,;:".includes(last)) return measure(last, f) * 0.9;
    if (last === "?" || last === "’") return measure(last, f) * 0.4;
    return 0;
  };

  // The whole ballad runs in as one paragraph, verse after verse, a slash
  // where the sung line would end, and the title starting each pass.
  const items = [];
  const glue = () => items.push({ t: GLUE, w: space, st: space * STRETCH, sh: space * SHRINK });
  const word = (wd, f) => {
    const parts = hyphenateToken(wd);
    parts.forEach((p, pi) => {
      const last = pi === parts.length - 1;
      items.push({ t: BOX, w: measure(p, f), s: p, f, hang: last ? hang(p, f) : 0 });
      if (!last) items.push({ t: PEN, w: hyphen, p: HYPHEN_PENALTY, flag: true, hang: hyphen });
    });
  };
  const slash = () => {
    // Never let a slash open a line.
    items.push({ t: PEN, w: 0, p: INF, flag: false, hang: 0 });
    glue();
    word("/", fBody);
    glue();
  };
  for (let c = 0; c < PASSES; c += 1) {
    if (c > 0) slash();
    TITLE.split(" ").forEach((tw) => {
      word(tw, fTitle);
      // The heavier run-in needs its own, wider word space.
      items.push({ t: GLUE, w: tspace, st: tspace * STRETCH, sh: tspace * SHRINK });
    });
    VERSES.forEach((verse, vi) => {
      if (vi > 0) slash();
      verse.split(" ").forEach((wd, wi, all) => {
        word(wd, fBody);
        if (wi < all.length - 1) glue();
      });
    });
  }
  {
    items.push({ t: PEN, w: 0, p: INF, flag: false, hang: 0 });
    items.push({ t: GLUE, w: 0, st: INF, sh: 0 });
    items.push({ t: PEN, w: 0, p: -INF, flag: true, hang: 0 });
    // Running sums for O(1) line measures.
    const n = items.length;
    const sw = new Float64Array(n + 1);
    const sst = new Float64Array(n + 1);
    const ssh = new Float64Array(n + 1);
    for (let i = 0; i < n; i += 1) {
      const it = items[i];
      sw[i + 1] = sw[i] + (it.t === PEN ? 0 : it.w);
      sst[i + 1] = sst[i] + (it.t === GLUE ? it.st : 0);
      ssh[i + 1] = ssh[i] + (it.t === GLUE ? it.sh : 0);
    }
    return [{ items, sw, sst, ssh, hyphen }];
  }
}

// Knuth–Plass over a sliding window. A full total-fit pass over a page of
// cut-up measures costs seconds (every line number stays alive), so each
// line is chosen as the first of the best WINDOW-line continuation, then
// committed. Lines well above the letter therefore never move when it does.
const WINDOW = 5;

function firstOfBest(par, from, line0, fit0, flag0, widthAt, tolerance, window = WINDOW) {
  const { items, sw, sst, ssh } = par;
  const n = items.length;
  let active = [{ pos: -1, line: 0, fit: fit0, w: sw[from], st: sst[from], sh: ssh[from], dem: 0, prev: null, flag: flag0, start: from }];
  let bestEnd = null;

  for (let i = from; i < n && active.length; i += 1) {
    const it = items[i];
    let legal = false;
    if (it.t === GLUE) legal = i > from && items[i - 1].t === BOX;
    else if (it.t === PEN) legal = it.p < INF;
    if (!legal) continue;

    const forced = it.t === PEN && it.p <= -INF;
    const cand = new Map();
    const next = [];
    for (const a of active) {
      const L = widthAt(line0 + a.line);
      const extra = it.t === PEN ? it.w : 0;
      const hangW = it.t === PEN ? it.hang : items[i - 1].hang || 0;
      const natural = sw[i] - a.w + extra - hangW;
      let r;
      if (natural < L) {
        const st = sst[i] - a.st;
        r = st > 0 ? (L - natural) / st : INF;
      } else if (natural > L) {
        const sh = ssh[i] - a.sh;
        r = sh > 0 ? (L - natural) / sh : -INF;
      } else r = 0;
      if (!(r < -1 || forced)) next.push(a);
      if (r < -1 || r > tolerance) continue;

      const bad = r >= INF ? 10000 : Math.min(10000, 100 * Math.abs(r) ** 3);
      const p = it.t === PEN ? it.p : 0;
      let d = (LINE_PENALTY + bad) ** 2;
      if (p > 0) d += p * p;
      else if (p > -INF) d -= p * p;
      if (it.t === PEN && it.flag && a.flag && !forced) d += FLAGGED;
      const fit = r < -0.5 ? 0 : r <= 0.5 ? 1 : r <= 1 ? 2 : 3;
      if (Math.abs(fit - a.fit) > 1) d += FITNESS;
      d += a.dem;
      const key = (a.line + 1) * 4 + fit;
      const best = cand.get(key);
      if (!best || d < best.dem) cand.set(key, { line: a.line + 1, fit, dem: d, prev: a, r });
    }
    active = next;
    let k = i + 1;
    while (k < n && items[k].t !== BOX && !(items[k].t === PEN && items[k].p <= -INF)) k += 1;
    for (const c of cand.values()) {
      const node = { pos: i, line: c.line, fit: c.fit, r: c.r, w: sw[k], st: sst[k], sh: ssh[k], dem: c.dem, prev: c.prev, flag: it.t === PEN && it.flag, start: k };
      // A window is complete at WINDOW lines or at the end of the text.
      if (c.line >= window || forced) {
        if (!bestEnd || node.dem < bestEnd.dem) bestEnd = node;
      } else active.push(node);
    }
  }
  if (!bestEnd) return null;
  let first = bestEnd;
  while (first.prev && first.prev.prev) first = first.prev;
  return first;
}

// ---------------------------------------------------------------- engine

export async function createReflow(host) {
  await loadFont();
  const stage = createStage(host, { dpr: 2 });
  const { ctx, canvas } = stage;
  const wBody = weight("medium", 500);
  const wTitle = weight("semibold", 600);
  const wDisplay = weight("bold", 700);
  const params = new URLSearchParams(location.search);
  const still = params.has("t") ? clamp(parseFloat(params.get("t")) || 0, 0, 1) : null;

  const debug = params.has("debug") ? { n: 0, sum: 0, max: 0 } : null;
  const pars = buildParagraphs(ctx, wBody, wTitle);
  let W = 0;
  let H = 0;
  let letter = null;
  let cols = [];
  let colW = MEASURE;
  let top = 0;
  let lines = 0;
  const pos = { x: 0, y: 0, vx: 0, vy: 0 };
  const target = { x: 0, y: 0 };
  let home = { x: 0, y: 0 };
  let grab = null;
  let dirty = true;
  let layout = [];
  let lastKey = "";

  const pathAt = (t) => {
    // The scripted sweep a still frame (?t=) holds: from home, left and
    // down into the block, as a hand would drag it.
    const a = home;
    const b = { x: cols[0].l + (cols[cols.length - 1].r - cols[0].l) * 0.5, y: H * 0.62 };
    const e = t * t * (3 - 2 * t);
    return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e + Math.sin(e * Math.PI) * H * 0.04 };
  };

  stage.onResize((w, h) => {
    W = w;
    H = h;
    const margin = w < 700 ? 24 : 48;
    const letterPx = Math.round(w < 700 ? Math.min(h * 0.9, w * 1.05) : Math.min(h * 1.3, w * 1.3));
    letter = rasterLetter("S", letterPx, wDisplay);
    // The block fills the sheet between equal margins, left and right, in
    // as many columns as fit at the measure (three on a laptop sheet, one on
    // a phone), each widened to share the leftover evenly. The letter then
    // always stands in text on both sides, never beside an empty strip.
    const avail = w - margin * 2;
    const n = Math.max(1, Math.round((avail + COL_GAP) / (MEASURE + COL_GAP)));
    const measure = (avail - (n - 1) * COL_GAP) / n;
    colW = measure;
    cols = [];
    for (let c = 0; c < n; c += 1) {
      const l = Math.round(margin + c * (measure + COL_GAP));
      cols.push({ l, r: Math.round(margin + c * (measure + COL_GAP) + measure) });
    }
    top = Math.ceil(margin / 4) * 4;
    lines = Math.floor((h - top * 2) / LEAD);
    // Home: right of centre, standing in the block with the third column
    // running past it on the right and its tail off the foot of the sheet.
    const blockL = cols[0].l;
    const blockR = cols[n - 1].r;
    home = w < 700 ? { x: w * 0.62, y: h * 0.56 } : { x: blockL + (blockR - blockL) * 0.68, y: h * 0.6 };
    const p = still == null ? home : pathAt(still);
    if (!grab) {
      pos.x = target.x = p.x;
      pos.y = target.y = p.y;
      pos.vx = pos.vy = 0;
    }
    lastKey = "";
    dirty = true;
  });

  // The letter's blocked spans per column and line, with every enclosed
  // region (a run of free spans walled by ink at both ends, joined line to
  // line where they overlap) also blocked in each column but its owner.
  function enclosedOwners(blockedAt) {
    const L = cols[0].l;
    const R = cols[cols.length - 1].r;
    const spans = []; // [li, a, b, region]
    const parent = [];
    const find = (i) => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    let prev = [];
    for (let li = 0; li < lines; li += 1) {
      const row = [];
      let x = L;
      for (const [a, b] of blockedAt[li]) {
        if (b <= x) continue;
        if (a >= R) break;
        // Walled on the left by ink (x > L) and on the right by ink (a < R).
        if (x > L && a > x) {
          const k = spans.length;
          spans.push([li, x, a]);
          parent.push(k);
          for (const j of prev) {
            if (spans[j][1] < a && spans[j][2] > x) parent[find(j)] = find(k);
          }
          row.push(k);
        }
        x = Math.max(x, b);
      }
      prev = row;
    }
    // Each region's width in each column box, summed over its lines.
    const share = new Map();
    for (let k = 0; k < spans.length; k += 1) {
      const root = find(k);
      let v = share.get(root);
      if (!v) share.set(root, (v = new Float64Array(cols.length)));
      const [, a, b] = spans[k];
      cols.forEach((c, ci) => {
        v[ci] += Math.max(0, Math.min(b, c.r) - Math.max(a, c.l));
      });
    }
    const owner = new Map();
    for (const [root, v] of share) {
      let best = 0;
      for (let ci = 1; ci < v.length; ci += 1) if (v[ci] > v[best]) best = ci;
      owner.set(root, best);
    }
    const out = cols.map(() => blockedAt.map((r) => r));
    const extra = cols.map(() => new Map());
    for (let k = 0; k < spans.length; k += 1) {
      const own = owner.get(find(k));
      const [li, a, b] = spans[k];
      for (let ci = 0; ci < cols.length; ci += 1) {
        if (ci === own || b <= cols[ci].l || a >= cols[ci].r) continue;
        let m = extra[ci].get(li);
        if (!m) extra[ci].set(li, (m = []));
        m.push([a, b]);
      }
    }
    extra.forEach((m, ci) => {
      for (const [li, add] of m) out[ci][li] = mergeSpans([...blockedAt[li].map((s) => s.slice()), ...add]);
    });
    return out;
  }

  // Free segments on each baseline of each column: the column minus the
  // dilated letter, in reading order (column, then line, then left to right).
  // A segment is kept only if it belongs to a free region at least DEPTH
  // baselines deep: some run of DEPTH consecutive lines through it whose
  // free spans share MIN_SEG of width with it. A lone line under a
  // terminal, or a two-line notch in a bay, stays white, so the letter cuts
  // a clean channel through the block instead of leaving islands.
  //
  // A counter or a bay (free space walled by the letter on both sides) is
  // owned by one column: the one whose box holds most of it. Only that
  // column runs into it; the other column's sliver of it stays white, so a
  // bowl carries one continuous run of the text, never two fragments side
  // by side across a gutter that read across in the wrong order.
  function segments() {
    const blockedAt = [];
    for (let li = 0; li < lines; li += 1) {
      const base = top + SIZE + li * LEAD;
      const y0 = Math.floor(base - CAP - pos.y - letter.rowOrigin);
      const y1 = Math.ceil(base + DESC - pos.y - letter.rowOrigin);
      const spans = [];
      for (let y = Math.max(0, y0); y <= y1 && y < letter.rows.length; y += 1) {
        for (const s of letter.rows[y]) spans.push([s[0] + letter.ox + pos.x, s[1] + letter.ox + pos.x]);
      }
      blockedAt.push(mergeSpans(spans));
    }
    const blocked = enclosedOwners(blockedAt);
    const segs = [];
    for (let ci = 0; ci < cols.length; ci += 1) {
      const c = cols[ci];
      // Every free span of this column, line by line, before any culling.
      const free = [];
      for (let li = 0; li < lines; li += 1) {
        const base = top + SIZE + li * LEAD;
        const row = [];
        let x = c.l;
        for (const [a, b] of blocked[ci][li]) {
          if (b <= x) continue;
          if (a >= c.r) break;
          if (a - x >= MIN_SEG) row.push({ x, w: a - x, base, atL: x === c.l, atR: false });
          x = Math.max(x, b);
        }
        if (c.r - x >= MIN_SEG) row.push({ x, w: c.r - x, base, atL: x === c.l, atR: true });
        free.push(row);
      }
      // Widest overlap of [a, b) with any free span on line li.
      const reach = (li, a, b) => {
        let best = null;
        for (const s of free[li] || []) {
          const l = Math.max(a, s.x);
          const r = Math.min(b, s.x + s.w);
          if (r - l >= MIN_SEG && (!best || r - l > best[1] - best[0])) best = [l, r];
        }
        return best;
      };
      const deep = (li, s) => {
        for (let k = li - DEPTH + 1; k <= li; k += 1) {
          if (k < 0 || k + DEPTH > lines) continue;
          let a = s.x;
          let b = s.x + s.w;
          let ok = true;
          for (let m = k; m < k + DEPTH && ok; m += 1) {
            if (m === li) continue;
            const o = reach(m, a, b);
            if (o) [a, b] = o;
            else ok = false;
          }
          if (ok) return true;
        }
        return false;
      };
      for (let li = 0; li < lines; li += 1) {
        for (const s of free[li]) if (deep(li, s)) segs.push(s);
      }
    }
    return segs;
  }

  // The longest line that fits at natural spacing (or shrunk), for a
  // segment no justified break can fill evenly.
  function ragged(par, from, L) {
    const { items, sw, ssh } = par;
    let best = null;
    for (let i = from + 1; i < items.length; i += 1) {
      const it = items[i];
      let legal = false;
      if (it.t === GLUE) legal = items[i - 1].t === BOX;
      else if (it.t === PEN) legal = it.p < INF;
      if (!legal) continue;
      const extra = it.t === PEN ? it.w : 0;
      const hangW = it.t === PEN ? it.hang : items[i - 1].hang || 0;
      const natural = sw[i] - sw[from] + extra - hangW;
      if (natural - (ssh[i] - ssh[from]) > L) break;
      best = i;
      if (it.t === PEN && it.p <= -INF) break;
    }
    if (best == null) return null;
    let k = best + 1;
    while (k < items.length && items[k].t !== BOX && !(items[k].t === PEN && items[k].p <= -INF)) k += 1;
    const end = items[best];
    return { pos: best, start: k, fit: 1, flag: end.t === PEN && end.flag, rag: true };
  }

  function relayout() {
    const segs = segments();
    const out = [];
    const widthAt = (j) => (segs[j] ? segs[j].w : colW);
    let p = 0;
    let par = pars[0];
    let from = 0;
    let fit = 1;
    let flag = false;
    for (let j = 0; j < segs.length; j += 1) {
      if (from >= par.items.length - 1) {
        p += 1;
        par = pars[p % pars.length];
        from = 0;
      }
      // Total fit over the next five lines; if that sets this line loose,
      // the best tight line on its own, and failing that, ragged.
      // A short runaround line has too few spaces to justify evenly: it is
      // always set ragged, flush left at its segment, never stretched.
      const short = segs[j].w < colW * SHORT;
      let b = short ? null : firstOfBest(par, from, j, fit, flag, widthAt, EMERGENCY, WINDOW);
      // A full measure would show a rag as an error in the block; it may go
      // a little looser before it gives up.
      const tol = segs[j].atL && segs[j].atR ? FULL_TOLERANCE : TOLERANCE;
      if (!short && (!b || b.r > tol)) b = firstOfBest(par, from, j, fit, flag, widthAt, tol, 1);
      if (!b) {
        if (debug) debug.rag = (debug.rag || 0) + 1;
        b = ragged(par, from, segs[j].w);
      }
      // Not even one word fits this sliver: it stays white.
      if (!b) {
        if (debug) debug.skip = (debug.skip || 0) + 1;
        continue;
      }
      const end = par.items[b.pos];
      out.push({ seg: segs[j], par, from, to: b.pos, rag: !!b.rag, last: end.t === PEN && end.p <= -INF });
      from = b.start;
      fit = b.fit;
      flag = b.flag;
    }
    layout = out;
  }

  function drawLines() {
    ctx.fillStyle = INK;
    ctx.textBaseline = "alphabetic";
    ctx.letterSpacing = "0px";
    let font = "";
    for (const ln of layout) {
      const { items, sw, sst, ssh } = ln.par;
      const brk = items[ln.to];
      const isPen = brk.t === PEN && brk.p < INF && brk.p > -INF;
      const hangW = brk.t === PEN ? brk.hang : items[ln.to - 1].hang || 0;
      const natural = sw[ln.to] - sw[ln.from] + (isPen ? brk.w : 0) - hangW;
      const L = ln.seg.w;
      let r = 0;
      if (!ln.last) {
        if (natural < L) {
          const st = sst[ln.to] - sst[ln.from];
          r = st > 0 ? (L - natural) / st : 0;
        } else {
          const sh = ssh[ln.to] - ssh[ln.from];
          r = sh > 0 ? (L - natural) / sh : 0;
        }
      } else r = Math.min(0, natural > L ? (L - natural) / Math.max(1e-3, ssh[ln.to] - ssh[ln.from]) : 0);
      let x = ln.seg.x;
      if (debug) ctx.fillStyle = ln.rag ? "#d00" : r > 1.1 ? "#06c" : INK;
      // Ragged and last lines keep natural spacing (or shrink) and start
      // flush left at their segment, wherever it begins: one rule for every
      // line, so the letter cuts the block rather than shaping it.
      if (ln.rag || ln.last) r = Math.min(0, r);
      const y = ln.seg.base;
      for (let i = ln.from; i < ln.to; i += 1) {
        const it = items[i];
        if (it.t === BOX) {
          if (it.s) {
            if (it.f !== font) {
              ctx.font = it.f;
              font = it.f;
            }
            ctx.fillText(it.s, x, y);
          }
          x += it.w;
        } else if (it.t === GLUE) {
          if (it.st >= INF) continue;
          x += it.w + (r >= 0 ? r * it.st : r * it.sh);
        }
      }
      if (isPen) {
        if (items[ln.to - 1].f !== font) {
          ctx.font = items[ln.to - 1].f;
          font = ctx.font;
        }
        ctx.fillText("-", x, y);
      }
    }
  }

  function render() {
    const dpr = stage.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, W, H);
    drawLines();
    ctx.fillStyle = INK;
    ctx.font = letter.font;
    ctx.textBaseline = "alphabetic";
    ctx.fillText("S", pos.x + letter.drawX, pos.y + letter.drawY);
  }

  const bounds = (p) => ({
    x: clamp(p.x, W * 0.08, W * 0.92),
    y: clamp(p.y, H * 0.12, H * 0.88),
  });

  stage.on("down", (pt) => {
    grab = { dx: pos.x - pt.x, dy: pos.y - pt.y };
    canvas.style.cursor = "grabbing";
  });
  stage.on("move", (pt) => {
    if (grab) {
      target.x = pt.x + grab.dx;
      target.y = pt.y + grab.dy;
    } else canvas.style.cursor = "grab";
  });
  stage.on("up", (pt) => {
    if (!grab) return;
    grab = null;
    canvas.style.cursor = "grab";
    // A throw carries on along its velocity and settles inside the frame.
    const b = bounds({ x: pos.x + pt.vx * 0.14, y: pos.y + pt.vy * 0.14 });
    target.x = b.x;
    target.y = b.y;
  });
  canvas.style.cursor = "grab";

  stage.onFrame((dt) => {
    if (!letter) return;
    // Spring: stiff while held (the letter is in the hand), softer and
    // critically damped on release so a throw lands with an ease-out.
    const k = grab ? 900 : 140;
    const c = 2 * Math.sqrt(k) * (grab ? 0.92 : 1);
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let s = 0; s < steps; s += 1) {
      pos.vx += (k * (target.x - pos.x) - c * pos.vx) * h;
      pos.vy += (k * (target.y - pos.y) - c * pos.vy) * h;
      pos.x += pos.vx * h;
      pos.y += pos.vy * h;
    }
    if (!grab && Math.abs(target.x - pos.x) < 0.05 && Math.abs(target.y - pos.y) < 0.05 && Math.hypot(pos.vx, pos.vy) < 0.5) {
      pos.x = target.x;
      pos.y = target.y;
      pos.vx = pos.vy = 0;
    }
    const key = `${pos.x.toFixed(2)},${pos.y.toFixed(2)},${W},${H}`;
    if (key === lastKey && !dirty) return;
    lastKey = key;
    dirty = false;
    const t0 = performance.now();
    relayout();
    render();
    if (debug) {
      const ms = performance.now() - t0;
      debug.n += 1;
      debug.sum += ms;
      debug.max = Math.max(debug.max, ms);
      if (debug.n % 30 === 0) console.log(`reflow: ${(debug.sum / debug.n).toFixed(2)}ms avg, ${debug.max.toFixed(2)}ms max, ${layout.length} lines, rag ${debug.rag || 0}, skip ${debug.skip || 0}`);
    }
  });

  return {
    destroy() {
      stage.destroy();
    },
  };
}
