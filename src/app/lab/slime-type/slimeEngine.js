export const WORD = "grow";

const TEXTURE = ["  ``^@", " ..„v0"];
const SOFT = ".`„";
const SENS_ANGLE = (45 * Math.PI) / 180;
const SENS_DIST = 9;
const TURN = (45 * Math.PI) / 180;
const DECAY = 0.9;
const DECAY_OUT = 0.8;
const FLOOR = 0.66;
const OUTSIDE = 0.62;
const MIN_CHEM = 0.0001;
const BIAS = 1.1;
const STEER = 0.22;
const KEEP = 0.94;
const CYCLE = 1680;
const SCATTER_AT = 1080;
const SCATTER_LEN = 90;
const PRESIM = 130;
const PAPER = "#efebe1";
const INK = "#1f1c17";
const INK_SOFT = "#857e70";
const CELLS_PER_CHAR = 3.2;
const CELLS_PER_CHAR_NARROW = 3.6;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    let acc = 0;
    for (let x = -r; x <= r; x += 1) acc += src[row + clamp(x, 0, w - 1)];
    for (let x = 0; x < w; x += 1) {
      tmp[row + x] = acc / (2 * r + 1);
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x += 1) {
    let acc = 0;
    for (let y = -r; y <= r; y += 1) acc += tmp[clamp(y, 0, h - 1) * w + x];
    for (let y = 0; y < h; y += 1) {
      out[y * w + x] = acc / (2 * r + 1);
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

export function createSlime(host, { canvas, onReady, insets }) {
  const ctx = canvas.getContext("2d");
  const mono = getComputedStyle(canvas).fontFamily || "monospace";
  const sans = getComputedStyle(host).fontFamily || "sans-serif";
  const state = {
    width: 1,
    height: 1,
    dpr: 1,
    fontPx: 15,
    charW: 9,
    lineH: 16,
    cols: 1,
    rows: 1,
    fw: 1,
    fh: 1,
    chem: new Float32Array(1),
    wip: new Float32Array(1),
    lure: new Float32Array(1),
    bias: new Float32Array(1),
    decay: new Float32Array(1),
    pull: new Float32Array(1),
    lureCells: [],
    sens: SENS_DIST,
    wallTop: 0,
    clipTop: 0,
    wallBot: 1,
    ax: new Float32Array(1),
    ay: new Float32Array(1),
    ad: new Float32Array(1),
    count: 0,
    live: 0,
    view: { sx: 1, fx: 0.5, fy: 0.5 },
    fitScale: 1,
    hold: null,
    hard: [],
    soft: [],
    raf: 0,
    last: 0,
    acc: 0,
    visible: true,
    destroyed: false,
    ready: false,
    laidOut: false,
    reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };

  function buildLure() {
    const { fw, fh } = state;
    const c = document.createElement("canvas");
    c.width = fw;
    c.height = fh;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.fillStyle = "#000";
    g.fillRect(0, 0, fw, fh);
    const inset = insets?.() || { top: 120, bottom: 48 };
    const cellsPerPx = fh / state.height;
    state.clipTop = inset.top - 16;
    state.wallTop = Math.round(inset.top * cellsPerPx);
    state.wallBot = Math.round(fh - inset.bottom * cellsPerPx);
    const roomH = state.wallBot - state.wallTop;
    const stacked = state.height / state.width > 1.25;
    const lines = stacked ? [WORD.slice(0, 2), WORD.slice(2)] : [WORD];
    const lead = 0.95;
    const probe = 100;
    g.font = `700 ${probe}px ${sans}`;
    const pm = lines.map((t) => g.measureText(t));
    const pw = Math.max(...pm.map((m) => m.width));
    const ph = pm[0].actualBoundingBoxAscent + (lines.length - 1) * lead * probe + pm[pm.length - 1].actualBoundingBoxDescent;
    const fs = Math.min(((fw * (stacked ? 0.84 : 0.78)) / pw) * probe, ((roomH * 0.8) / ph) * probe);
    g.font = `700 ${fs}px ${sans}`;
    if ("letterSpacing" in g) g.letterSpacing = `${-0.043 * (fs - 12)}px`;
    const mm = lines.map((t) => g.measureText(t));
    const blockW = Math.max(...mm.map((m) => m.width));
    state.sens = clamp((SENS_DIST * blockW) / (stacked ? 260 : 355), 4.5, SENS_DIST);
    const asc = mm[0].actualBoundingBoxAscent;
    const blockH = asc + (lines.length - 1) * lead * fs + mm[mm.length - 1].actualBoundingBoxDescent;
    g.fillStyle = "#fff";
    g.textBaseline = "alphabetic";
    const top = state.wallTop + (roomH - blockH) / 2 + asc;
    lines.forEach((t, i) => g.fillText(t, (fw - blockW) / 2, top + i * lead * fs));
    const img = g.getImageData(0, 0, fw, fh).data;
    const lure = new Float32Array(fw * fh);
    const cells = [];
    for (let i = 0; i < fw * fh; i += 1) {
      lure[i] = img[i * 4] / 255;
      if (lure[i] > 0.5) cells.push(i);
    }
    const r = Math.max(6, Math.round(fw * 0.03));
    let scent = boxBlur(lure, fw, fh, r);
    scent = boxBlur(scent, fw, fh, r * 2);
    scent = boxBlur(scent, fw, fh, r * 4);
    let peak = 0;
    for (let i = 0; i < scent.length; i += 1) if (scent[i] > peak) peak = scent[i];
    const bias = new Float32Array(fw * fh);
    for (let i = 0; i < bias.length; i += 1) bias[i] = BIAS * (0.6 * lure[i] + 0.4 * Math.sqrt(scent[i] / (peak || 1)));
    const decay = new Float32Array(fw * fh);
    for (let i = 0; i < decay.length; i += 1) decay[i] = DECAY_OUT + (DECAY - DECAY_OUT) * lure[i];
    state.decay = decay;
    const pull = new Float32Array(fw * fh);
    for (let y = 0; y < fh; y += 1) {
      for (let x = 0; x < fw; x += 1) {
        const i = y * fw + x;
        const gx = scent[i + (x < fw - 1 ? 1 : 0)] - scent[i - (x > 0 ? 1 : 0)];
        const gy = scent[i + (y < fh - 1 ? fw : 0)] - scent[i - (y > 0 ? fw : 0)];
        pull[i] = gx === 0 && gy === 0 ? Math.atan2(fh / 2 - y, fw / 2 - x) : Math.atan2(gy, gx);
      }
    }
    state.lure = lure;
    state.bias = bias;
    state.pull = pull;
    state.lureCells = cells;
  }

  function seed() {
    const { fw, wallTop, wallBot } = state;
    const count = Math.round(fw * (wallBot - wallTop) * 0.034);
    state.count = count;
    state.ax = new Float32Array(count);
    state.ay = new Float32Array(count);
    state.ad = new Float32Array(count);
    const cells = state.lureCells;
    for (let i = 0; i < count; i += 1) {
      if (cells.length && Math.random() < 0.8) {
        const c = cells[(Math.random() * cells.length) | 0];
        state.ax[i] = (c % fw) + Math.random();
        state.ay[i] = Math.floor(c / fw) + Math.random();
      } else {
        state.ax[i] = Math.random() * fw;
        state.ay[i] = wallTop + Math.random() * (wallBot - wallTop - 0.01);
      }
      state.ad[i] = Math.random() * Math.PI * 2;
    }
  }

  function layout() {
    const narrow = state.width < 640;
    state.fontPx = narrow ? 12 : 15;
    ctx.font = `500 ${state.fontPx}px ${mono}`;
    state.charW = ctx.measureText("0").width;
    state.lineH = Math.round(state.fontPx * 1.08);
    state.cols = Math.ceil(state.width / state.charW);
    state.rows = Math.ceil(state.height / state.lineH);
    const aspect = state.lineH / state.charW;
    const cpc = narrow ? CELLS_PER_CHAR_NARROW : CELLS_PER_CHAR;
    state.fw = Math.max(40, Math.round(state.cols * cpc));
    state.fh = Math.max(40, Math.round(state.rows * cpc * aspect));
    state.chem = new Float32Array(state.fw * state.fh);
    state.wip = new Float32Array(state.fw * state.fh);
    state.fitScale = cpc;
    state.view = { sx: state.fitScale, fx: 0.5, fy: 0.5 };
    state.hard = new Array(state.cols).fill(" ");
    state.soft = new Array(state.cols).fill(" ");
    state.live = 0;
    buildLure();
    seed();
    for (let i = 0; i < PRESIM; i += 1) simulate(false);
  }

  function scattering() {
    if (state.reduced) return false;
    const p = state.live % CYCLE;
    return p >= SCATTER_AT && p < SCATTER_AT + SCATTER_LEN;
  }

  function simulate(live) {
    const { fw, fh, chem, wip, wallTop, wallBot, decay } = state;
    for (let y = 0; y < fh; y += 1) {
      const row = y * fw;
      const up = y > 0 ? row - fw : row;
      const dn = y < fh - 1 ? row + fw : row;
      for (let x = 0; x < fw; x += 1) {
        const l = x > 0 ? x - 1 : x;
        const r = x < fw - 1 ? x + 1 : x;
        const sum = chem[up + l] + chem[up + x] + chem[up + r] + chem[row + l] + chem[row + x] + chem[row + r] + chem[dn + l] + chem[dn + x] + chem[dn + r];
        let v = (decay[row + x] * sum) / 9;
        if (v < MIN_CHEM) v = 0;
        wip[row + x] = v > 1 ? 1 : v;
      }
    }
    state.chem = wip;
    state.wip = chem;
    const field = state.chem;
    const { bias, lure, pull } = state;
    if (live) state.live += 1;
    const scatter = live && scattering();
    const { ax, ay, ad, count, sens: sd } = state;
    const sense = (x, y) => {
      if (x < 0 || y < wallTop || x >= fw || y >= wallBot) return -1;
      const k = (y | 0) * fw + (x | 0);
      return scatter ? 1 - field[k] : field[k] + bias[k];
    };
    for (let i = 0; i < count; i += 1) {
      const d = ad[i];
      const x = ax[i];
      const y = ay[i];
      const f = sense(x + Math.cos(d) * sd, y + Math.sin(d) * sd);
      const lft = sense(x + Math.cos(d - SENS_ANGLE) * sd, y + Math.sin(d - SENS_ANGLE) * sd);
      const rgt = sense(x + Math.cos(d + SENS_ANGLE) * sd, y + Math.sin(d + SENS_ANGLE) * sd);
      let turn = 0;
      if (f > lft && f > rgt) turn = 0;
      else if (f < lft && f < rgt) turn = Math.random() < 0.5 ? -TURN : TURN;
      else if (lft < rgt) turn = TURN;
      else if (rgt < lft) turn = -TURN;
      else if (f < 0) turn = Math.PI / 2;
      let nd = d + turn;
      const here = (y | 0) * fw + (x | 0);
      if (!scatter && lure[here] <= 0.5 && Math.random() < STEER) {
        let diff = pull[here] - nd;
        diff -= Math.round(diff / (Math.PI * 2)) * Math.PI * 2;
        nd += clamp(diff, -TURN, TURN);
      }
      let nx = x + Math.cos(nd);
      let ny = y + Math.sin(nd);
      if (nx < 0 || ny < wallTop || nx >= fw || ny >= wallBot) {
        nd += Math.PI + (Math.random() - 0.5) * Math.PI * 0.6;
        nx = clamp(x, 0, fw - 0.01);
        ny = clamp(y, wallTop, wallBot - 0.01);
      } else if (!scatter && lure[here] > 0.5 && lure[(ny | 0) * fw + (nx | 0)] <= 0.5 && Math.random() < KEEP) {
        nd += Math.PI + (Math.random() - 0.5) * TURN;
        nx = x;
        ny = y;
      }
      ad[i] = nd;
      ax[i] = nx;
      ay[i] = ny;
    }
    for (let i = 0; i < count; i += 1) {
      const k = (ay[i] | 0) * fw + (ax[i] | 0);
      field[k] = Math.min(1, field[k] + 1);
    }
  }

  function scatterAt(px, py, vx, vy) {
    const { fw, chem, wallTop, wallBot } = state;
    const p = toField(px, py);
    const radius = Math.max(12, (state.fw * 0.05 * state.view.sx) / state.fitScale);
    const r2 = radius * radius;
    const x0 = Math.max(0, Math.floor(p[0] - radius));
    const x1 = Math.min(fw - 1, Math.ceil(p[0] + radius));
    const y0 = Math.max(wallTop, Math.floor(p[1] - radius));
    const y1 = Math.min(wallBot - 1, Math.ceil(p[1] + radius));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const d2 = (x - p[0]) ** 2 + (y - p[1]) ** 2;
        if (d2 < r2) chem[y * fw + x] *= d2 / r2;
      }
    }
    const { ax, ay, ad, count } = state;
    const sp = Math.hypot(vx, vy) || 1;
    for (let i = 0; i < count; i += 1) {
      const dx = ax[i] - p[0];
      const dy = ay[i] - p[1];
      const d2 = dx * dx + dy * dy;
      if (d2 > r2 * 2.2) continue;
      const dist = Math.sqrt(d2) + 0.01;
      const push = 1 - dist / Math.sqrt(r2 * 2.2);
      ad[i] = Math.atan2(dy + (vy / sp) * radius * 0.6, dx + (vx / sp) * radius * 0.6);
      ax[i] = clamp(ax[i] + (dx / dist) * push * radius * 0.5 + (vx / sp) * push * radius * 0.4, 0, fw - 0.01);
      ay[i] = clamp(ay[i] + (dy / dist) * push * radius * 0.5 + (vy / sp) * push * radius * 0.4, wallTop, wallBot - 0.01);
    }
  }

  function viewParams() {
    const { cols, rows, fw, fh, charW, lineH } = state;
    const sx = state.view.sx;
    const sy = sx * (lineH / charW);
    const ox = state.view.fx * (fw - sx * cols);
    const oy = state.view.fy * (fh - sy * rows);
    return { sx, sy, ox, oy };
  }

  function toField(px, py) {
    const { sx, sy, ox, oy } = viewParams();
    return [ox + (px / state.charW) * sx, oy + (py / state.lineH) * sy];
  }

  function draw() {
    const { width, height, dpr, cols, rows, fw, fh, lineH, hard, soft, lure } = state;
    const field = state.chem;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, width, height);
    ctx.font = `500 ${state.fontPx}px ${mono}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const { sx, sy, ox, oy } = viewParams();
    const len = TEXTURE[0].length - 1;
    for (let r = 0; r < rows; r += 1) {
      const fy0 = Math.floor(oy + r * sy);
      const fy1 = Math.floor(oy + (r + 1) * sy);
      if (fy0 < 0 || fy0 >= fh || r * lineH < state.clipTop) continue;
      const y1 = Math.max(fy0 + 1, Math.min(fh, fy1));
      let anyHard = false;
      let anySoft = false;
      for (let c = 0; c < cols; c += 1) {
        hard[c] = " ";
        soft[c] = " ";
        const fx0 = Math.floor(ox + c * sx);
        const fx1 = Math.floor(ox + (c + 1) * sx);
        if (fx0 < 0 || fx0 >= fw) continue;
        const x1 = Math.max(fx0 + 1, Math.min(fw, fx1));
        let max = 0;
        let sum = 0;
        let ls = 0;
        for (let y = fy0; y < y1; y += 1) {
          const row = y * fw;
          for (let x = fx0; x < x1; x += 1) {
            const v = field[row + x];
            ls += lure[row + x];
            sum += v;
            if (v > max) max = v;
          }
        }
        const n = (x1 - fx0) * (y1 - fy0);
        const inside = ls / n;
        const raw = Math.cbrt((sum / n + max) / 2) * (OUTSIDE + (1 - OUTSIDE) * inside);
        const val = Math.max(raw, FLOOR * inside * Math.min(1, (sum / n) * 24));
        const ch = TEXTURE[(c + r) % 2][Math.ceil(val * len)];
        if (ch === " ") continue;
        if (SOFT.includes(ch)) {
          soft[c] = ch;
          anySoft = true;
        } else {
          hard[c] = ch;
          anyHard = true;
        }
      }
      const ty = r * lineH + lineH / 2 + 0.5;
      if (anySoft) {
        ctx.fillStyle = INK_SOFT;
        ctx.fillText(soft.join(""), 0, ty);
      }
      if (anyHard) {
        ctx.fillStyle = INK;
        ctx.fillText(hard.join(""), 0, ty);
      }
    }
  }

  function step(now) {
    state.raf = 0;
    if (state.destroyed) return;
    const t = now / 1000;
    const dt = Math.min(0.05, Math.max(0.001, t - (state.last || t)));
    state.last = t;
    state.acc += dt;
    let ticks = 0;
    while (state.acc >= 1 / 60 && ticks < 2) {
      simulate(true);
      state.acc -= 1 / 60;
      ticks += 1;
    }
    if (state.acc > 0.1) state.acc = 0;
    const hold = state.hold;
    if (hold && !hold.on && !hold.swipe && now - hold.t0 > 170) {
      hold.on = true;
      host.setAttribute("data-magnified", "");
    }
    const on = Boolean(hold && hold.on);
    const lambda = state.reduced ? 40 : 6;
    state.view.sx = damp(state.view.sx, on ? 1 : state.fitScale, lambda, dt);
    state.view.fx = damp(state.view.fx, on ? clamp(hold.x / state.width, 0, 1) : 0.5, lambda, dt);
    state.view.fy = damp(state.view.fy, on ? clamp(hold.y / state.height, 0, 1) : 0.5, lambda, dt);
    draw();
    if (!state.ready) {
      state.ready = true;
      onReady?.();
    }
    if (state.visible) state.raf = requestAnimationFrame(step);
    else state.last = 0;
  }

  function frame() {
    if (state.destroyed || state.raf || !state.visible || !state.laidOut) return;
    state.raf = requestAnimationFrame(step);
  }

  function local(e) {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  function onDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const [x, y] = local(e);
    canvas.setPointerCapture?.(e.pointerId);
    state.hold = { id: e.pointerId, x, y, sx: x, sy: y, lx: x, ly: y, t0: performance.now(), on: false, swipe: false };
  }

  function onMove(e) {
    const h = state.hold;
    if (!h || h.id !== e.pointerId) return;
    const [x, y] = local(e);
    if (!h.on && !h.swipe && Math.hypot(x - h.sx, y - h.sy) > 12) {
      h.swipe = true;
      host.setAttribute("data-swiping", "");
    }
    if (h.swipe) {
      const dist = Math.hypot(x - h.lx, y - h.ly);
      const n = Math.max(1, Math.ceil(dist / 12));
      for (let s = 1; s <= n; s += 1) scatterAt(h.lx + ((x - h.lx) * s) / n, h.ly + ((y - h.ly) * s) / n, x - h.lx, y - h.ly);
      h.lx = x;
      h.ly = y;
    }
    h.x = x;
    h.y = y;
  }

  function onUp(e) {
    const h = state.hold;
    if (!h || h.id !== e.pointerId) return;
    state.hold = null;
    host.removeAttribute("data-magnified");
    host.removeAttribute("data-swiping");
  }

  function resize() {
    const r = host.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (state.laidOut && Math.abs(r.width - state.width) < 0.5 && Math.abs(r.height - state.height) < 0.5 && dpr === state.dpr) return;
    state.width = Math.max(1, r.width);
    state.height = Math.max(1, r.height);
    state.dpr = dpr;
    canvas.width = Math.round(state.width * dpr);
    canvas.height = Math.round(state.height * dpr);
    layout();
    state.laidOut = true;
    draw();
    frame();
  }

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("lostpointercapture", onUp);
  const ro = new ResizeObserver(() => resize());
  const io = new IntersectionObserver(([entry]) => {
    state.visible = entry.isIntersecting && document.visibilityState === "visible";
    frame();
  });
  const onVisibility = () => {
    state.visible = document.visibilityState === "visible";
    frame();
  };

  Promise.all([document.fonts.load(`500 15px ${mono}`, TEXTURE.join("")), document.fonts.load(`700 100px ${sans}`, WORD)])
    .catch(() => null)
    .then(() => {
      if (state.destroyed) return;
      ro.observe(host);
      io.observe(host);
      document.addEventListener("visibilitychange", onVisibility);
      resize();
    });

  return {
    magnify(on) {
      state.hold = on ? { id: -1, x: state.width / 2, y: state.height / 2, sx: 0, sy: 0, lx: 0, ly: 0, t0: 0, on: true, swipe: false } : null;
      if (on) host.setAttribute("data-magnified", "");
      else host.removeAttribute("data-magnified");
    },
    destroy() {
      state.destroyed = true;
      cancelAnimationFrame(state.raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("lostpointercapture", onUp);
    },
  };
}
