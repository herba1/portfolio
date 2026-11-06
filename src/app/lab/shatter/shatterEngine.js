import { createStage, clamp } from "../_kit/stage";
import { loadCover } from "../_kit/covers";

// A cover on a glass pane. A tap cracks it into rings and rays from the
// impact; each shard sits a hair out of register so the picture refracts
// along every crack. Shards knocked loose fall, tumble in 3D (a flip about
// their own axis drawn as a squash) and land on the floor.

const ORDER = ["revolver", "abbey-road", "sgt-pepper", "rubber-soul", "help", "let-it-be", "a-hard-days-night", "magical-mystery-tour"];

const rand = (a, b) => a + Math.random() * (b - a);

function clipPoly(poly, x0, y0, x1, y1) {
  const edges = [
    (p) => p[0] >= x0,
    (p) => p[0] <= x1,
    (p) => p[1] >= y0,
    (p) => p[1] <= y1,
  ];
  const cut = [
    (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])],
    (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])],
    (a, b) => [a[0] + ((b[0] - a[0]) * (y0 - a[1])) / (b[1] - a[1]), y0],
    (a, b) => [a[0] + ((b[0] - a[0]) * (y1 - a[1])) / (b[1] - a[1]), y1],
  ];
  let out = poly;
  for (let e = 0; e < 4; e++) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[i];
      const b = input[(i + 1) % input.length];
      const ia = edges[e](a);
      const ib = edges[e](b);
      if (ia) out.push(a);
      if (ia !== ib) out.push(cut[e](a, b));
    }
    if (!out.length) return out;
  }
  return out;
}

const area = (poly) => {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
};

const centroid = (poly) => {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p[0];
    y += p[1];
  }
  return [x / poly.length, y / poly.length];
};

const inside = (poly, x, y) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
};

// Rings and rays from the impact, each vertex jittered, clipped to the pane.
function crack(size, ix, iy) {
  const rays = Math.round(rand(13, 18));
  const angles = [];
  for (let i = 0; i < rays; i++) angles.push(((i + rand(-0.32, 0.32)) / rays) * Math.PI * 2);
  angles.sort((a, b) => a - b);
  const radii = [0];
  let r = size * rand(0.03, 0.045);
  while (r < size * 1.6) {
    radii.push(r);
    r *= rand(1.45, 1.85);
  }
  radii.push(size * 2);
  const pt = (a, j) => {
    if (j === 0) return [ix, iy];
    const jr = radii[j] * (j === radii.length - 1 ? 1 : rand(0.86, 1.14));
    const ja = angles[a % rays] + (j === radii.length - 1 ? 0 : rand(-0.05, 0.05));
    return [ix + Math.cos(ja) * jr, iy + Math.sin(ja) * jr];
  };
  // Shared vertices so neighbouring shards meet exactly.
  const grid = [];
  for (let a = 0; a < rays; a++) {
    grid.push([]);
    for (let j = 0; j < radii.length; j++) grid[a].push(pt(a, j));
  }
  const shards = [];
  for (let a = 0; a < rays; a++) {
    const b = (a + 1) % rays;
    for (let j = 0; j < radii.length - 1; j++) {
      const poly = j === 0 ? [grid[a][0], grid[a][1], grid[b][1]] : [grid[a][j], grid[a][j + 1], grid[b][j + 1], grid[b][j]];
      // Long outer shards split once more along the ray.
      const pieces = [];
      if (j > 1 && Math.random() < 0.55 && j < radii.length - 2) {
        const m = [(grid[a][j][0] + grid[a][j + 1][0]) / 2 + rand(-4, 4), (grid[a][j][1] + grid[a][j + 1][1]) / 2 + rand(-4, 4)];
        const n = [(grid[b][j][0] + grid[b][j + 1][0]) / 2 + rand(-4, 4), (grid[b][j][1] + grid[b][j + 1][1]) / 2 + rand(-4, 4)];
        pieces.push([grid[a][j], m, n, grid[b][j]], [m, grid[a][j + 1], grid[b][j + 1], n]);
      } else pieces.push(poly);
      for (const piece of pieces) {
        const c = clipPoly(piece, 0, 0, size, size);
        if (c.length < 3 || Math.abs(area(c)) < 6) continue;
        shards.push({ poly: c, ring: j, dist: Math.hypot(centroid(c)[0] - ix, centroid(c)[1] - iy) });
      }
    }
  }
  return shards;
}

