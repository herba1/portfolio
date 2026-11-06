import { createStage, clamp } from "../_kit/stage";
import { loadCover } from "../_kit/covers";

// A pin screen. Each pin has a height; the head is drawn out toward the
// viewer by parallax (further from the centre of view, further it shifts),
// lit from the upper left, with its shaft and its shadow on the board.
// A sleeve's tones press through from behind as relief; the hand pushes too.

const FACES = ["with-the-beatles", "let-it-be", "a-hard-days-night", "help", "rubber-soul"];
const BUCKETS = 10;

function sprite(d, tone) {
  const c = document.createElement("canvas");
  const s = Math.ceil(d * 2);
  c.width = s;
  c.height = s;
  const g = c.getContext("2d");
  const r = s / 2;
  const gr = g.createRadialGradient(r * 0.7, r * 0.62, r * 0.05, r, r, r * 0.98);
  gr.addColorStop(0, `rgb(${255 * tone},${250 * tone},${240 * tone})`);
  gr.addColorStop(0.25, `rgb(${190 * tone},${188 * tone},${182 * tone})`);
  gr.addColorStop(0.7, `rgb(${92 * tone},${92 * tone},${92 * tone})`);
  gr.addColorStop(1, `rgb(${28 * tone},${28 * tone},${30 * tone})`);
  g.fillStyle = gr;
  g.beginPath();
  g.arc(r, r, r * 0.96, 0, Math.PI * 2);
  g.fill();
  return c;
}

