import { createStage, clamp } from "../_kit/stage";
import { loadCover } from "../_kit/covers";

// Venetian blinds: each slat carries a strip of one sleeve on its front and
// the next sleeve on its back. Slat angles are a chain of springs, so a drag
// sets the slat under the hand turning and the turn travels down the blind.
// A low sun sits behind: as slats open, bars of light come through the gaps.

const ORDER = ["abbey-road", "sgt-pepper", "revolver", "help", "rubber-soul", "let-it-be", "magical-mystery-tour"];

const c0 = Math.cos;

export async function createBlinds(host) {
  // ?v= picks a factory variant to compare (r1 is the round 1 parent).
  const V = new URLSearchParams(location.search).get("v") ?? "b";
  const craft = V.includes("a") || V.includes("b");
  const peekMode = V.includes("b");
  const stage = createStage(host, { dpr: 1.5 });
  const g = stage.ctx;
  let idx = 0;
  let front = await loadCover(ORDER[0]);
  let back = await loadCover(ORDER[1]);
  loadCover(ORDER[2]);

  let count = 22;
  let size = 300;
  let x0 = 0;
  let y0 = 0;
  let pitch = 10;
  let ang = new Float32Array(count); // radians: 0 shows front, PI shows back
  let vel = new Float32Array(count);
  let goal = new Float32Array(count);

  stage.onResize((w, h) => {
    size = Math.min(w * 0.6, h * 0.8, 600);
    count = Math.round(size / 22);
    pitch = size / count;
    x0 = (w - size) / 2;
    y0 = (h - size) / 2;
    ang = new Float32Array(count);
    vel = new Float32Array(count);
    goal = new Float32Array(count);
  });

  let grab = null; // { slat, y, base }
  // Peek: two fingers parting the slats where you press.
  const peek = { x: 0, y: 0, gap: 0, v: 0, on: false };
  let pressXY = null;
  stage.on("down", (p) => {
    const s = clamp(Math.floor((p.y - y0) / pitch), 0, count - 1);
    if (peekMode) {
      pressXY = [p.x, p.y];
      peek.on = true;
      peek.x = p.x;
      peek.y = p.y;
      return;
    }
    grab = { slat: s, y: p.y, base: ang[s], last: p.y };
  });
  stage.on("move", (p) => {
    if (!peekMode || !p.down || !pressXY) return;
    if (peek.on && Math.abs(p.y - pressXY[1]) > 70 && Math.abs(p.vy) > 500) {
      // A hard vertical pull turns into a tilt.
      peek.on = false;
      const s = clamp(Math.floor((pressXY[1] - y0) / pitch), 0, count - 1);
      grab = { slat: s, y: pressXY[1], base: ang[s], last: p.y };
    }
  });
  stage.on("up", (p) => {
    peek.on = false;
    pressXY = null;
    if (!grab) return;
    // Fling: carry the hand's speed into the slats and let them settle on
    // the nearest face.
    const spin = p.vy * 0.004;
    for (let i = 0; i < count; i++) vel[i] += spin * Math.exp(-Math.abs(i - grab.slat) * 0.08);
    grab = null;
  });

  let auto = 0;

  stage.onFrame((dt, t) => {
    const W = stage.width;
    const H = stage.height;
    const p = stage.pointer;
    // The slat under the hand follows the drag directly; its neighbours are
    // pulled along by springs between angles (that is the travelling wave).
    if (grab && p.down) {
      const a = grab.base + ((p.y - grab.y) / pitch) * 0.22;
      ang[grab.slat] = a;
      vel[grab.slat] = 0;
    }
    if (peekMode) {
      if (peek.on) {
        peek.x += (p.x - peek.x) * Math.min(1, dt * 18);
        peek.y += (p.y - peek.y) * Math.min(1, dt * 18);
      }
      const want = peek.on ? pitch * 3.4 : 0;
      peek.v += ((want - peek.gap) * 140 - peek.v * (peek.on ? 16 : 7)) * dt;
      peek.gap = Math.max(-pitch * 0.4, peek.gap + peek.v * dt);
    }
    const sub = 3;
    const h = dt / sub;
    for (let s = 0; s < sub; s++) {
      for (let i = 0; i < count; i++) {
        if (grab && p.down && i === grab.slat) continue;
        let f = 0;
        if (i > 0) f += (ang[i - 1] - ang[i]) * 180;
        if (i < count - 1) f += (ang[i + 1] - ang[i]) * 180;
        // Detents: a slat likes to rest face-on (front or back) or open.
        if (!grab) {
          const rest = Math.round(ang[i] / (Math.PI / 2)) * (Math.PI / 2);
          f += (rest - ang[i]) * 14;
        }
        vel[i] += (f - vel[i] * 7) * h;
      }
      for (let i = 0; i < count; i++) if (!(grab && p.down && i === grab.slat)) ang[i] += vel[i] * h;
    }
    // When every slat shows the back, the back becomes the front.
    let all = true;
    for (let i = 0; i < count; i++) if (Math.abs(((ang[i] % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI) > 0.08) all = false;
    if (all && !grab) {
      for (let i = 0; i < count; i++) ang[i] -= Math.PI;
      idx = (idx + 1) % ORDER.length;
      front = back;
      loadCover(ORDER[(idx + 1) % ORDER.length]).then((im) => (back = im));
      loadCover(ORDER[(idx + 2) % ORDER.length]);
    }
    // Idle: a draught nudges the blind.
    if (!p.down && stage.idleFor() > 5000) {
      auto += dt;
      if (auto > 4) {
        auto = 0;
        const s = Math.floor(Math.random() * 4);
        vel[s] += 9 + Math.random() * 6;
      }
    }

    // Draw.
    const d = stage.dpr;
    g.setTransform(d, 0, 0, d, 0, 0);
    // The window behind: a bright, warm sky.
    const sky = g.createLinearGradient(0, y0, 0, y0 + size);
    sky.addColorStop(0, "#fff6e4");
    sky.addColorStop(1, "#ffd9a6");
    // Room.
    g.fillStyle = "#16130f";
    g.fillRect(0, 0, W, H);
    // Light falling into the room through open slats.
    g.save();
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < count; i++) {
      const open = Math.abs(Math.sin(ang[i]));
      if (open < 0.05) continue;
      const y = y0 + i * pitch + pitch / 2;
      const gr = g.createLinearGradient(0, y, 0, y + H * 0.5);
      gr.addColorStop(0, `rgba(255, 210, 150, ${0.08 * open})`);
      gr.addColorStop(1, "rgba(255, 210, 150, 0)");
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x0 + size, y);
      g.lineTo(x0 + size + H * 0.25, y + H * 0.5);
      g.lineTo(x0 + H * 0.25, y + H * 0.5);
      g.closePath();
      g.fill();
    }
    g.restore();
    // Window frame and sky.
    g.fillStyle = "#0c0a08";
    g.fillRect(x0 - 10, y0 - 10, size + 20, size + 20);
    g.fillStyle = sky;
    g.fillRect(x0, y0, size, size);
    if (peekMode) {
      // Outside the window: the next record, overexposed in the sun.
      g.save();
      g.drawImage(back, x0, y0, size, size);
      g.globalCompositeOperation = "screen";
      g.fillStyle = "rgba(255, 228, 190, 0.16)";
      g.fillRect(x0, y0, size, size);
      g.restore();
    }

    for (let i = 0; i < count; i++) {
      const a = ang[i];
      const c = Math.cos(a);
      const sN = Math.sin(a);
      const hh = pitch * 1.04 * Math.abs(c);
      const cy = y0 + i * pitch + pitch / 2;
      const showBack = c < 0;
      const img = showBack ? back : front;
      // Slat face, squashed by its tilt. The back is upside down as it turns.
      // Only slats near the fingers bend; the rest draw in one piece.
      const near = Math.abs(cy - peek.y) < pitch * 7;
      const COLS = peekMode && near && Math.abs(peek.gap) > 0.3 ? 28 : 1;
      const cw = size / COLS;
      const sigma = size * 0.13;
      const rowFall = (cy - peek.y) / (pitch * 2.4);
      const side = Math.sign(cy - peek.y) || 1;
      const lift = peekMode ? peek.gap * side * Math.exp(-rowFall * rowFall) : 0;
      for (let c = 0; c < COLS; c++) {
        const cx0 = x0 + c * cw;
        const mid = cx0 + cw / 2;
        const bend = COLS > 1 ? lift * Math.exp(-((mid - peek.x) ** 2) / (2 * sigma * sigma)) : 0;
        g.save();
        g.beginPath();
        g.rect(cx0 - 0.3, cy - hh / 2 + bend, cw + 0.6, Math.max(0.5, hh));
        g.clip();
        g.translate(x0, cy + bend);
        g.scale(1, Math.max(0.001, Math.abs(c0(a))) * (showBack ? -1 : 1));
        const sy = (i / count) * img.height;
        const sh = img.height / count;
        g.drawImage(img, 0, sy, img.width, sh, 0, -pitch * 0.52, size, pitch * 1.04);
        g.restore();
        if (craft) {
          // A slat is curved: brighter along its crown, darker at its lips.
          const tilt = Math.abs(c0(a));
          const gr = g.createLinearGradient(0, cy - hh / 2 + bend, 0, cy + hh / 2 + bend);
          gr.addColorStop(0, `rgba(0,0,0,${0.22 * tilt})`);
          gr.addColorStop(0.45, "rgba(255,250,240,0.10)");
          gr.addColorStop(1, `rgba(0,0,0,${0.3 * tilt})`);
          g.fillStyle = gr;
          g.fillRect(cx0, cy - hh / 2 + bend, cw + 0.5, hh);
          if (Math.abs(bend) > 1) {
            // Bent slats twist toward the light.
            g.fillStyle = `rgba(255, 240, 210, ${Math.min(0.35, Math.abs(bend) / (pitch * 8))})`;
            g.fillRect(cx0, cy - hh / 2 + bend, cw + 0.5, hh);
          }
        }
      }
      if (peekMode && Math.abs(peek.gap) > 2 && i === count - 1) {
        g.save();
        g.globalCompositeOperation = "lighter";
        const r = g.createRadialGradient(peek.x, peek.y, 0, peek.x, peek.y, size * 0.35);
        r.addColorStop(0, `rgba(255, 220, 170, ${Math.min(0.22, peek.gap / pitch * 0.06)})`);
        r.addColorStop(1, "rgba(255, 220, 170, 0)");
        g.fillStyle = r;
        g.fillRect(peek.x - size * 0.35, peek.y - size * 0.35, size * 0.7, size * 0.7);
        g.restore();
      }
      // Light: lit by the room when facing us, by the sky when tipped toward it.
      const tip = sN * (showBack ? -1 : 1);
      const shade = 0.42 * (1 - Math.abs(c)) + Math.max(0, -tip) * 0.18;
      if (shade > 0.01) {
        g.fillStyle = `rgba(10,8,6,${shade})`;
        g.fillRect(x0, cy - hh / 2, size, hh);
      }
      const glow = Math.max(0, tip) * (1 - Math.abs(c)) * 0.5;
      if (glow > 0.01) {
        g.fillStyle = `rgba(255,236,200,${glow})`;
        g.fillRect(x0, cy - hh / 2, size, hh);
      }
      // A bright lip where the slat's curved edge catches the sun.
      g.fillStyle = `rgba(255, 245, 225, ${0.2 + 0.4 * Math.abs(sN)})`;
      g.fillRect(x0, cy + (sN > 0 ? -hh / 2 : hh / 2 - 1), size, 1);
    }
    // Ladder cords.
    g.strokeStyle = "rgba(230, 220, 200, 0.35)";
    g.lineWidth = 1;
    for (const fx of [0.12, 0.88]) {
      g.beginPath();
      g.moveTo(x0 + size * fx, y0);
      g.lineTo(x0 + size * fx, y0 + size);
      g.stroke();
    }
    void t;
  });

  return { destroy: () => stage.destroy() };
}