export async function createShatter(host, { embedded = false } = {}) {
  // ?v= picks a factory variant to compare (r1 is the round 1 parent).
  const V = new URLSearchParams(location.search).get("v") ?? "b";
  const craft = V.includes("a") || V.includes("b");
  const burst = V.includes("b");
  const stage = createStage(host, { dpr: 1.5 });
  const g = stage.ctx;

  let index = 0;
  const covers = await Promise.all([loadCover(ORDER[0]), loadCover(ORDER[1])]);
  let front = covers[0];
  let back = covers[1];
  loadCover(ORDER[2]);

  let size = 300;
  let px = 0;
  let py = 0;
  let floor = 0;
  stage.onResize((w, h) => {
    size = Math.min(w * 0.56, h * 0.62, 560);
    px = (w - size) / 2;
    py = (h - size) / 2 - h * 0.04;
    floor = Math.min(h - 18, py + size + h * 0.17);
  });

  // state: whole | cracked
  let shards = [];
  let cracked = false;
  let crackAt = 0;
  let impact = [0, 0];
  let loose = 0;
  let clearing = 0;
  let audio = null;

  const chime = (strength, pitch = 1) => {
    try {
      if (!audio) audio = new AudioContext();
      const t = audio.currentTime;
      const n = audio.createBufferSource();
      const len = Math.floor(audio.sampleRate * 0.25);
      const buf = audio.createBuffer(1, len, audio.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6);
      n.buffer = buf;
      const bp = audio.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 3200 * pitch + Math.random() * 2400;
      bp.Q.value = 8;
      const gain = audio.createGain();
      gain.gain.value = 0.18 * strength;
      n.connect(bp).connect(gain).connect(audio.destination);
      n.start(t);
    } catch {}
  };

  const doCrack = (x, y) => {
    impact = [x, y];
    shards = crack(size, x, y).map((s) => {
      const c = centroid(s.poly);
      const out = Math.hypot(c[0] - x, c[1] - y) || 1;
      const push = Math.min(2.2, 0.6 + s.ring * 0.35);
      return {
        ...s,
        c,
        local: s.poly.map((p) => [p[0] - c[0], p[1] - c[1]]),
        // In the pane: a hair out of register.
        x: c[0] + ((c[0] - x) / out) * push,
        y: c[1] + ((c[1] - y) / out) * push,
        a: rand(-0.006, 0.006),
        flip: 0,
        vx: 0,
        vy: 0,
        va: 0,
        vf: 0,
        shift: craft ? [rand(-4, 4), rand(-4, 4)] : [rand(-2.2, 2.2), rand(-2.2, 2.2)],
        z: 0,
        vz: 0,
        loose: false,
        landed: false,
        tint: rand(0.92, 1.08),
        r: Math.sqrt(Math.abs(area(s.poly))),
      };
    });
    cracked = true;
    crackAt = performance.now();
    loose = 0;
    chime(1.2, 0.7);
  };

  const knock = (s, vx, vy, spin = 1) => {
    if (s.loose) return;
    s.loose = true;
    s.vx = vx + rand(-60, 60);
    s.vy = vy + rand(-80, 20);
    s.va = rand(-4, 4) * spin;
    s.vf = rand(3, 9) * (Math.random() < 0.5 ? -1 : 1);
    loose++;
    if (Math.random() < 0.5) chime(0.5, 1.2);
  };

  const local = (x, y) => [x - px, y - py];
  const onPane = (x, y) => x >= px && y >= py && x <= px + size && y <= py + size;

  let downAt = 0;
  let downXY = [0, 0];
  let moved = false;
  stage.on("down", (p) => {
    downAt = performance.now();
    downXY = [p.x, p.y];
    moved = false;
    if (!cracked && onPane(p.x, p.y) && clearing === 0) {
      const [lx, ly] = local(p.x, p.y);
      doCrack(lx, ly);
      moved = true; // this press was spent on the crack
    }
  });
  const sweep = (p) => {
    if (!cracked) return;
    const [lx, ly] = local(p.x, p.y);
    const speed = Math.hypot(p.vx, p.vy);
    const reach = 18 + Math.min(40, speed * 0.03);
    for (const s of shards) {
      if (s.loose) continue;
      if (inside(s.poly, lx, ly) || Math.hypot(s.c[0] - lx, s.c[1] - ly) < reach + s.r * 0.35) knock(s, p.vx * 0.35, p.vy * 0.35);
    }
  };
  stage.on("move", (p) => {
    if (!p.down) return;
    if (Math.hypot(p.x - downXY[0], p.y - downXY[1]) > 6) moved = true;
    sweep(p);
  });
  stage.on("up", (p) => {
    if (cracked && !moved && performance.now() - downAt < 260) {
      // A second blow: everything near it bursts out.
      const [lx, ly] = local(p.x, p.y);
      for (const s of shards) {
        const dx = s.c[0] - lx;
        const dy = s.c[1] - ly;
        const d = Math.hypot(dx, dy) || 1;
        if (d < size * 0.55) {
          knock(s, (dx / d) * (420 - d), (dy / d) * (420 - d) - 160, 1.6);
          // Toward you: the burst comes out of the pane at the camera.
          if (burst) s.vz = rand(1.2, 3.2) * (1 - d / (size * 0.6));
        }
      }
      chime(1, 0.9);
    }
  });

  const GRAV = 2200;
  let gleam = 0;
  let idleT = 0;

  stage.onFrame((dt, t) => {
    const W = stage.width;
    const H = stage.height;
    const d = stage.dpr;
    g.setTransform(d, 0, 0, d, 0, 0);
    // Room.
    const bg = g.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.45, Math.max(W, H) * 0.75);
    bg.addColorStop(0, "#2a2826");
    bg.addColorStop(1, "#0f0e0d");
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    // Floor line, a soft table edge.
    const fl = g.createLinearGradient(0, floor - 2, 0, H);
    fl.addColorStop(0, "rgba(0,0,0,0)");
    fl.addColorStop(0.02, "rgba(255,245,230,0.05)");
    fl.addColorStop(1, "rgba(0,0,0,0.25)");
    g.fillStyle = fl;
    g.fillRect(0, floor, W, H - floor);

    // The pane's shadow on the floor.
    g.save();
    g.filter = "blur(18px)";
    g.fillStyle = `rgba(0,0,0,${0.55 * (1 - loose / Math.max(1, shards.length || 1) * 0.6)})`;
    g.beginPath();
    g.ellipse(W / 2, floor + 4, size * 0.48, 10, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();

    // The next cover, behind.
    g.save();
    g.translate(px, py);
    g.drawImage(back, 0, 0, size, size);
    g.fillStyle = `rgba(10,9,8,${cracked ? 0.55 - 0.45 * (loose / Math.max(1, shards.length)) : 0.55})`;
    g.fillRect(0, 0, size, size);
    g.restore();

    const sinceCrack = (performance.now() - crackAt) / 1000;

    if (!cracked) {
      g.save();
      g.translate(px, py);
      g.drawImage(front, 0, 0, size, size);
      drawGlass(g, size, t, gleam);
      g.restore();
    } else {
      const h = dt;
      for (const s of shards) {
        // The crack runs outward: rings appear in turn.
        if (!s.loose) continue;
        s.vy += GRAV * h;
        s.x += s.vx * h;
        s.y += s.vy * h;
        s.a += s.va * h;
        s.flip += s.vf * h;
        s.z += s.vz * h;
        if (s.z > 0) s.vz -= 1.4 * h;
        const bottom = floor - py - 4;
        if (s.y + s.r * 0.3 > bottom) {
          s.y = bottom - s.r * 0.3;
          if (Math.abs(s.vy) > 120) chime(Math.min(0.6, Math.abs(s.vy) / 2600), 1.6);
          s.vy *= -0.28;
          s.vx *= 0.6;
          s.va *= 0.5;
          s.vf *= 0.4;
          if (Math.abs(s.vy) < 40) {
            s.vy = 0;
            s.landed = true;
            // Lie flat-ish.
            s.flip += (Math.round(s.flip / Math.PI) * Math.PI + Math.PI / 2 * 0.85 - s.flip) * 0.2;
          }
        }
        if (s.landed) {
          s.vx *= 0.9;
          s.va *= 0.9;
          s.vf *= 0.85;
        }
      }
      // Draw: in-pane shards first, then the falling ones on top.
      g.save();
      g.translate(px, py);
      for (const s of shards) if (!s.loose) drawShard(g, s, front, sinceCrack, size, impact, craft);
      const flying = shards.filter((s) => s.loose).sort((a, b) => a.z - b.z);
      for (const s of flying) drawShard(g, s, front, 9, size, impact, craft);
      g.restore();
      // Cleared: the pane behind comes forward.
      if (loose >= shards.length * 0.9 && clearing === 0) clearing = 0.0001;
    }
    if (clearing > 0) {
      clearing += dt;
      // Remaining shards drop; fallen ones slide away.
      for (const s of shards) if (!s.loose) knock(s, 0, 0, 0.3);
      if (clearing > 1.6) {
        index = (index + 1) % ORDER.length;
        front = back;
        loadCover(ORDER[(index + 1) % ORDER.length]).then((img) => (back = img));
        loadCover(ORDER[(index + 2) % ORDER.length]);
        cracked = false;
        shards = [];
        clearing = 0;
        loose = 0;
        gleam = 1;
      } else {
        g.fillStyle = `rgba(15,14,13,${clamp((clearing - 0.9) / 0.7, 0, 1)})`;
        g.fillRect(0, floor - 30, W, H - floor + 30);
      }
    }
    gleam = Math.max(0, gleam - dt * 0.8);

    // Idle: knock it about on its own after a while.
    if (!stage.pointer.down && stage.idleFor() > 7000) {
      idleT += dt;
      if (idleT > 3.2) {
        idleT = 0;
        if (!cracked && clearing === 0) doCrack(size * rand(0.3, 0.7), size * rand(0.3, 0.6));
        else if (cracked) {
          const lx = size * rand(0.2, 0.8);
          const ly = size * rand(0.2, 0.8);
          for (const s of shards) if (!s.loose && Math.hypot(s.c[0] - lx, s.c[1] - ly) < size * 0.28) knock(s, rand(-200, 200), -100);
        }
      }
    }
    void embedded;
  });

  return {
    destroy() {
      stage.destroy();
      audio?.close();
    },
  };
}

