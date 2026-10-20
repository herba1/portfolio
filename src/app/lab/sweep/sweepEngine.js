import { createSweepSound } from "./sweepAudio";
import { createGL } from "./sweepGL";

const FONT = "SweepVT";
const TAU = Math.PI * 2;
const PERIOD = 5.4;
const RANGE_NM = 12;
const TAU_WAKE = 0.42;
const TAU_BLIP = 3.6;
const TAU_CLUTTER = 0.9;
const BLINK = 530;
const IDLE_LOCK = 9000;
const AUTO_HOLD = 7600;
const AUTO_GAP = 6500;
const SCALE = [69, 72, 74, 76, 79, 81, 84, 86, 88, 91, 93];

const wrap = (a) => {
  let x = (a + Math.PI) % TAU;
  if (x < 0) x += TAU;
  return x - Math.PI;
};
const norm = (a) => {
  const x = a % TAU;
  return x < 0 ? x + TAU : x;
};
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
const pad2 = (n) => String(n).padStart(2, "0");
const brgText = (theta) => String(Math.round((norm(theta) * 180) / Math.PI) % 360).padStart(3, "0");
const lower = (s) => (s || "").toLowerCase();

function rhythm(text, base, seed) {
  const times = [];
  let t = 0;
  let s = seed;
  for (let i = 0; i < text.length; i += 1) {
    s = (s * 1103515245 + 12345) >>> 0;
    const jitter = ((s >>> 8) % 1000) / 1000;
    const ch = text[i];
    t += base * (0.6 + jitter * 0.9);
    if (ch === " ") t += base * 0.9;
    if (ch === "\n") t += base * 3;
    if (jitter > 0.94) t += base * 3.5;
    times.push(t);
  }
  return times;
}

function typedCount(times, elapsed) {
  let n = 0;
  while (n < times.length && times[n] <= elapsed) n += 1;
  return n;
}

