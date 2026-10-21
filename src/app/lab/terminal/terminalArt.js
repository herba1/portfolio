const RAMP = " .,:;-=+*#%@";
const DITHER = " .:+#";
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

function hash(n) {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
}

function frameOf(cols, rows) {
  return { cols, rows, text: Array.from({ length: rows }, () => new Array(cols).fill(" ")), bright: Array.from({ length: rows }, () => new Array(cols).fill(" ")) };
}

function put(f, i, j, ch, lit) {
  if (i < 0 || j < 0 || i >= f.cols || j >= f.rows) return;
  if (lit) {
    f.bright[j][i] = ch;
    f.text[j][i] = " ";
  } else {
    f.text[j][i] = ch;
    f.bright[j][i] = " ";
  }
}

export function finish(f) {
  return { cols: f.cols, rows: f.rows, text: f.text.map((r) => r.join("")), bright: f.bright.map((r) => r.join("")) };
}

export function recordFrame(cols, rows, t, { aspect, tracks = 6 }) {
  const f = frameOf(cols, rows);
  const pxW = cols;
  const pxH = rows * aspect;
  const tiltCos = Math.max(0.32, Math.min(0.62, pxH / pxW));
  const S = Math.min(pxW / 2, pxH / 2 / tiltCos) * 0.96;
  const spin = t * Math.PI * 2 * 0.555;
  const wob = 0.05 * Math.sin(t * 0.7);
  const light = 0.6 + 0.25 * Math.sin(t * 0.31);
  const gaps = [];
  for (let k = 1; k < tracks; k += 1) gaps.push(0.4 + 0.56 * (1 - k / tracks));
  const cw = Math.cos(wob);
  const sw = Math.sin(wob);
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const x0 = i + 0.5 - cols / 2;
      const y0 = (j + 0.5 - rows / 2) * aspect;
      const x = cw * x0 + sw * y0;
      const y = -sw * x0 + cw * y0;
      const u = x / S;
      const v = y / (S * tiltCos);
      const r = Math.hypot(u, v);
      if (r > 1 || r < 0.05) continue;
      const a = Math.atan2(v, u);
      let val;
      let lit = false;
      if (r < 0.1) val = 0.18;
      else if (r < 0.34) {
        const la = a - spin;
        const band = Math.abs(Math.sin(la)) < 0.22;
        const ring = Math.abs(r - 0.3) < 0.025;
        val = band ? 0.98 : ring ? 0.5 : 0.78;
        lit = band;
      } else if (r < 0.37) val = 0.12;
      else if (r > 0.975) {
        val = 0.42;
      } else {
        const groove = 0.035 * Math.sin(r * 120 + 0.4);
        let gap = 0;
        for (const g of gaps) if (Math.abs(r - g) < 0.014) gap = 1;
        const spec = Math.pow(Math.max(0, Math.cos(2 * (a - light))), 6) * (0.55 + 0.45 * Math.sin(r * 9 + t * 0.3));
        val = 0.13 + groove + spec * 0.8 - gap * 0.1;
        lit = spec > 0.82;
        const dust = hash(Math.floor(((a - spin + Math.PI * 4) % (Math.PI * 2)) * 9) * 13 + Math.floor(r * 40));
        if (dust > 0.992) {
          val = 0.9;
          lit = true;
        }
      }
      const k = Math.max(1, Math.min(RAMP.length - 1, Math.round(val * (RAMP.length - 1))));
      put(f, i, j, RAMP[k], lit);
    }
  }
  return finish(f);
}

export function flowFrame(cols, rows, t, { aspect }) {
  const f = frameOf(cols, rows);
  const DIRS = ["-", "\\", "|", "/"];
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const x = i;
      const y = j * aspect;
      const theta = (Math.sin(x * 0.07 + t * 0.35) + Math.cos(y * 0.09 - t * 0.27) + Math.sin((x + y) * 0.035 + t * 0.18)) * 1.2;
      const m = 0.5 + 0.5 * Math.sin(x * 0.11 - t * 0.9 + 2 * Math.sin(y * 0.06 + t * 0.4));
      if (m < 0.38) continue;
      const dx = Math.cos(theta);
      const dy = Math.sin(theta) / aspect;
      const ang = Math.atan2(dy, dx);
      const q = ((Math.round(ang / (Math.PI / 4)) % 4) + 4) % 4;
      const ch = m > 0.9 ? "=" : DIRS[q];
      put(f, i, j, m > 0.94 ? "*" : ch, m > 0.88);
    }
  }
  return finish(f);
}

