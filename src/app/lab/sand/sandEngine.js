import { createStage, clamp } from "../_kit/stage";
import { loadCover } from "../_kit/covers";

// A tray of dyed sand on a grid: height and colour per cell. The rake's
// tines dig furrows and bank what they lift to either side, carrying its
// colour; slopes steeper than the angle of repose slump. Lit by a low sun.

const ORDER = ["sgt-pepper", "magical-mystery-tour", "rubber-soul", "help", "abbey-road", "revolver"];
const CELL = 2; // css px per cell
const TINES = 4;

export async function createSand(host) {
  const stage = createStage(host, { dpr: 1 });
  const g = stage.ctx;

  let n = 0; // cells per side
  let ox = 0;
  let oy = 0;
  let px = 0; // tray size in px
  let hgt = new Float32Array(0);
  let col = new Float32Array(0); // rgb
  let grain = new Float32Array(0);
  let img = null;
  let data = null;
  const buf = document.createElement("canvas");
  const bg2 = buf.getContext("2d");
  let coverIdx = 0;
  let nextCols = null;

  const sample = async (id) => {
    const im = await loadCover(id);
    const c = document.createElement("canvas");
    c.width = n;
    c.height = n;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(im, 0, 0, n, n);
    const d = x.getImageData(0, 0, n, n).data;
    const out = new Float32Array(n * n * 3);
    for (let i = 0; i < n * n; i++) {
      // Dyed sand is never as dark or as saturated as print.
      const r = d[i * 4] / 255;
      const gg = d[i * 4 + 1] / 255;
      const b = d[i * 4 + 2] / 255;
      const l = 0.3 * r + 0.59 * gg + 0.11 * b;
      out[i * 3] = 0.12 + 0.82 * (l + (r - l) * 0.85);
      out[i * 3 + 1] = 0.11 + 0.8 * (l + (gg - l) * 0.85);
      out[i * 3 + 2] = 0.1 + 0.78 * (l + (b - l) * 0.85);
    }
    return out;
  };

  const fill = async () => {
    const c = await sample(ORDER[coverIdx % ORDER.length]);
    col = c;
    for (let i = 0; i < n * n; i++) hgt[i] = 1 + (grain[i] - 0.5) * 0.04;
    nextCols = await sample(ORDER[(coverIdx + 1) % ORDER.length]);
  };

  let ready = false;
  stage.onResize(async (w, h) => {
    px = Math.floor(Math.min(w * 0.8, h * 0.84, 620));
    n = Math.floor(px / CELL);
    ox = Math.round((w - n * CELL) / 2);
    oy = Math.round((h - n * CELL) / 2);
    hgt = new Float32Array(n * n);
    grain = new Float32Array(n * n);
    for (let i = 0; i < grain.length; i++) grain[i] = Math.random();
    buf.width = n;
    buf.height = n;
    img = bg2.createImageData(n, n);
    data = img.data;
    ready = false;
    await fill();
    ready = true;
  });

  // Move `amt` of sand from cell a to cell b, mixing colour by mass.
  const move = (a, b, amt) => {
    if (amt <= 0) return;
    const hb = hgt[b];
    const t = amt / (hb + amt + 1e-6);
    col[b * 3] += (col[a * 3] - col[b * 3]) * t;
    col[b * 3 + 1] += (col[a * 3 + 1] - col[b * 3 + 1]) * t;
    col[b * 3 + 2] += (col[a * 3 + 2] - col[b * 3 + 2]) * t;
    hgt[a] -= amt;
    hgt[b] += amt;
  };

  // Dirty region for the slump pass.
  let dx0 = 0;
  let dy0 = 0;
  let dx1 = -1;
  let dy1 = -1;
  const dirty = (x, y, r) => {
    dx0 = Math.max(1, Math.min(dx0, Math.floor(x - r)));
    dy0 = Math.max(1, Math.min(dy0, Math.floor(y - r)));
    dx1 = Math.min(n - 2, Math.max(dx1, Math.ceil(x + r)));
    dy1 = Math.min(n - 2, Math.max(dy1, Math.ceil(y + r)));
  };
  const clean = () => {
    dx0 = n;
    dy0 = n;
    dx1 = -1;
    dy1 = -1;
  };
  clean();

  // One tine at (x, y) in cells moving along unit (ux, uy).
  const tine = (x, y, ux, uy, r) => {
    const r2 = r * r;
    for (let j = Math.floor(y - r); j <= Math.ceil(y + r); j++)
      for (let i = Math.floor(x - r); i <= Math.ceil(x + r); i++) {
        if (i < 1 || j < 1 || i >= n - 1 || j >= n - 1) continue;
        const ddx = i - x;
        const ddy = j - y;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 > r2) continue;
        const k = j * n + i;
        const floor = 0.18 + 0.5 * (d2 / r2);
        const amt = (hgt[k] - floor) * 0.7;
        if (amt <= 0) continue;
        // Bank it to the side it sits on, a little ahead.
        const side = ddx * -uy + ddy * ux >= 0 ? 1 : -1;
        const tx = Math.round(x + -uy * side * (r + 1.2) + ux * 0.8);
        const ty = Math.round(y + ux * side * (r + 1.2) + uy * 0.8);
        if (tx < 1 || ty < 1 || tx >= n - 1 || ty >= n - 1) continue;
        move(k, ty * n + tx, amt);
      }
    dirty(x, y, r + 4);
  };

  let rake = null; // { x, y, ux, uy } in cells
  const rakeTo = (x, y) => {
    if (!rake) {
      rake = { x, y, ux: 1, uy: 0 };
      return;
    }
    const ddx = x - rake.x;
    const ddy = y - rake.y;
    const dist = Math.hypot(ddx, ddy);
    if (dist < 0.3) return;
    const steps = Math.ceil(dist / 0.7);
    for (let s = 1; s <= steps; s++) {
      const px2 = rake.x + (ddx * s) / steps;
      const py2 = rake.y + (ddy * s) / steps;
      // The head swings to face its travel, slowly, like a held rake.
      const ux = ddx / dist;
      const uy = ddy / dist;
      rake.ux += (ux - rake.ux) * 0.25;
      rake.uy += (uy - rake.uy) * 0.25;
      const l = Math.hypot(rake.ux, rake.uy) || 1;
      const nx = -rake.uy / l;
      const ny = rake.ux / l;
      for (let t = 0; t < TINES; t++) {
        const o = (t - (TINES - 1) / 2) * 7;
        tine(px2 + nx * o, py2 + ny * o, rake.ux / l, rake.uy / l, 2.2);
      }
    }
    rake.x = x;
    rake.y = y;
  };

  const pour = (x, y, dt) => {
    if (!nextCols) return;
    const r = 7;
    for (let q = 0; q < 140 * dt * 60; q++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * r;
      const i = Math.round(x + Math.cos(a) * d);
      const j = Math.round(y + Math.sin(a) * d);
      if (i < 1 || j < 1 || i >= n - 1 || j >= n - 1) continue;
      const k = j * n + i;
      const amt = 0.03;
      const t = amt / (hgt[k] + amt);
      col[k * 3] += (nextCols[k * 3] - col[k * 3]) * t * 1.6;
      col[k * 3 + 1] += (nextCols[k * 3 + 1] - col[k * 3 + 1]) * t * 1.6;
      col[k * 3 + 2] += (nextCols[k * 3 + 2] - col[k * 3 + 2]) * t * 1.6;
      hgt[k] += amt;
    }
    dirty(x, y, r + 10);
  };

  // Slump: sand steeper than repose slides to its lowest neighbour.
  const slump = () => {
    if (dx1 < dx0) return;
    const REPOSE = 0.22;
    let moved = false;
    for (let pass = 0; pass < 2; pass++)
      for (let j = dy0; j <= dy1; j++)
        for (let i = dx0; i <= dx1; i++) {
          const k = j * n + i;
          let lo = k;
          let lh = hgt[k];
          for (const o of [1, -1, n, -n]) if (hgt[k + o] < lh) {
            lh = hgt[k + o];
            lo = k + o;
          }
          const diff = hgt[k] - lh;
          if (diff > REPOSE) {
            move(k, lo, (diff - REPOSE) * 0.45);
            moved = true;
          }
        }
    if (!moved) clean();
  };

  let pourAt = null;
  let downAt = 0;
  let still = 0;
  stage.on("down", (p) => {
    rake = null;
    downAt = performance.now();
    still = 0;
    rakeTo((p.x - ox) / CELL, (p.y - oy) / CELL);
  });
  stage.on("up", () => {
    rake = null;
    pourAt = null;
  });

  // Idle: an unseen hand rakes slow arcs.
  let autoT = 0;
  let autoPath = null;

  const SUN = [-0.62, -0.5, 0.6];
  const sl = Math.hypot(...SUN);
  const L = SUN.map((v) => v / sl);

  stage.onFrame((dt, t) => {
    if (!ready) return;
    const p = stage.pointer;
    if (p.down) {
      const x = (p.x - ox) / CELL;
      const y = (p.y - oy) / CELL;
      const sp = Math.hypot(p.vx, p.vy);
      if (sp < 30 && performance.now() - downAt > 350) {
        still += dt;
        if (still > 0.15) pourAt = [x, y];
      } else {
        still = 0;
        pourAt = null;
      }
      if (pourAt) pour(pourAt[0], pourAt[1], dt);
      else rakeTo(x, y);
    } else if (stage.idleFor() > 5000) {
      autoT += dt;
      if (!autoPath) {
        const y0 = n * (0.2 + Math.random() * 0.6);
        autoPath = { y0, dir: Math.random() < 0.5 ? 1 : -1, t: 0 };
        rake = null;
      }
      autoPath.t += dt / 3.2;
      const u = autoPath.t;
      const x = n * (autoPath.dir > 0 ? 0.12 + 0.76 * u : 0.88 - 0.76 * u);
      const y = autoPath.y0 + Math.sin(u * Math.PI * 1.5) * n * 0.1;
      rakeTo(x, y);
      if (u >= 1) {
        autoPath = null;
        rake = null;
      }
    }
    slump();
    void t;

    // Render: raking light from the slope, grain, a sparkle now and then.
    const S = 3.2;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const hL = hgt[i > 0 ? k - 1 : k];
        const hR = hgt[i < n - 1 ? k + 1 : k];
        const hU = hgt[j > 0 ? k - n : k];
        const hD = hgt[j < n - 1 ? k + n : k];
        const nx = (hL - hR) * S;
        const ny = (hU - hD) * S;
        const nl = Math.hypot(nx, ny, 1);
        let lit = (nx * L[0] + ny * L[1] + L[2]) / nl;
        lit = 0.32 + 0.95 * Math.max(0, lit);
        const gr = 0.9 + grain[k] * 0.2;
        // Thin sand shows the tray beneath.
        const cover = clamp(hgt[k] / 0.35, 0, 1);
        const tray = 0.16;
        let r = (col[k * 3] * cover + tray * 1.05 * (1 - cover)) * lit * gr;
        let gg = (col[k * 3 + 1] * cover + tray * 0.8 * (1 - cover)) * lit * gr;
        let b = (col[k * 3 + 2] * cover + tray * 0.6 * (1 - cover)) * lit * gr;
        if (grain[k] > 0.996 && lit > 1.05) {
          r += 0.35;
          gg += 0.33;
          b += 0.3;
        }
        const o = k * 4;
        data[o] = clamp(r, 0, 1) * 255;
        data[o + 1] = clamp(gg, 0, 1) * 255;
        data[o + 2] = clamp(b, 0, 1) * 255;
        data[o + 3] = 255;
      }
    bg2.putImageData(img, 0, 0);
    const W = stage.width;
    const H = stage.height;
    g.setTransform(1, 0, 0, 1, 0, 0);
    const room = g.createLinearGradient(0, 0, W, H);
    room.addColorStop(0, "#3a3530");
    room.addColorStop(1, "#1a1715");
    g.fillStyle = room;
    g.fillRect(0, 0, W, H);
    // Tray: a wooden lip and its shadow.
    g.save();
    g.shadowColor = "rgba(0,0,0,0.5)";
    g.shadowBlur = 40;
    g.shadowOffsetX = 18;
    g.shadowOffsetY = 22;
    g.fillStyle = "#4a3624";
    g.fillRect(ox - 14, oy - 14, n * CELL + 28, n * CELL + 28);
    g.restore();
    g.fillStyle = "#5c4430";
    g.fillRect(ox - 14, oy - 14, n * CELL + 28, 3);
    g.imageSmoothingEnabled = true;
    g.drawImage(buf, ox, oy, n * CELL, n * CELL);
    // The lip casts a short shadow onto the sand on the sunny side's far edge.
    const sh = g.createLinearGradient(ox, oy, ox + 24, oy + 24);
    sh.addColorStop(0, "rgba(0,0,0,0.35)");
    sh.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = sh;
    g.fillRect(ox, oy, n * CELL, 14);
    g.fillRect(ox, oy, 14, n * CELL);
  });

  return { destroy: () => stage.destroy() };
}