function drawGlass(g, size, t, gleam) {
  // Thickness: a bright bevel on the lit edges, dark on the far ones.
  g.save();
  g.lineWidth = 3;
  g.strokeStyle = "rgba(190, 230, 215, 0.35)";
  g.strokeRect(1.5, 1.5, size - 3, size - 3);
  g.lineWidth = 1;
  g.strokeStyle = "rgba(255,255,255,0.55)";
  g.beginPath();
  g.moveTo(0.5, size);
  g.lineTo(0.5, 0.5);
  g.lineTo(size, 0.5);
  g.stroke();
  // A slow gleam crossing the face.
  const k = ((t * 0.12) % 1.6) - 0.3;
  const x = k * size * 1.6;
  const gr = g.createLinearGradient(x - size * 0.3, 0, x + size * 0.3, size * 0.6);
  gr.addColorStop(0, "rgba(255,255,255,0)");
  gr.addColorStop(0.5, `rgba(255,255,255,${0.08 + gleam * 0.25})`);
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.globalCompositeOperation = "screen";
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  g.restore();
}

function drawShard(g, s, img, since, size, impact, craft) {
  const reveal = clamp((since - s.ring * 0.028) / 0.05, 0, 1);
  g.save();
  const fx = Math.cos(s.flip);
  if (reveal < 1 && !s.loose) {
    // Not yet reached by the crack: draw whole.
    g.beginPath();
    for (const p of s.poly) g.lineTo(p[0], p[1]);
    g.closePath();
    g.clip();
    g.drawImage(img, 0, 0, size, size);
    g.restore();
    return;
  }
  g.translate(s.x, s.y);
  if (s.z > 0) {
    // Coming at the camera: bigger, and spreading from the middle of view.
    const k = 1 + s.z * 1.6;
    g.translate((s.x - size / 2) * (k - 1), (s.y - size / 2) * (k - 1));
    g.scale(k, k);
  }
  g.rotate(s.a);
  g.scale(Math.abs(fx) < 0.04 ? 0.04 * Math.sign(fx || 1) : fx, 1);
  g.beginPath();
  for (const p of s.local) g.lineTo(p[0], p[1]);
  g.closePath();
  g.save();
  g.clip();
  const back = fx < 0;
  g.drawImage(img, -s.c[0] + s.shift[0], -s.c[1] + s.shift[1], size, size);
  // Light on the shard: brighter facing, dark edge-on, the back face milky.
  const face = Math.abs(fx);
  if (back) {
    g.fillStyle = craft ? "rgba(160, 215, 200, 0.18)" : "rgba(200, 225, 215, 0.35)";
    g.fillRect(-size, -size, size * 2, size * 2);
  }
  const shade = (1 - face) * (craft ? 0.4 : 0.6) + (s.tint - 1) * 2;
  if (shade > 0) {
    g.fillStyle = `rgba(0,0,0,${Math.min(0.7, shade)})`;
    g.fillRect(-size, -size, size * 2, size * 2);
  } else {
    g.fillStyle = `rgba(255,255,255,${Math.min(0.2, -shade)})`;
    g.fillRect(-size, -size, size * 2, size * 2);
  }
  // A glint as it turns through the light.
  const glint = Math.pow(Math.max(0, Math.sin(s.flip * 1 + 0.6)), 24) * (s.loose ? 1 : 0);
  if (glint > 0.01) {
    g.fillStyle = `rgba(255,255,250,${glint * 0.7})`;
    g.fillRect(-size, -size, size * 2, size * 2);
  }
  g.restore();
  // Crack edges: a bright line and a dark one beside it.
  g.lineJoin = "round";
  if (craft) {
    // The pane's thickness shows along every break, green like float glass.
    g.strokeStyle = "rgba(120, 190, 165, 0.75)";
    g.lineWidth = 3.2;
    g.stroke();
    g.strokeStyle = "rgba(0,0,0,0.45)";
    g.lineWidth = 1.4;
    g.stroke();
    g.strokeStyle = "rgba(245, 255, 250, 0.95)";
    g.lineWidth = 0.9;
    g.stroke();
    g.restore();
    return;
  }
  g.strokeStyle = "rgba(0,0,0,0.35)";
  g.lineWidth = 1.6;
  g.stroke();
  g.strokeStyle = `rgba(235, 250, 245, ${s.loose ? 0.75 : 0.5 + 0.3 * Math.max(0, 1 - s.dist / (size * 0.6))})`;
  g.lineWidth = 0.7;
  g.stroke();
  g.restore();
  void impact;
}
