import { createAudio } from "./justifyAudio";

const FAMILY = '"Justify Arimo", Arimo, Arial, "Helvetica Neue", sans-serif';
const LEAD = 0.98;
const ASCENT = 0.8;
const GLYPH_TOP = 0.94;
const GLYPH_H = 1.18;
const MID = 0.3;
const MIN_GAP = 0.26;
const MIN_MEASURE = 2.6;
const MAX_DPR = 2;
const INK = "#0b0b0b";
const BLUE = "#1a5cff";
const K = 150;
const ZETA = 0.86;
const ROLL = 0.3;
const SEAM = Math.PI * ROLL;
const MAX_SPEED_EM = 34;

export const PRESETS = [
  { id: "streetlights", label: "streetlights", text: "we can stay out till the streetlights go soft", measure: 5.2, narrow: 0.84, soft: 0.5 },
  { id: "easy", label: "comes easy", text: "the sun comes up anyway nothing good ever comes easy", measure: 6.9, narrow: 1, soft: 0.72 },
  { id: "while", label: "a while", text: "it will take a while to feel like this again", measure: 5.6, narrow: 0.9, soft: 0.36 },
  { id: "anyone", label: "anyone", text: "you don’t have to be anyone tonight", measure: 4.6, narrow: 0.84, soft: 0.6 },
  { id: "walk", label: "walk home", text: "i keep your voice on the walk home", measure: 6.2, narrow: 1, soft: 0.28 },
];

function tokenize(text) {
  const out = [];
  const re = /\S+/g;
  let m = re.exec(text);
  while (m) {
    out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
    m = re.exec(text);
  }
  return out;
}