export async function createPins(host) {
  const stage = createStage(host, { dpr: 1.5 });
  const g = stage.ctx;

  let cols = 0;
  let rows = 0;
  let sp = 8;
  let ox = 0;
  let oy = 0;
  let field = 0;
  let h = new Float32Array(0); // current
  let v = new Float32Array(0); // velocity
  let push = new Float32Array(0); // what is pressing from behind now
  let relief = new Float32Array(0);
  const sprites = [];

  const reliefFrom = async (id) => {
    const img = await loadCover(id);
    const c = document.createElement("canvas");
    c.width = cols;
    c.height = rows;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.filter = "blur(0.6px)";
    x.drawImage(img, 0, 0, cols, rows);
    const d = x.getImageData(0, 0, cols, rows).data;
    const out = new Float32Array(cols * rows);
    for (let i = 0; i < out.length; i++) {
      const l = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
      out[i] = Math.pow(l, 1.25);
    }
    return out;
  };

  let faceIndex = 0;
  let wave = null; // { x, y, t, relief }
  const pressFace = async (x, y) => {
    const r = await reliefFrom(FACES[faceIndex % FACES.length]);
    faceIndex++;
    wave = { x, y, t: 0, relief: r };
  };

  stage.onResize((w, hgt) => {
    field = Math.min(w * 0.84, hgt * 0.84);
    sp = clamp(Math.round(field / 92), 6, 10);
    cols = Math.floor(field / sp);
    rows = cols;
    ox = (w - cols * sp) / 2 + sp / 2;
    oy = (hgt - rows * sp) / 2 + sp / 2;
    h = new Float32Array(cols * rows);
    v = new Float32Array(cols * rows);
    push = new Float32Array(cols * rows);
    relief = new Float32Array(cols * rows);
    sprites.length = 0;
    for (let b = 0; b < BUCKETS; b++) sprites.push(sprite(sp * 0.5, 0.62 + 0.5 * (b / (BUCKETS - 1))));
    pressFace(cols / 2, rows / 2);
  });

  // The hand: a soft fingertip pressing from behind.
  const finger = (cx, cy, depth, R) => {
    const r = Math.ceil(R + 1);
    for (let j = Math.max(0, Math.floor(cy - r)); j < Math.min(rows, cy + r); j++)
      for (let i = Math.max(0, Math.floor(cx - r)); i < Math.min(cols, cx + r); i++) {
        const d = Math.hypot(i - cx, j - cy) / R;
        if (d >= 1) continue;
        const p = depth * Math.sqrt(1 - d * d);
        const k = j * cols + i;
        if (p > push[k]) push[k] = p;
      }
  };
  let lastFinger = null;
  let downAt = 0;
  stage.on("down", (p) => {
    downAt = performance.now();
    lastFinger = [(p.x - ox) / sp, (p.y - oy) / sp];
  });
  stage.on("up", (p) => {
    if (performance.now() - downAt < 220) pressFace((p.x - ox) / sp, (p.y - oy) / sp);
    lastFinger = null;
  });

  const MAXH = 1;
  let idle = 0;

  stage.onFrame((dt) => {
    const W = stage.width;
    const H = stage.height;
    push.fill(0);

    // The face pressing through: a ring that runs out from where it started,
    // holds, then lets go.
    if (wave) {
      wave.t += dt;
      const front = wave.t * cols * 0.9;
      const release = wave.t > 3.4;
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++) {
          const d = Math.hypot(i - wave.x, j - wave.y);
          const k = j * cols + i;
          const on = clamp((front - d) / 6, 0, 1);
          if (!release) push[k] = Math.max(push[k], wave.relief[k] * 0.9 * on);
        }
      relief = wave.relief;
      if (release) wave = null;
    }
    // The hand pushes along its whole path since the last frame.
    if (stage.pointer.down && lastFinger) {
      const cur = [(stage.pointer.x - ox) / sp, (stage.pointer.y - oy) / sp];
      const steps = Math.max(1, Math.ceil(Math.hypot(cur[0] - lastFinger[0], cur[1] - lastFinger[1]) / 1.5));
      const held = Math.min(1, (performance.now() - downAt) / 300);
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        finger(lastFinger[0] + (cur[0] - lastFinger[0]) * t, lastFinger[1] + (cur[1] - lastFinger[1]) * t, 0.75 + 0.25 * held, 5.5);
      }
      lastFinger = cur;
    }

    // Pins: pushed out at once, they keep their place by friction and creep
    // back flat when nothing holds them.
    for (let k = 0; k < h.length; k++) {
      if (push[k] > h[k]) {
        v[k] += (push[k] - h[k]) * 60 * dt;
        v[k] *= 0.82;
      } else {
        v[k] -= 0.12 * dt;
        v[k] *= 0.9;
      }
      h[k] = clamp(h[k] + v[k] * dt * 8, 0, MAXH);
      if (h[k] <= 0) v[k] = 0;
    }

    // Board.
    const d = stage.dpr;
    g.setTransform(d, 0, 0, d, 0, 0);
    const bg = g.createRadialGradient(W * 0.35, H * 0.25, 0, W / 2, H / 2, Math.max(W, H) * 0.8);
    bg.addColorStop(0, "#2b2a28");
    bg.addColorStop(1, "#121110");
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    // Frame.
    const fx = ox - sp;
    const fy = oy - sp;
    const fw = cols * sp + sp;
    g.fillStyle = "#0b0b0b";
    g.fillRect(fx, fy, fw, fw);
    g.strokeStyle = "rgba(255,255,255,0.08)";
    g.lineWidth = 1;
    g.strokeRect(fx + 0.5, fy + 0.5, fw - 1, fw - 1);

    // Parallax: the eye sits over the centre of the screen.
    const cx = W / 2;
    const cy = H / 2;
    const lift = sp * 5.2;
    const par = 0.0022;
    const R = sp * 0.42;
    const shadows = [];
    const shafts = [];
    const heads = [];
    for (let b = 0; b < BUCKETS; b++) {
      shadows.push([]);
      shafts.push([]);
      heads.push([]);
    }
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        const hh = h[k];
        const bx = ox + i * sp;
        const by = oy + j * sp;
        const z = hh * lift;
        const hx = bx + (bx - cx) * par * z - z * 0.18;
        const hy = by + (by - cy) * par * z - z * 0.32;
        const b = Math.min(BUCKETS - 1, Math.floor(hh * BUCKETS * 0.999));
        heads[b].push(hx, hy);
        if (hh > 0.02) {
          shafts[b].push(bx, by, hx, hy);
          shadows[b].push(bx + z * 0.35, by + z * 0.5, z);
        }
      }
    // Shadows on the board, all at once.
    g.fillStyle = "rgba(0,0,0,0.38)";
    g.beginPath();
    for (let b = 0; b < BUCKETS; b++) {
      const s = shadows[b];
      for (let q = 0; q < s.length; q += 3) {
        g.moveTo(s[q] + R, s[q + 1]);
        g.arc(s[q], s[q + 1], R * (1 + s[q + 2] * 0.02), 0, Math.PI * 2);
      }
    }
    g.fill();
    // Back to front by height: shafts then heads.
    for (let b = 0; b < BUCKETS; b++) {
      const sh = shafts[b];
      if (sh.length) {
        g.strokeStyle = `rgba(${120 + b * 9},${118 + b * 9},${112 + b * 9},0.9)`;
        g.lineWidth = Math.max(1, sp * 0.16);
        g.beginPath();
        for (let q = 0; q < sh.length; q += 4) {
          g.moveTo(sh[q], sh[q + 1]);
          g.lineTo(sh[q + 2], sh[q + 3]);
        }
        g.stroke();
      }
      const hd = heads[b];
      const spr = sprites[b];
      const s = spr.width * 0.9;
      for (let q = 0; q < hd.length; q += 2) g.drawImage(spr, hd[q] - s / 2, hd[q + 1] - s / 2, s, s);
    }

    // Idle: another face presses through now and then.
    if (!stage.pointer.down && stage.idleFor() > 5000 && !wave) {
      idle += dt;
      if (idle > 3) {
        idle = 0;
        pressFace(cols * (0.3 + Math.random() * 0.4), rows * (0.3 + Math.random() * 0.4));
      }
    }
  });

  return { destroy: () => stage.destroy() };
}