export function createSweep(stage, { embedded = false, caption = null, onLive = () => {}, onFail = () => {}, onGesture = () => {} } = {}) {
  const root = document.createElement("div");
  root.className = "sweep-screen";
  root.tabIndex = embedded ? 0 : -1;
  root.setAttribute("role", "application");
  root.setAttribute("aria-label", "Radar of top songs. Tap a contact or use the arrow keys to lock it, Escape to release.");
  const canvas = document.createElement("canvas");
  canvas.className = "sweep-canvas";
  root.append(canvas);
  stage.append(root);

  const gl = createGL(canvas);
  if (!gl) {
    root.remove();
    onFail();
    return { destroy() {}, setSound: async () => false, setTracks() {} };
  }

  const text = document.createElement("canvas");
  const tx = text.getContext("2d");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let sound = null;

  let W = 0;
  let H = 0;
  let scale = 1;
  let cx = 0;
  let cy = 0;
  let R = 100;
  let curve = 0.04;
  let labelPx = 15;
  let labelLine = 16;
  let colPx = 20;
  let colLine = 22;
  let column = null;
  let numerals = [];
  let tracks = [];
  let contacts = [];
  let trackKey = "";

  let angle = -0.35;
  let omega = reduced ? TAU / 9 : TAU / PERIOD;
  let sweepCount = 0;
  let lock = null;
  let lockAt = 0;
  let lockMix = 0;
  let hover = null;
  let press = null;
  let autoLock = false;
  let autoIndex = 0;
  let autoAt = 0;
  let lastInput = 0;
  let allAt = 0;

  let colLines = [];
  let colQueue = [];
  let colActive = null;
  let colWait = 0;

  let textDirty = true;
  let ready = false;
  let destroyed = false;
  let visible = !document.hidden;
  let onscreen = true;
  let raf = 0;
  let last = performance.now();
  let power = reduced ? 1 : 0;
  let powerClock = 0;
  const born = performance.now();

  const blipData = new Float32Array(64);
  const ampData = new Float32Array(16);
  const boxData = new Float32Array(96);
  const brightData = new Float32Array(24);

  const font = (px) => `${Math.round(px * scale)}px ${FONT}`;
  const measure = (s, px) => {
    tx.font = font(px);
    return tx.measureText(s).width / scale;
  };

  const subLine = (c) => {
    const brg = `${brgText(c.theta)}°`;
    const rng = c.rng.toFixed(1);
    if (column && column.wide) return `${lower(c.track.artist)}  ${brg} ${rng}`;
    return `${brg}  ${rng} nm`;
  };

  const titleOf = (track, max) => {
    let t = lower(track.title).replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+-\s+.*$/, "").trim();
    if (t.length > max) t = `${t.slice(0, max - 1).trimEnd()}…`;
    return t;
  };

  const buildNumerals = () => {
    numerals = [];
    const step = R < 190 ? 90 : 30;
    const px = Math.max(12, Math.round(labelPx * 0.86));
    for (let d = 0; d < 360; d += step) {
      const s = String(d).padStart(3, "0");
      const th = (d * Math.PI) / 180;
      const rr = R - 18 - px * 0.7;
      const w = measure(s, px);
      const x = cx + Math.sin(th) * rr - w / 2;
      const y = cy - Math.cos(th) * rr - px * 0.5;
      numerals.push({ s, x, y, w, h: px, px, box: [x - 4, y - 4, x + w + 4, y + px + 4] });
    }
  };

  const overlap = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));

  const buildContacts = () => {
    const n = Math.min(tracks.length, column && column.wide ? 12 : R < 170 ? 6 : 8);
    const prev = new Map(contacts.map((c) => [c.track.id ?? c.track.title, c]));
    const placed = [];
    const blocks = numerals.map((nm) => nm.box);
    blocks.push([cx - 10, cy - 10, cx + 10, cy + 10]);
    const maxTitle = column && column.wide ? 22 : 16;
    const next = [];
    for (let i = 0; i < n; i += 1) {
      const track = tracks[i];
      const title = titleOf(track, maxTitle);
      const f = 0.2 + 0.7 * Math.pow((i + 0.5) / n, 0.85);
      const baseTheta = ((i * 137.508 + 38) * Math.PI) / 180;
      let best = null;
      const thetaSteps = [0];
      for (let k = 1; k <= 16; k += 1) thetaSteps.push(k * 5, -k * 5);
      const rSteps = [0, 0.04, -0.04, 0.08, -0.08];
      search: for (const dr of rSteps) {
        for (const dth of thetaSteps) {
          const theta = baseTheta + (dth * Math.PI) / 180;
          const rr = R * Math.min(0.9, Math.max(0.15, f + dr));
          const x = cx + Math.sin(theta) * rr;
          const y = cy - Math.cos(theta) * rr;
          const c = { theta, rr, rng: (rr / R) * RANGE_NM };
          const lines = [title, subLine({ ...c, track })];
          const w = Math.max(measure(lines[0], labelPx), measure(lines[1], labelPx));
          for (const side of x >= cx ? [1, -1] : [-1, 1]) {
            const x0 = side > 0 ? x + 17 : x - 17 - w;
            const box = [x0 - 3, y - labelLine - 3, x0 + w + 3, y + labelLine + 3];
            const corners = [
              [box[0], box[1]],
              [box[2], box[1]],
              [box[0], box[3]],
              [box[2], box[3]],
            ];
            let clash = 0;
            const outside = corners.reduce((m, [px, py]) => Math.max(m, Math.hypot(px - cx, py - cy) - (R - 20)), 0);
            const dot = [x - 7, y - 7, x + 7, y + 7];
            let cost = outside * 400;
            for (const p of placed) {
              if (p.hidden) clash += overlap(dot, p.dot) * 6;
              else clash += overlap(box, p.box) * 4 + overlap(dot, p.box) * 6 + overlap(box, p.dot) * 6;
            }
            for (const b of blocks) clash += overlap(box, b) * 3;
            cost += clash;
            cost += Math.abs(dth) * 0.4 + Math.abs(dr) * 30 + ((side > 0) === (x >= cx) ? 0 : 6);
            if (!best || cost < best.cost) best = { cost, clash: clash + outside * 400, theta, rr, x, y, side, x0, w, box, dot, lines, rng: c.rng };
            if (cost < 8) break search;
          }
        }
      }
      best.hidden = best.clash > 30;
      placed.push(best);
      const key = track.id ?? track.title;
      const old = prev.get(key);
      const scaleIdx = Math.round((1 - (best.rr / R - 0.15) / 0.75) * (SCALE.length - 1));
      next.push({
        track,
        rank: i,
        key,
        theta: best.theta,
        rr: best.rr,
        rng: best.rng,
        hx: best.x,
        hy: best.y,
        x: best.x,
        y: best.y,
        side: best.side,
        tx: best.x0,
        box: best.hidden ? best.dot : best.box,
        hidden: best.hidden,
        lines: best.lines,
        acquired: old ? old.acquired : false,
        acquiredAt: old ? old.acquiredAt : 0,
        lastHit: old ? old.lastHit : -1e9,
        lastPing: 0,
        times: rhythm(best.lines.join("\n"), 26, 977 + i * 131),
        typed: old && old.acquired ? best.lines.join("\n").length : 0,
        freq: midi(SCALE[Math.max(0, Math.min(SCALE.length - 1, scaleIdx))]),
        amp: 1 - i * 0.025,
        phase: i * 1.71,
        drift: 3 + (i % 4),
      });
    }
    contacts = next;
    if (lock) {
      const same = contacts.find((c) => c.key === lock.key);
      lock = same || null;
    }
    if (hover) hover = contacts.find((c) => c.key === hover.key) || null;
    textDirty = true;
  };

  const colChars = () => (column ? Math.max(8, Math.floor(column.w / measure("0", colPx))) : 0);

  const clip = (s) => {
    const max = colChars();
    return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
  };

  const say = (lines, replace = false) => {
    if (!column) return;
    if (replace) {
      colLines = [];
      colQueue = [];
      colActive = null;
      colWait = 80;
    }
    for (const l of lines) colQueue.push(clip(l));
    textDirty = true;
  };

  const advanceColumn = (ms) => {
    if (!column) return false;
    if (colActive) {
      colActive.elapsed += ms;
      const n = typedCount(colActive.times, colActive.elapsed);
      if (n !== colActive.n) {
        if (colActive.text[n - 1] && colActive.text[n - 1] !== " ") sound?.key(true);
        colActive.n = n;
        textDirty = true;
      }
      if (n >= colActive.text.length) {
        colActive = null;
        colWait = 110;
      }
      return true;
    }
    if (colWait > 0) {
      colWait -= ms;
      return true;
    }
    if (colQueue.length) {
      const t = colQueue.shift();
      const line = { text: t, n: 0, elapsed: 0, times: rhythm(t, 21, t.length * 31 + colLines.length * 7) };
      colLines.push(line);
      const cap = Math.max(2, column.lines);
      while (colLines.length > cap) colLines.shift();
      if (!t.length) {
        colWait = 90;
      } else {
        colActive = line;
      }
      textDirty = true;
      return true;
    }
    return false;
  };

  const drawText = () => {
    tx.setTransform(1, 0, 0, 1, 0, 0);
    tx.clearRect(0, 0, text.width, text.height);
    tx.setTransform(scale, 0, 0, scale, 0, 0);
    tx.textBaseline = "alphabetic";
    tx.fillStyle = "#fff";
    tx.shadowColor = "rgba(255,255,255,0.55)";
    tx.shadowBlur = 5 * scale;
    for (const nm of numerals) {
      tx.font = font(nm.px);
      tx.fillText(nm.s, nm.x, nm.y + nm.px * 0.8);
    }
    tx.font = font(labelPx);
    for (const c of contacts) {
      if (!c.acquired || !c.typed || c.hidden) continue;
      const a = c.lines[0];
      const b = c.lines[1];
      const n0 = Math.min(a.length, c.typed);
      const n1 = Math.max(0, Math.min(b.length, c.typed - a.length - 1));
      const base = c.y - 3;
      tx.fillText(a.slice(0, n0), c.tx, base);
      if (n1) tx.fillText(b.slice(0, n1), c.tx, base + labelLine);
    }
    if (column) {
      tx.font = font(colPx);
      tx.fillText(clip(column.header), column.x, column.y + colPx * 0.8);
      let y = column.y + colLine * 2;
      let cursor = null;
      for (const line of colLines) {
        const s = line.text.slice(0, line.n);
        tx.fillText(s, column.x, y + colPx * 0.8);
        if (line === colActive) cursor = { x: column.x + measure(s, colPx) + 2, y };
        y += colLine;
      }
      if (!cursor) cursor = { x: column.x, y };
      column.cursor = cursor;
      tx.shadowBlur = 4 * scale;
      tx.fillRect(cursor.x, cursor.y + colPx * 0.12, colPx * 0.46, colPx * 0.78);
    }
    tx.shadowBlur = 0;
  };

  const writeBoxes = (now) => {
    let i = 0;
    const put = (b, v) => {
      if (i >= 24) return;
      boxData[i * 4] = b[0] * scale;
      boxData[i * 4 + 1] = b[1] * scale;
      boxData[i * 4 + 2] = b[2] * scale;
      boxData[i * 4 + 3] = b[3] * scale;
      brightData[i] = v;
      i += 1;
    };
    if (column) {
      const c = column.cursor || { x: column.x, y: column.y };
      put([c.x - 6, c.y - 6, c.x + colPx + 6, c.y + colLine + 6], Math.floor(now / BLINK) % 2 === 0 || colActive ? 1 : 0.0);
      put([column.x - 8, column.y + colLine * 1.5, column.x + column.w + 12, column.y + column.h + 8], 1);
      put([column.x - 8, column.y - 8, column.x + column.w + 12, column.y + colLine + 8], 0.5);
    }
    for (const c of contacts) {
      const flare = Math.exp(-(now - c.lastHit) / 1800);
      const floor = 0.42 - lockMix * 0.24;
      let v = floor + (1 - floor) * flare;
      if (c === hover) v = Math.max(v, 0.9);
      if (c === lock) v = Math.max(v, 0.8 + 0.2 * flare);
      put(c.box, Math.min(1, v));
    }
    return i;
  };

  const layoutScreen = (force) => {
    const sr = stage.getBoundingClientRect();
    if (!sr.width || !sr.height) return;
    const key = `${Math.round(sr.width)}x${Math.round(sr.height)}x${window.devicePixelRatio}`;
    if (!force && key === sizeKey) return;
    sizeKey = key;
    const narrow = sr.width < 640;
    const side = embedded ? 0 : narrow ? 16 : 32;
    const bottom = embedded ? 0 : narrow ? 24 : 40;
    let w = sr.width - side * 2;
    let left = side;
    if (caption) {
      caption.style.left = `${left}px`;
      caption.style.width = `${w}px`;
    }
    const capBottom = caption ? caption.getBoundingClientRect().bottom - sr.top : 0;
    const top = caption ? Math.round(capBottom + 20) : side;
    const h = Math.max(240, sr.height - top - bottom);
    if (w > h * 1.7) {
      w = Math.round(h * 1.7);
      left = Math.round((sr.width - w) / 2);
      if (caption) {
        caption.style.left = `${left}px`;
        caption.style.width = `${w}px`;
      }
    }
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
    root.style.width = `${w}px`;
    root.style.height = `${h}px`;
    root.style.borderRadius = embedded ? "0px" : "";
    W = Math.round(w);
    H = Math.round(h);
    const maxScale = Math.min(window.devicePixelRatio || 1, 2);
    scale = Math.min(maxScale, Math.sqrt(4200000 / (W * H)));
    const SW = Math.round(W * scale);
    const SH = Math.round(H * scale);
    text.width = SW;
    text.height = SH;
    gl.resize(SW, SH);
    curve = W > H ? 0.045 : 0.032;
    const pad = Math.max(22, Math.round(Math.min(W, H) * 0.065));
    colPx = Math.round(Math.max(16, Math.min(22, Math.min(W, H) / 30)));
    colLine = Math.round(colPx * 1.15);
    column = null;
    const sideR = Math.min((H - pad * 2) / 2, (W - pad * 3 - 250) / 2);
    const belowR = Math.min((W - pad * 2) / 2, (H - pad * 3 - colLine * 7) / 2);
    if (!embedded && sideR >= 150 && W >= H) {
      R = sideR;
      const colW = Math.min(380, W - pad * 3 - R * 2);
      const total = R * 2 + pad * 1.4 + colW;
      const x0 = (W - total) / 2;
      cx = x0 + R;
      cy = H / 2;
      column = { x: cx + R + pad * 1.4, y: cy - R + 6, w: colW, h: R * 2 - 12, wide: true };
    } else if (!embedded && belowR >= 120) {
      R = belowR;
      cx = W / 2;
      const colH = Math.min(colLine * 10, H - pad * 3 - R * 2);
      const total = R * 2 + pad + colH;
      cy = (H - total) / 2 + R;
      column = { x: Math.max(pad, cx - R + 4), y: cy + R + pad, w: Math.min(W - pad * 2, R * 2), h: colH, wide: false };
    } else {
      R = Math.min(W, H) / 2 - Math.max(14, pad * 0.7);
      cx = W / 2;
      cy = H / 2;
    }
    R = Math.floor(R);
    if (column) {
      column.lines = Math.max(2, Math.floor((column.h - colLine * 2) / colLine));
      column.header = `ppi  ${RANGE_NM} nm  top songs`;
    }
    labelPx = Math.round(Math.max(14, Math.min(18, R / 15.5)));
    labelLine = Math.round(labelPx * 1.02);
    buildNumerals();
    buildContacts();
    if (column) {
      const kept = colLines.map((l) => l.text);
      colLines = [];
      colActive = null;
      colQueue = [...kept.map(clip), ...colQueue.map(clip)];
      while (colQueue.length > column.lines) colQueue.shift();
      if (!kept.length && !colQueue.length) say(["scanning"]);
    }
    textDirty = true;
    wake();
  };
  let sizeKey = "";

  const acquire = (c, now) => {
    c.acquired = true;
    c.acquiredAt = now;
    c.typed = 0;
    if (!lock) say([`acq ${pad2(c.rank + 1)}  ${titleOf(c.track, 40)}`]);
    if (!allAt && contacts.every((k) => k.acquired)) {
      allAt = now;
      say(["", `${contacts.length} contacts`]);
    }
  };

  const doLock = (c, now, auto = false) => {
    if (!c) return;
    if (lock === c) return;
    lock = c;
    lockAt = now;
    autoLock = auto;
    if (!c.acquired) acquire(c, now);
    sound?.lock(Math.sin(c.theta) * 0.6);
    const t = c.track;
    const lines = [`lock  contact ${pad2(c.rank + 1)}`, "", lower(t.title), lower(t.artist)];
    if (t.album) lines.push(`${lower(t.album)}${t.year ? `  ${t.year}` : ""}`);
    lines.push("", `brg ${brgText(c.theta)}°  rng ${c.rng.toFixed(1)} nm`, `rank ${pad2(c.rank + 1)} of ${pad2(contacts.length)}`, "tracking");
    say(lines, true);
    onLive(`Locked ${t.title} by ${t.artist}, rank ${c.rank + 1}`);
    textDirty = true;
  };

  const release = (now) => {
    if (!lock) return;
    lock = null;
    autoLock = false;
    autoAt = now;
    sound?.release();
    say(["release", "", "scanning"], true);
    onLive("Released, scanning");
  };

  const stepBeam = (dt, now) => {
    const free = reduced ? TAU / 9 : TAU / PERIOD;
    if (lock) {
      lock.thetaNow = Math.atan2(lock.x - cx, cy - lock.y);
      const amp = 0.12;
      const desired = lock.thetaNow + amp * Math.sin((now - lockAt) / 1000 * 3.1);
      const diff = wrap(desired - angle);
      const target = Math.max(-4.2, Math.min(4.2, diff * 7));
      const accel = 16;
      omega += Math.max(-accel * dt, Math.min(accel * dt, target - omega));
    } else {
      const accel = 2.2;
      omega += Math.max(-accel * dt, Math.min(accel * dt, free - omega));
    }
    const a0 = angle;
    angle += omega * dt;
    if (Math.floor(angle / TAU) !== Math.floor(a0 / TAU)) {
      sweepCount += 1;
      if (column && allAt && !lock && sweepCount % 2 === 0) say([`sweep ${String(sweepCount).padStart(3, "0")}  ${contacts.length} contacts`]);
    }
    return a0;
  };

  const passes = (theta, a0, delta) => {
    if (Math.abs(delta) < 1e-6) return false;
    const off = norm((theta - a0) * Math.sign(delta));
    return off <= Math.abs(delta);
  };

  const frame = () => {
    const now = performance.now();
    raf = 0;
    if (destroyed) return;
    const raw = Math.min(0.25, Math.max(0.001, (now - last) / 1000));
    const dt = Math.min(0.1, raw);
    last = now;
    if (power < 1) {
      powerClock += raw;
      power = Math.min(1, powerClock / 0.76);
    }
    const t = (now - born) / 1000;
    for (const c of contacts) {
      c.x = c.hx + Math.sin(t * 0.21 + c.phase) * c.drift;
      c.y = c.hy + Math.cos(t * 0.17 + c.phase * 1.3) * c.drift * 0.8;
    }
    const a0 = power > 0.6 ? stepBeam(dt, now) : angle;
    const delta = angle - a0;
    for (const c of contacts) {
      const th = Math.atan2(c.x - cx, cy - c.y);
      if (passes(th, a0, delta)) {
        c.lastHit = now;
        if (!c.acquired) acquire(c, now);
        if (now - c.lastPing > 380) {
          c.lastPing = now;
          const strength = lock ? (c === lock ? 0.9 : 0.4) : 1;
          sound?.ping(c.freq, Math.sin(th), strength * c.amp);
        }
      }
      if (c.acquired && c.typed < c.times.length) {
        const n = typedCount(c.times, now - c.acquiredAt - 60);
        if (n !== c.typed) {
          c.typed = n;
          textDirty = true;
        }
      }
    }
    advanceColumn(raw * 1000);
    lockMix += ((lock ? 1 : 0) - lockMix) * (1 - Math.exp(-dt / 0.5));

    if (!reduced && allAt && power >= 1) {
      if (autoLock && lock && now - lockAt > AUTO_HOLD) release(now);
      else if (!lock && now - lastInput > IDLE_LOCK && now - autoAt > AUTO_GAP && now - allAt > 2500) {
        const c = contacts[autoIndex % contacts.length];
        autoIndex += 1;
        doLock(c, now, true);
      }
    }

    if (textDirty) drawText();
    const n = Math.min(16, contacts.length);
    const narrowBeam = 1 - lockMix * 0.45;
    for (let i = 0; i < n; i += 1) {
      const c = contacts[i];
      blipData[i * 4] = c.x * scale;
      blipData[i * 4 + 1] = (H - c.y) * scale;
      blipData[i * 4 + 2] = 2.8 * scale;
      blipData[i * 4 + 3] = Math.max(3, Math.min(9, c.rr * 0.021)) * scale * narrowBeam;
      ampData[i] = c.amp;
    }
    const boxCount = writeBoxes(now);
    let lockU = [0, 0, 0, 0];
    if (lock) {
      const e = Math.min(1, (now - lockAt) / 320);
      const ease = 1 - Math.pow(1 - e, 3);
      const size = (30 - 19 * ease) * scale;
      const blink = e < 1 ? (Math.floor((now - lockAt) / 60) % 2 === 0 ? 1 : 0.35) : 1;
      lockU = [lock.x * scale, (H - lock.y) * scale, size, blink];
    }
    gl.render({
      text: textDirty ? text : null,
      cx: cx * scale,
      cy: (H - cy) * scale,
      radius: R * scale,
      a0: norm(a0),
      delta,
      dt,
      decay: [Math.exp(-dt / TAU_WAKE), Math.exp(-dt / TAU_BLIP), Math.exp(-dt / TAU_CLUTTER)],
      tauR: TAU_WAKE,
      tauG: TAU_BLIP,
      stamp: 1 - lockMix * 0.12,
      seed: Math.random() * 97,
      scale,
      count: n,
      blips: blipData,
      amps: ampData,
      angle: norm(angle),
      beamW: (1.7 - lockMix * 0.8) * scale,
      time: now / 1000,
      power,
      flicker: Math.random() * 0.012 + (Math.random() < 0.015 ? 0.025 : 0),
      curve,
      lock: lockU,
      boxCount,
      boxes: boxData,
      bright: brightData,
      defaultBright: 0.46,
    });
    textDirty = false;
    raf = requestAnimationFrame(frame);
  };

  function wake() {
    if (destroyed || raf || !visible || !onscreen || !ready) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  const toScene = (e) => {
    const r = root.getBoundingClientRect();
    const ux = ((e.clientX - r.left) / r.width) * 2 - 1;
    const uy = ((e.clientY - r.top) / r.height) * 2 - 1;
    const wx = ux * (1 + curve * uy * uy);
    const wy = uy * (1 + curve * ux * ux);
    return { x: ((wx + 1) / 2) * W, y: ((wy + 1) / 2) * H };
  };

  const hitAt = (p, touch) => {
    let best = null;
    let bestD = touch ? 34 : 24;
    for (const c of contacts) {
      if (!c.acquired) continue;
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best) return best;
    for (const c of contacts) {
      if (!c.acquired) continue;
      const b = c.box;
      if (p.x >= b[0] - 4 && p.x <= b[2] + 4 && p.y >= b[1] - 4 && p.y <= b[3] + 4) return c;
    }
    return null;
  };

  const onMove = (e) => {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) press.moved = true;
    if (e.pointerType !== "mouse") return;
    const hit = hitAt(toScene(e), false);
    root.style.cursor = hit ? "pointer" : "";
    if (hit !== hover) {
      hover = hit;
      if (hit) sound?.tick();
    }
  };

  const onDown = (e) => {
    if (e.button > 0) return;
    onGesture();
    lastInput = performance.now();
    press = { x: e.clientX, y: e.clientY, moved: false, touch: e.pointerType !== "mouse" };
  };

  const onUp = (e) => {
    const p = press;
    press = null;
    if (!p || p.moved) return;
    const now = performance.now();
    lastInput = now;
    const hit = hitAt(toScene(e), p.touch);
    if (hit && hit !== lock) doLock(hit, now);
    else if (lock) release(now);
  };

  const onCancel = () => {
    press = null;
  };

  const onLeave = () => {
    hover = null;
    root.style.cursor = "";
  };

  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tgt = e.target;
    if (tgt && tgt !== root && tgt !== document.body && (tgt.closest?.("button, input, textarea, a") || tgt.isContentEditable)) return;
    const k = e.key;
    const now = performance.now();
    const list = contacts.filter((c) => c.acquired);
    if (!list.length) return;
    let handled = true;
    if (k === "ArrowRight" || k === "ArrowDown") {
      onGesture();
      const i = lock ? list.indexOf(lock) : -1;
      doLock(list[(i + 1) % list.length], now);
    } else if (k === "ArrowLeft" || k === "ArrowUp") {
      onGesture();
      const i = lock ? list.indexOf(lock) : 0;
      doLock(list[(i - 1 + list.length) % list.length], now);
    } else if (k === "Escape") {
      release(now);
    } else if ((k === "Enter" || k === " ") && hover) {
      onGesture();
      doLock(hover, now);
    } else handled = false;
    if (handled) {
      lastInput = now;
      e.preventDefault();
    }
  };

  const onVisibility = () => {
    visible = !document.hidden;
    if (visible) wake();
    else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerdown", onDown);
  root.addEventListener("pointerup", onUp);
  root.addEventListener("pointercancel", onCancel);
  root.addEventListener("pointerleave", onLeave);
  const keyTarget = embedded ? root : window;
  keyTarget.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", onVisibility);
  const ro = new ResizeObserver(() => {
    if (ready) layoutScreen(false);
  });
  ro.observe(stage);
  const io = new IntersectionObserver(([entry]) => {
    onscreen = entry.isIntersecting;
    if (onscreen) wake();
    else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  });
  io.observe(root);

  const boot = async () => {
    await Promise.race([document.fonts.load(`24px ${FONT}`).catch(() => {}), new Promise((r) => setTimeout(r, 2500))]);
    if (destroyed) return;
    ready = true;
    layoutScreen(true);
    root.dataset.ready = "";
    lastInput = performance.now() - IDLE_LOCK + 14000;
    wake();
  };
  boot();

  return {
    setTracks(list) {
      const key = list.map((t) => t.id ?? t.title).join("|");
      if (key === trackKey) return;
      trackKey = key;
      tracks = list;
      if (ready && W) {
        allAt = 0;
        buildContacts();
      }
    },
    async setSound(on) {
      if (on && !sound) sound = createSweepSound();
      if (!sound) return false;
      return sound.setEnabled(on);
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointerup", onUp);
      root.removeEventListener("pointercancel", onCancel);
      root.removeEventListener("pointerleave", onLeave);
      keyTarget.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
      sound?.destroy();
      gl.dispose();
      root.remove();
    },
  };
}