function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function keyOf(text) {
  return text.toLowerCase().replace(/[^a-z0-9’']/g, "");
}

function matchWords(oldWords, tokens) {
  const n = oldWords.length;
  const m = tokens.length;
  const table = Array.from({ length: n + 1 }, () => new Int16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] = keyOf(oldWords[i].text) === keyOf(tokens[j].text) ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const pairs = new Map();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (keyOf(oldWords[i].text) === keyOf(tokens[j].text)) {
      pairs.set(j, oldWords[i]);
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) i += 1;
    else j += 1;
  }
  return pairs;
}

export function createJustify(root, refs, { onEdit, onReady } = {}) {
  const stage = refs.stage;
  const canvas = document.createElement("canvas");
  canvas.className = "justify-canvas";
  canvas.setAttribute("aria-hidden", "true");
  stage.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  const low = document.createElement("canvas");
  const lctx = low.getContext("2d");
  const mid = document.createElement("canvas");
  const mctx = mid.getContext("2d");
  const meter = document.createElement("canvas").getContext("2d");
  const area = refs.area;
  const handle = refs.handle;
  const input = refs.input;
  const audio = createAudio();

  let W = 0;
  let H = 0;
  let dpr = 1;
  let F = 64;
  let measure = PRESETS[0].measure;
  let narrow = PRESETS[0].narrow;
  let softness = PRESETS[0].soft;
  let softTarget = softness;
  let text = PRESETS[0].text;
  let words = [];
  let dying = [];
  let lines = 0;
  let blockW = 0;
  let blockH = 0;
  let cx = 0;
  let cy = 0;
  let avail = { top: 0, bottom: 0, left: 0, right: 0 };
  let nextId = 1;
  let raf = 0;
  let last = 0;
  let visible = true;
  let destroyed = false;
  let ready = false;
  let focused = false;
  let selA = 0;
  let selB = 0;
  let blinkAt = 0;
  let blinkTimer = 0;
  let drag = null;
  let hover = 0;
  let frameAlpha = 0;
  let frameTarget = 0;
  let edge = { l: 0, x: 0, y: 0, h: 0 };
  let left = 0;
  let edgeV = { l: 0, x: 0, y: 0, h: 0 };
  let edgeT = { l: 0, x: 0, y: 0, h: 0 };
  let q = 1;
  let r = 1;

  const font = (size) => `400 ${size}px ${FAMILY}`;

  const measureWord = (word) => {
    meter.font = font(100);
    const pref = [0];
    for (let i = 1; i <= word.text.length; i += 1) pref.push((meter.measureText(word.text.slice(0, i)).width / 100) * narrow);
    word.pref = pref;
    word.w = pref[pref.length - 1];
    word.nw = word.w / narrow;
  };

  const makeWord = (token) => {
    const word = {
      id: nextId,
      text: token.text,
      start: token.start,
      end: token.end,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      tx: 0,
      ty: 0,
      a: 0,
      va: 0,
      ta: 1,
      ka: 140,
      s: 1,
      vs: 0,
      ts: 1,
      sx: narrow,
      vsx: 0,
      ln: 0,
      lx: 0,
      tl: 0,
      txl: 0,
      wait: 0,
      line: -1,
      col: 0,
      delay: 0,
      sprite: null,
    };
    nextId += 1;
    measureWord(word);
    return word;
  };

  const flow = (m) => {
    const rows = [];
    let row = [];
    let used = 0;
    for (const word of words) {
      const need = row.length ? used + MIN_GAP + word.w : word.w;
      if (row.length && need > m) {
        rows.push(row);
        row = [word];
        used = word.w;
      } else {
        row.push(word);
        used = need;
      }
    }
    if (row.length) rows.push(row);
    return rows;
  };

  const readInsets = () => {
    const box = root.getBoundingClientRect();
    const top = refs.caption ? refs.caption.getBoundingClientRect().bottom - box.top : 0;
    const bottom = refs.controls ? box.bottom - refs.controls.getBoundingClientRect().top : 0;
    avail = { top: Math.max(top, 16), bottom: Math.max(bottom, 16), left: 16, right: 16 };
  };

  const fitFont = () => {
    const aw = W - avail.left - avail.right - 48;
    const ah = H - avail.top - avail.bottom - 48;
    F = Math.max(22, Math.min(112, aw / 6.4, ah / (5.6 * LEAD)));
  };

  const minMeasure = () => words.reduce((m, w) => Math.max(m, w.w + 0.04), MIN_MEASURE);

  const maxMeasure = () => Math.min(10.5, (W - avail.left - avail.right - 24) / F);

  const fitOverflow = () => {
    const ah = H - avail.top - avail.bottom - 24;
    let rows = flow(measure).length;
    while (rows * LEAD * F > ah && measure < maxMeasure() - 0.01) {
      measure = Math.min(maxMeasure(), measure + 0.25);
      rows = flow(measure).length;
    }
    if (rows * LEAD * F > ah) F = Math.max(14, ah / (rows * LEAD));
  };

  const keepSize = (prevF) => {
    if (!prevF || Math.abs(prevF - F) < 0.01) return;
    const ratio = prevF / F;
    for (const word of words) {
      word.s *= ratio;
      word.lx /= ratio;
    }
    for (const word of dying) {
      word.s *= ratio;
      word.lx /= ratio;
    }
  };

  const snapPx = (v) => Math.round(v * dpr) / dpr;

  const layout = (snap = false) => {
    const rows = flow(measure);
    lines = rows.length;
    blockW = measure * F;
    blockH = lines * LEAD * F;
    cx = avail.left + (W - avail.left - avail.right) / 2;
    cy = avail.top + (H - avail.top - avail.bottom) / 2;
    left = drag?.kind === "measure" ? drag.left : snapPx(cx - blockW / 2);
    const top = cy - blockH / 2;
    rows.forEach((row, li) => {
      const sum = row.reduce((s, w) => s + w.w, 0);
      const lastRow = li === rows.length - 1;
      const gap = !lastRow && row.length > 1 ? (measure - sum) / (row.length - 1) : MIN_GAP;
      let x = 0;
      row.forEach((word, col) => {
        word.txl = snapPx(x * F);
        word.tl = li;
        word.tx = left + word.txl;
        word.ty = snapPx(top + (li * LEAD + ASCENT) * F);
        if (!snap && word.line !== -1 && word.line !== li) word.arrived = false;
        if (snap || word.line === -1) {
          word.ln = li;
          word.lx = word.txl;
          word.vx = 0;
        }
        word.line = li;
        word.col = col;
        x += word.w + gap;
      });
    });
    edgeT = { l: left, x: left + blockW, y: top, h: blockH };
    if (snap) {
      edge = { ...edgeT };
      edgeV = { l: 0, x: 0, y: 0, h: 0 };
    }
    for (const word of words) place(word);
    placeArea(left, top);
  };

  const placeArea = (left, top) => {
    area.style.transform = `translate3d(${(left - 12).toFixed(1)}px, ${(top - 12).toFixed(1)}px, 0)`;
    area.style.width = `${(blockW + 24).toFixed(1)}px`;
    area.style.height = `${(blockH + 24).toFixed(1)}px`;
  };

  const retire = (word, delay = 0) => {
    word.ta = 0;
    word.ts = 0.86;
    word.ka = 320;
    word.tl = word.ln;
    word.txl = word.lx;
    word.vx = 0;
    word.wait = delay;
    word.dying = true;
    word.fixedX = edge.l + word.lx;
    word.fixedY = lineY(word.ln);
    dying.push(word);
  };

  const setWords = (nextText, spawnAt) => {
    const tokens = tokenize(nextText);
    const old = words;
    let p = 0;
    while (p < old.length && p < tokens.length && old[p].text === tokens[p].text) p += 1;
    let s = 0;
    while (s < old.length - p && s < tokens.length - p && old[old.length - 1 - s].text === tokens[tokens.length - 1 - s].text) s += 1;
    const next = [];
    for (let i = 0; i < p; i += 1) next.push(old[i]);
    const midOld = old.slice(p, old.length - s);
    const midNew = tokens.slice(p, tokens.length - s);
    midNew.forEach((token, i) => {
      if (i < midOld.length) {
        const word = midOld[i];
        if (word.text !== token.text) {
          word.text = token.text;
          word.sprite = null;
          measureWord(word);
        }
        next.push(word);
      } else {
        const word = makeWord(token);
        const anchor = next[next.length - 1];
        word.line = 0;
        word.ln = anchor ? anchor.ln : 0;
        word.lx = anchor ? anchor.lx + (anchor.w + MIN_GAP) * F : spawnAt ? spawnAt.x - edge.l : 0;
        word.a = 0;
        word.s = 0.72;
        word.ka = 220;
        next.push(word);
      }
    });
    for (let i = midNew.length; i < midOld.length; i += 1) retire(midOld[i]);
    for (let i = old.length - s; i < old.length; i += 1) next.push(old[i]);
    next.forEach((word, i) => {
      word.start = tokens[i].start;
      word.end = tokens[i].end;
    });
    words = next;
    text = nextText;
  };

  const resizeLow = () => {
    q = 1 / (1 + softness * softness * 9.5 * Math.min(1.4, (F * dpr) / 90));
    r = dpr * q;
    const lw = Math.max(2, Math.round(W * dpr * q));
    const lh = Math.max(2, Math.round(H * dpr * q));
    if (low.width !== lw || low.height !== lh) {
      low.width = lw;
      low.height = lh;
    }
    const mw = Math.max(2, Math.round(lw * 2));
    const mh = Math.max(2, Math.round(lh * 2));
    if (mid.width !== mw || mid.height !== mh) {
      mid.width = mw;
      mid.height = mh;
    }
  };

  const resize = () => {
    const rect = stage.getBoundingClientRect();
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    readInsets();
    fitFont();
    const mm = maxMeasure();
    if (measure > mm) measure = Math.max(minMeasure(), mm);
    fitOverflow();
    resizeLow();
    layout(true);
    wake();
  };

  const spriteFor = (word) => {
    const key = `${word.text}|${F.toFixed(2)}|${r.toFixed(4)}`;
    if (word.sprite && word.sprite.key === key) return word.sprite;
    const pad = Math.ceil(0.14 * F);
    const cw = Math.max(1, Math.ceil((word.nw * F + pad * 2) * r) + 2);
    const ch = Math.max(1, Math.ceil((GLYPH_H * F + pad * 2) * r) + 2);
    const make = () => {
      const c = document.createElement("canvas");
      c.width = cw;
      c.height = ch;
      const g = c.getContext("2d");
      g.scale(r, r);
      g.font = font(F);
      g.textBaseline = "alphabetic";
      g.fillStyle = INK;
      g.fillText(word.text, pad, pad + GLYPH_TOP * F);
      return c;
    };
    const sprite = { key, pad, cw, ch, fill: make() };
    word.sprite = sprite;
    return sprite;
  };

  const caretPos = (index) => {
    if (!words.length) return { x: cx, y: cy + (ASCENT - LEAD / 2) * F };
    for (let i = 0; i < words.length; i += 1) {
      const word = words[i];
      if (index < word.start) {
        if (i === 0) return { x: word.x, y: word.y };
        const prev = words[i - 1];
        if (prev.line === word.line) {
          const room = word.x - (prev.x + prev.w * F);
          const t = Math.min(1, (index - prev.end) / Math.max(1, word.start - prev.end));
          return { x: prev.x + prev.w * F + room * t * 0.5, y: prev.y };
        }
        return { x: prev.x + prev.w * F + MIN_GAP * F * 0.5, y: prev.y };
      }
      if (index <= word.end) return { x: word.x + word.pref[index - word.start] * F, y: word.y };
    }
    const tail = words[words.length - 1];
    return { x: tail.x + (tail.w + (index > tail.end ? MIN_GAP * 0.5 : 0)) * F, y: tail.y };
  };

  const hitIndex = (px, py) => {
    if (!words.length) return text.length;
    const top = cy - blockH / 2;
    const li = Math.max(0, Math.min(lines - 1, Math.floor((py - top) / (LEAD * F))));
    const row = words.filter((w) => w.line === li);
    if (!row.length) return text.length;
    let best = row[0];
    let bestD = Infinity;
    for (const word of row) {
      const d = px < word.tx ? word.tx - px : px > word.tx + word.w * F ? px - word.tx - word.w * F : 0;
      if (d < bestD) {
        bestD = d;
        best = word;
      }
    }
    const local = (px - best.tx) / F;
    let ci = 0;
    let cd = Infinity;
    best.pref.forEach((v, i) => {
      const d = Math.abs(v - local);
      if (d < cd) {
        cd = d;
        ci = i;
      }
    });
    return best.start + ci;
  };

  const spring = (pos, vel, target, k, zeta, dt) => {
    const acc = (target - pos) * k - vel * 2 * Math.sqrt(k) * zeta;
    return vel + acc * dt;
  };

  const lineY = (ln) => edge.y + (ln * LEAD + ASCENT) * F;

  const place = (word) => {
    word.x = word.dying ? word.fixedX : edge.l + word.lx;
    word.y = word.dying ? word.fixedY : lineY(word.ln);
  };

  const stepWord = (word, dt) => {
    if (word.delay > 0) {
      word.delay -= dt;
      if (word.delay <= 0 && word.chime) {
        word.chime = false;
        audio.tick(((word.tx - cx) / Math.max(1, W)) * 1.6, word.line);
      }
      place(word);
      return true;
    }
    const M = edge.x - edge.l;
    const P = M + SEAM * F;
    const drawn = word.nw * word.sx * F;
    if (word.wait > 0) word.wait -= dt;
    else {
      const goal = (word.tl - word.ln) * P + word.txl;
      word.vx = spring(word.lx, word.vx, goal, K, ZETA, dt);
      const cap = MAX_SPEED_EM * F;
      if (word.vx > cap) word.vx = cap;
      else if (word.vx < -cap) word.vx = -cap;
      word.lx += word.vx * dt;
      let guard = 0;
      while (word.lx + drawn / 2 > M + (SEAM * F) / 2 && word.ln < word.tl && guard < 40) {
        word.ln += 1;
        word.lx -= P;
        guard += 1;
      }
      while (word.lx + drawn / 2 < -(SEAM * F) / 2 && word.ln > word.tl && guard < 80) {
        word.ln -= 1;
        word.lx += P;
        guard += 1;
      }
      if (word.ln < word.tl && word.lx > P) {
        word.ln += 1;
        word.lx -= P;
      }
      if (word.ln > word.tl && word.lx < -P) {
        word.ln -= 1;
        word.lx += P;
      }
    }
    word.vs = spring(word.s, word.vs, word.ts, K * 1.8, 1, dt);
    word.s += word.vs * dt;
    word.vsx = spring(word.sx, word.vsx, narrow, K, 1, dt);
    word.sx += word.vsx * dt;
    word.va = spring(word.a, word.va, word.ta, word.ka, 1, dt);
    word.a = Math.max(0, Math.min(1, word.a + word.va * dt));
    const busy =
      word.wait > 0 ||
      word.ln !== word.tl ||
      Math.abs(word.txl - word.lx) > 0.04 ||
      Math.abs(word.vx) > 0.6 ||
      Math.abs(word.ts - word.s) > 0.0006 ||
      Math.abs(word.vs) > 0.002 ||
      Math.abs(narrow - word.sx) > 0.0006 ||
      Math.abs(word.ta - word.a) > 0.002;
    if (!busy) {
      if (word.arrived === false && !word.dying) {
        word.arrived = true;
        audio.tick(((word.tx - cx) / Math.max(1, W)) * 1.6, word.line);
      }
      word.lx = word.txl;
      word.vx = 0;
      word.s = word.ts;
      word.vs = 0;
      word.sx = narrow;
      word.vsx = 0;
      word.a = word.ta;
      word.va = 0;
    }
    place(word);
    return busy;
  };

  const step = (dt) => {
    let moving = false;
    if (Math.abs(softTarget - softness) > 0.001) {
      softness += (softTarget - softness) * Math.min(1, dt * 7);
      if (Math.abs(softTarget - softness) <= 0.001) softness = softTarget;
      moving = true;
    }
    for (const key of ["l", "y", "h"]) {
      const k = key === "l" ? 70 : 190;
      edgeV[key] += ((edgeT[key] - edge[key]) * k - edgeV[key] * 2 * Math.sqrt(k)) * dt;
      edge[key] += edgeV[key] * dt;
      if (Math.abs(edgeT[key] - edge[key]) > 0.02 || Math.abs(edgeV[key]) > 0.3) moving = true;
      else {
        edge[key] = edgeT[key];
        edgeV[key] = 0;
      }
    }
    edge.x = edge.l + measure * F;
    for (const word of words) moving = stepWord(word, dt) || moving;
    for (const word of dying) moving = stepWord(word, dt) || moving;
    dying = dying.filter((w) => w.wait > 0 || w.a > 0.004);
    if (dying.length) moving = true;
    const fa = frameTarget - frameAlpha;
    frameAlpha += fa * Math.min(1, dt * 14);
    if (Math.abs(fa) > 0.004) moving = true;
    else frameAlpha = frameTarget;
    return moving;
  };

  const drawSelection = (scale) => {
    if (!focused || selA === selB) return;
    const a = Math.min(selA, selB);
    const b = Math.max(selA, selB);
    ctx.fillStyle = "rgba(26, 92, 255, 0.2)";
    for (let i = 0; i < words.length; i += 1) {
      const word = words[i];
      if (word.end < a || word.start > b) continue;
      const s = Math.max(a, word.start) - word.start;
      const e = Math.min(b, word.end) - word.start;
      const x0 = word.x + word.pref[s] * F;
      let x1 = word.x + word.pref[e] * F;
      const next = words[i + 1];
      if (next && next.line === word.line && b >= next.start && a <= word.end) x1 = next.x;
      if (x1 - x0 < 1) continue;
      const top = word.y - ASCENT * F - 0.02 * F;
      ctx.fillRect(x0 * scale, top * scale, (x1 - x0) * scale, LEAD * F * scale);
    }
  };

  const stamp = (word, sprite, ux, ln, M) => {
    const k = word.s * word.sx;
    const full = word.nw * F * k;
    const u0 = ux + (word.nw * word.sx * F * (1 - word.s)) / 2;
    const u1 = u0 + full;
    const R = ROLL * F;
    const reach = (Math.PI / 2) * R;
    const top = (word.dying ? word.fixedY : lineY(ln)) - MID * F - ((GLYPH_TOP - MID) * F + sprite.pad) * word.s;
    const dh = (sprite.ch / r) * word.s;
    const base = word.dying ? word.fixedX - ux : edge.l;
    const src = (u) => (sprite.pad + (u - u0) / k) * r;
    const alpha = word.a;
    const fa = word.dying || u0 > -0.5 ? u0 : 0;
    const fb = word.dying || u1 < M + 0.5 ? u1 : M;
    if (fb > fa) {
      lctx.globalAlpha = alpha;
      const sa = src(fa);
      const sb = fb >= u1 ? sprite.cw : src(fb);
      const sa2 = fa <= u0 ? 0 : sa;
      const da = fa <= u0 ? fa - sprite.pad * k : fa;
      const db = fb >= u1 ? fb + (sprite.cw / r - sprite.pad - word.nw * F) * k : fb;
      lctx.drawImage(sprite.fill, sa2, 0, Math.max(0.01, sb - sa2), sprite.ch, base + da, top, Math.max(0.01, db - da), dh);
    }
    const strip = Math.max(0.6, 0.035 * F);
    const bend = (from, to, map) => {
      if (to <= from) return;
      const n = Math.max(1, Math.ceil((to - from) / strip));
      const du = (to - from) / n;
      for (let i = 0; i < n; i += 1) {
        const ua = from + i * du;
        const ub = ua + du;
        const ma = map(ua);
        const mb = map(ub);
        const lit = Math.cos(Math.min(Math.PI / 2, mb.phi * 0.5 + ma.phi * 0.5));
        if (lit <= 0.01) continue;
        lctx.globalAlpha = alpha * Math.pow(lit, 1.4);
        const xa = Math.min(ma.x, mb.x);
        const xb = Math.max(ma.x, mb.x);
        lctx.drawImage(sprite.fill, src(ua), 0, Math.max(0.01, src(ub) - src(ua)), sprite.ch, base + xa, top, Math.max(0.02, xb - xa + 0.02), dh);
      }
    };
    bend(Math.max(u0, fb), Math.min(u1, M + reach), (u) => ({ phi: (u - M) / R, x: M + R * Math.sin((u - M) / R) }));
    bend(Math.max(u0, -reach), Math.min(u1, fa), (u) => ({ phi: -u / R, x: -R * Math.sin(-u / R) }));
  };

  const paint = (word) => {
    if (word.a <= 0.003 || word.delay > 0) return;
    const sprite = spriteFor(word);
    const M = edge.x - edge.l;
    const P = M + SEAM * F;
    stamp(word, sprite, word.lx, word.ln, M);
    if (word.dying) return;
    if (word.ln < word.tl) stamp(word, sprite, word.lx - P, word.ln + 1, M);
    if (word.ln > word.tl) stamp(word, sprite, word.lx + P, word.ln - 1, M);
  };

  const draw = (now) => {
    resizeLow();
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, low.width, low.height);
    lctx.imageSmoothingEnabled = true;
    lctx.imageSmoothingQuality = "high";
    lctx.setTransform(r, 0, 0, r, 0, 0);
    for (const word of dying) paint(word);
    for (const word of words) paint(word);
    lctx.globalAlpha = 1;
    lctx.setTransform(1, 0, 0, 1, 0, 0);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawSelection(dpr);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    if (q < 0.6) {
      mctx.setTransform(1, 0, 0, 1, 0, 0);
      mctx.clearRect(0, 0, mid.width, mid.height);
      mctx.imageSmoothingEnabled = true;
      mctx.imageSmoothingQuality = "low";
      mctx.drawImage(low, 0, 0, mid.width, mid.height);
      ctx.drawImage(mid, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.drawImage(low, 0, 0, canvas.width, canvas.height);
    }

    if (frameAlpha > 0.01) {
      const left = edge.l;
      const width = edge.x - edge.l;
      ctx.globalAlpha = frameAlpha;
      ctx.strokeStyle = BLUE;
      ctx.lineWidth = Math.max(1, dpr);
      ctx.beginPath();
      const half = ctx.lineWidth / 2;
      ctx.rect(Math.round((left - 12) * dpr) + half, Math.round((edge.y - 8) * dpr) + half, Math.round((width + 24) * dpr), Math.round((edge.h + 16) * dpr));
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (focused && selA === selB) {
      const on = (now - blinkAt) % 1060 < 620;
      if (on) {
        const p = caretPos(selA);
        ctx.fillStyle = BLUE;
        const w = Math.max(2, Math.round(2 * dpr));
        ctx.fillRect(Math.round((p.x - 1) * dpr), Math.round((p.y - ASCENT * F + 0.02 * F) * dpr), w, Math.round(LEAD * 0.96 * F * dpr));
      }
    }

    handle.style.transform = `translate3d(${(edge.x + 12).toFixed(1)}px, ${(edge.y + edge.h / 2).toFixed(1)}px, 0)`;
  };

  const frame = (now) => {
    raf = 0;
    const dt = Math.min(1 / 30, last ? (now - last) / 1000 : 1 / 60);
    last = now;
    let moving = false;
    const sub = 3;
    for (let i = 0; i < sub; i += 1) moving = step(dt / sub) || moving;
    draw(now);
    if (moving || drag) wake();
    else last = 0;
  };

  function wake() {
    if (raf || destroyed || !visible || document.hidden || !W) return;
    raf = requestAnimationFrame(frame);
  }

  const scheduleBlink = () => {
    clearTimeout(blinkTimer);
    if (!focused || destroyed) return;
    const now = performance.now();
    const phase = (now - blinkAt) % 1060;
    const wait = phase < 620 ? 620 - phase : 1060 - phase;
    blinkTimer = setTimeout(() => {
      wake();
      scheduleBlink();
    }, wait + 4);
  };

  const syncSelection = () => {
    if (!focused) return;
    const a = input.selectionStart ?? text.length;
    const b = input.selectionEnd ?? a;
    if (a !== selA || b !== selB) {
      selA = a;
      selB = b;
      blinkAt = performance.now();
      const p = caretPos(selB);
      input.style.transform = `translate3d(${p.x.toFixed(0)}px, ${(p.y - ASCENT * F).toFixed(0)}px, 0)`;
      scheduleBlink();
      wake();
    }
  };

  const localPoint = (e) => {
    const rect = stage.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const inBlock = (p, pad = 20) => {
    const left = edgeT.l;
    const top = cy - blockH / 2;
    return p.x >= left - pad && p.x <= left + blockW + pad && p.y >= top - pad && p.y <= top + blockH + pad;
  };

  const updateFrame = () => {
    frameTarget = drag?.kind === "measure" ? 0.9 : focused ? 0.5 : hover ? 0.35 : 0;
    root.toggleAttribute("data-measuring", drag?.kind === "measure");
    wake();
  };

  const setMeasure = (m) => {
    const room = drag?.kind === "measure" ? Math.min(maxMeasure(), (W - avail.right - 16 - drag.left) / F) : maxMeasure();
    const clamped = Math.max(minMeasure(), Math.min(room, m));
    const prev = measure;
    measure = clamped;
    const rows = flow(measure).length;
    if (rows * LEAD * F > H - avail.top - avail.bottom - 24 && clamped < prev) {
      measure = prev;
      return;
    }
    layout(false);
    syncCaretInput();
    wake();
  };

  const syncCaretInput = () => {
    if (!focused) return;
    const p = caretPos(selB);
    input.style.transform = `translate3d(${p.x.toFixed(0)}px, ${(p.y - ASCENT * F).toFixed(0)}px, 0)`;
  };

  const onHandleDown = (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    e.stopPropagation();
    audio.unlock();
    handle.setPointerCapture(e.pointerId);
    const p = localPoint(e);
    drag = { kind: "measure", id: e.pointerId, x0: p.x, m0: measure, left: edgeT.l };
    updateFrame();
  };

  const onHandleMove = (e) => {
    if (!drag || drag.kind !== "measure" || drag.id !== e.pointerId) return;
    const p = localPoint(e);
    setMeasure(drag.m0 + (p.x - drag.x0) / F);
  };

  const onHandleUp = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    drag = null;
    layout(false);
    updateFrame();
    wake();
  };

  const onHandleKey = (e) => {
    const stepEm = e.shiftKey ? 1 : 0.25;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") setMeasure(measure + stepEm);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") setMeasure(measure - stepEm);
    else return;
    e.preventDefault();
    audio.unlock();
  };

  const onDown = (e) => {
    if (e.target === handle) return;
    audio.unlock();
    const p = localPoint(e);
    if (!inBlock(p)) {
      if (focused) input.blur();
      return;
    }
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const index = hitIndex(p.x, p.y);
    drag = { kind: "select", id: e.pointerId, anchor: index, moved: false, x0: p.x, y0: p.y, touch: e.pointerType !== "mouse" };
    if (!drag.touch) {
      e.preventDefault();
      stage.setPointerCapture(e.pointerId);
      input.focus({ preventScroll: true });
      input.setSelectionRange(index, index);
      syncSelection();
    }
  };

  const onMove = (e) => {
    const p = localPoint(e);
    if (drag && drag.kind === "select" && drag.id === e.pointerId) {
      if (drag.touch) return;
      const index = hitIndex(p.x, p.y);
      const a = Math.min(drag.anchor, index);
      const b = Math.max(drag.anchor, index);
      input.setSelectionRange(a, b, index < drag.anchor ? "backward" : "forward");
      syncSelection();
      return;
    }
    if (e.pointerType !== "mouse") return;
    const over = inBlock(p) ? 1 : 0;
    if (over !== hover) {
      hover = over;
      updateFrame();
    }
  };

  const onUp = (e) => {
    if (!drag || drag.kind !== "select" || drag.id !== e.pointerId) return;
    const wasTouch = drag.touch;
    const index = drag.anchor;
    drag = null;
    if (wasTouch) {
      input.focus({ preventScroll: true });
      input.setSelectionRange(index, index);
      syncSelection();
    }
    updateFrame();
  };

  const onLeave = (e) => {
    if (e.pointerType === "mouse" && hover) {
      hover = 0;
      updateFrame();
    }
  };

  const onInput = () => {
    const value = input.value.replace(/\n/g, " ");
    if (value !== input.value) input.value = value;
    const caret = input.selectionStart ?? value.length;
    const p = caretPos(Math.min(caret, text.length));
    setWords(value, p);
    measure = Math.min(Math.max(measure, minMeasure()), Math.max(minMeasure(), maxMeasure()));
    const prevF = F;
    fitOverflow();
    keepSize(prevF);
    layout(false);
    audio.key(((p.x - cx) / Math.max(1, W)) * 1.6);
    selA = -1;
    syncSelection();
    onEdit?.(value);
    wake();
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" || e.key === "Escape") {
      e.preventDefault();
      input.blur();
      return;
    }
    requestAnimationFrame(syncSelection);
  };

  const onFocus = () => {
    focused = true;
    blinkAt = performance.now();
    selA = -1;
    syncSelection();
    root.setAttribute("data-editing", "");
    updateFrame();
    scheduleBlink();
  };

  const onBlur = () => {
    focused = false;
    clearTimeout(blinkTimer);
    root.removeAttribute("data-editing");
    updateFrame();
  };

  const onSelectionChange = () => {
    if (document.activeElement === input) syncSelection();
  };

  const onVisibility = () => {
    if (!document.hidden) wake();
  };

  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  stage.addEventListener("pointerleave", onLeave);
  handle.addEventListener("pointerdown", onHandleDown);
  handle.addEventListener("pointermove", onHandleMove);
  handle.addEventListener("pointerup", onHandleUp);
  handle.addEventListener("pointercancel", onHandleUp);
  handle.addEventListener("keydown", onHandleKey);
  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onKeyDown);
  input.addEventListener("focus", onFocus);
  input.addEventListener("blur", onBlur);
  document.addEventListener("selectionchange", onSelectionChange);
  document.addEventListener("visibilitychange", onVisibility);
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) wake();
  });
  io.observe(root);
  const ro = new ResizeObserver(() => resize());

  const start = () => {
    if (destroyed) return;
    input.value = text;
    words = tokenize(text).map(makeWord);
    words.forEach((w) => {
      w.a = 1;
    });
    ro.observe(stage);
    resize();
    layout(true);
    draw(performance.now());
    ready = true;
    onReady?.();
  };

  const fontReady = document.fonts ? document.fonts.load(font(64), "a").catch(() => null) : Promise.resolve();
  Promise.race([fontReady, new Promise((res) => setTimeout(res, 2500))]).then(start);

  return {
    setPreset(preset) {
      if (focused) input.blur();
      narrow = preset.narrow;
      const tokens = tokenize(preset.text);
      const pairs = matchWords(words, tokens);
      const kept = new Set(pairs.values());
      let gone = 0;
      words.forEach((word) => {
        if (kept.has(word)) return;
        retire(word, gone * 0.025);
        gone += 1;
      });
      input.value = preset.text;
      text = preset.text;
      let born = 0;
      words = tokens.map((token, j) => {
        const old = pairs.get(j);
        if (old) {
          old.text = token.text;
          old.start = token.start;
          old.end = token.end;
          old.sprite = null;
          old.wait = 0.2;
          old.arrived = false;
          measureWord(old);
          return old;
        }
        const word = makeWord(token);
        word.a = 0;
        word.s = 0.9;
        word.ka = 110;
        word.delay = 0.2 + born * 0.045;
        word.chime = true;
        born += 1;
        return word;
      });
      const prevF = F;
      fitFont();
      measure = Math.max(minMeasure(), Math.min(preset.measure, maxMeasure()));
      fitOverflow();
      keepSize(prevF);
      softTarget = preset.soft;
      layout(false);
      wake();
      return preset.soft;
    },
    setSoftness(v) {
      const prev = Math.round(softness * 20);
      softness = v;
      softTarget = v;
      const nextStep = Math.round(v * 20);
      if (nextStep !== prev) audio.detent(v);
      resizeLow();
      wake();
    },
    unlock() {
      audio.unlock();
    },
    setSound(on) {
      return audio.setEnabled(on);
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      clearTimeout(blinkTimer);
      io.disconnect();
      ro.disconnect();
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
      stage.removeEventListener("pointerleave", onLeave);
      handle.removeEventListener("pointerdown", onHandleDown);
      handle.removeEventListener("pointermove", onHandleMove);
      handle.removeEventListener("pointerup", onHandleUp);
      handle.removeEventListener("pointercancel", onHandleUp);
      handle.removeEventListener("keydown", onHandleKey);
      input.removeEventListener("input", onInput);
      input.removeEventListener("keydown", onKeyDown);
      input.removeEventListener("focus", onFocus);
      input.removeEventListener("blur", onBlur);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("visibilitychange", onVisibility);
      audio.destroy();
      canvas.remove();
    },
  };
}