export function plasmaFrame(cols, rows, t, { aspect }) {
  const f = frameOf(cols, rows);
  const cx = cols / 2 + Math.sin(t * 0.4) * cols * 0.2;
  const cy = (rows * aspect) / 2 + Math.cos(t * 0.33) * rows * aspect * 0.2;
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const x = i;
      const y = j * aspect;
      const v = (Math.sin(x * 0.09 + t) + Math.sin(y * 0.07 - t * 0.8) + Math.sin(Math.hypot(x - cx, y - cy) * 0.12 - t * 1.4) + Math.sin((x - y) * 0.045 + t * 0.5) + 4) / 8;
      const d = BAYER[(j % 4) * 4 + (i % 4)];
      const scaled = v * (DITHER.length - 1);
      const base = Math.floor(scaled);
      const k = Math.min(DITHER.length - 1, base + (scaled - base > d ? 1 : 0));
      if (k > 0) put(f, i, j, DITHER[k], k === DITHER.length - 1);
    }
  }
  return finish(f);
}

export function createSpectrum(bars) {
  const level = new Float32Array(bars);
  const peak = new Float32Array(bars);
  const hold = new Float32Array(bars);
  return {
    step(t, dt) {
      const beat = (t * 2) % 1;
      const kick = Math.exp(-beat * 5);
      for (let b = 0; b < bars; b += 1) {
        const x = b / Math.max(1, bars - 1);
        const shape = 1 - 0.4 * x;
        const wob = 0.5 + 0.5 * Math.sin(t * (2.1 + hash(b) * 3) + b * 0.9) * Math.sin(t * 0.7 + hash(b + 9) * 6);
        const target = Math.min(1, shape * (0.32 + 0.6 * wob) + kick * (1 - x * 0.6) * 0.4 + hash(b + Math.floor(t * 12)) * 0.1);
        level[b] += (target - level[b]) * (target > level[b] ? 0.6 : 0.18);
        if (level[b] >= peak[b]) {
          peak[b] = level[b];
          hold[b] = 0.35;
        } else if (hold[b] > 0) hold[b] -= dt;
        else peak[b] = Math.max(level[b], peak[b] - dt * 0.6);
      }
    },
    frame(cols, rows) {
      const f = frameOf(cols, rows);
      for (let b = 0; b < bars; b += 1) {
        const i = b * 2;
        if (i >= cols) break;
        const h = level[b] * rows;
        const top = Math.floor(h);
        for (let j = 0; j < rows; j += 1) {
          const fromBottom = rows - 1 - j;
          if (fromBottom < top) put(f, i, j, "|", false);
          else if (fromBottom === top && h - top > 0.5) put(f, i, j, ":", false);
        }
        const pj = rows - 1 - Math.min(rows - 1, Math.floor(peak[b] * rows));
        if (peak[b] > 0.04) put(f, i, pj, "=", true);
      }
      return finish(f);
    },
  };
}

export function createRain(columns, rows, seed = 1) {
  const streams = columns.map((col, k) => ({ col, y: -hash(k + seed) * rows * 2, speed: 4 + hash(k * 3 + seed) * 7, len: 4 + Math.floor(hash(k * 7 + seed) * 8), id: k }));
  return {
    step(dt) {
      for (const s of streams) {
        s.y += s.speed * dt;
        if (s.y - s.len > rows + 2) {
          s.id += streams.length;
          s.y = -hash(s.id + seed) * rows;
          s.speed = 4 + hash(s.id * 3 + seed) * 7;
          s.len = 4 + Math.floor(hash(s.id * 7 + seed) * 8);
        }
      }
    },
    cells(t) {
      const out = [];
      const tick = Math.floor(t * 6);
      for (const s of streams) {
        const head = Math.floor(s.y);
        for (let k = 0; k < s.len; k += 1) {
          const row = head - k;
          if (row < 0 || row >= rows) continue;
          const digit = Math.floor(hash(s.col * 31 + row * 7 + (k === 0 ? tick : Math.floor(tick / 4)) + s.id) * 10);
          out.push({ col: s.col, row, ch: String(digit), lit: k === 0 });
        }
      }
      return out;
    },
  };
}
