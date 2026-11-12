// One side of a street, photographed flat-on from across the road at noon,
// the way Ruscha drove the Strip: low stucco frontages abutting one another,
// a parking lot or a motel now and then, poles and wires against a sky the
// film could not hold. Nothing is drawn as an object. Each frontage is a few
// large flat planes of tone (wall, glass, the hard shadow every projection
// throws straight down) and the whole band is then screened like an offset
// halftone, so it reads as a photograph printed in a cheap book.
//
// Everything is painted in grey (0 = deepest shadow, 1 = sky glare) and
// then mapped onto the stock's own ink range, so the print never reaches
// true black or true white.

const rng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const grey = (v, a = 1) => {
  const k = Math.round(Math.max(0, Math.min(1, v)) * 255);
  return a === 1 ? `rgb(${k},${k},${k})` : `rgba(${k},${k},${k},${a})`;
};

const mod = (a, n) => ((a % n) + n) % n;

const SKY = 0.965; // blown out: the exposure was set for the shaded walls
const WALLS = [0.77, 0.7, 0.63]; // stucco, three close greys
const NOON = 0.46; // what a hard noon shadow takes off whatever it falls on
const SIGN_PX = 16; // the only size lettering comes in
const NUM_W = 112; // a street number's footprint right of its edge, texture px
const FOLD_CLEAR = 16; // keep edges this far off a crease

const NAMES = [
  "LIQUOR", "CLEANERS", "CAFE", "RECORDS", "BARBER", "FLORIST", "TV REPAIR", "DRUGS", "SHOES", "LOANS",
  "HARDWARE", "PHOTO", "MARKET", "TAILOR", "REALTY", "GIFTS", "BOOKS", "ANTIQUES", "UPHOLSTERY", "LAUNDRY",
];

// A hard noon shadow: straight down, sharp edged, no falloff.
const shadow = (g, x, y, w, h, a = NOON) => {
  g.fillStyle = `rgba(0,0,0,${a})`;
  g.fillRect(x, y, w, h);
};

// Plate glass: dark, a touch lighter low down where it picks up the
// pavement, and a faint wash of the bright street behind the camera.
function glass(g, r, x, y, w, h) {
  const lift = r() * 0.05;
  const v = g.createLinearGradient(0, y, 0, y + h);
  v.addColorStop(0, grey(0.1 + lift));
  v.addColorStop(0.6, grey(0.15 + lift));
  v.addColorStop(1, grey(0.25 + lift));
  g.fillStyle = v;
  g.fillRect(x, y, w, h);
  const from = r() < 0.5 ? x : x + w;
  const hz = g.createLinearGradient(from, 0, x + w - (from - x), 0);
  hz.addColorStop(0, `rgba(255,255,255,${0.05 + r() * 0.06})`);
  hz.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = hz;
  g.fillRect(x, y, w, h);
}

// Lettering painted flat on the wall: one grotesk, one size, no box.
function letter(g, r, font, x, w, y, f) {
  g.font = `600 ${SIGN_PX}px ${font}`;
  g.letterSpacing = "1px";
  g.textBaseline = "middle";
  for (let tries = 0; tries < 4; tries += 1) {
    const text = NAMES[Math.floor(r() * NAMES.length)];
    const m = g.measureText(text).width;
    if (m > w - 24) continue;
    const left = r() < 0.55;
    g.textAlign = "left";
    const tx = left ? x + 10 + r() * Math.min(20, w - m - 20) : x + (w - m) / 2;
    g.fillStyle = grey(f > 0.72 ? 0.16 : 0.95);
    g.fillText(text, Math.round(tx), Math.round(y));
    break;
  }
  g.letterSpacing = "0px";
}

// Split a run into a few unequal bays.
function bays(r, w, n) {
  const k = Array.from({ length: n }, () => 0.6 + r());
  const s = k.reduce((a, b) => a + b, 0);
  return k.map((v) => (v / s) * w);
}

// The shopfront: glass between stucco piers, a door somewhere, and the
// head of it all set back in shadow. Some shops are mostly glass, some
// mostly wall with a window punched in it, some sit high on a bulkhead.
function storefront(g, r, x, w, top, base) {
  const style = r();
  const bulk = style > 0.75 ? 18 + r() * 8 : 7;
  const n = Math.max(1, Math.min(3, Math.round(w / (90 + r() * 70))));
  const doorAt = Math.floor(r() * n);
  const pier = 3 + r() * 8;
  let bx = x;
  for (const [i, bw] of bays(r, w, n).entries()) {
    const fill = style < 0.5 ? 1 : style < 0.75 ? 0.35 + r() * 0.3 : 0.85;
    const gw = (bw - pier * 2) * fill;
    const gx = bx + pier + (bw - pier * 2 - gw) * (fill < 1 ? r() : 0.5);
    const gt = fill < 0.7 ? top + 8 + r() * 6 : top;
    glass(g, r, gx, gt, gw, base - bulk - gt);
    shadow(g, gx, gt, gw, 4, 0.5);
    if (i === doorAt) {
      const dw = Math.min(28, bw * 0.3);
      const dx = r() < 0.5 ? bx + pier + 4 : bx + bw - pier - dw - 4;
      g.fillStyle = grey(0.08);
      g.fillRect(dx, top, dw, base - top);
      shadow(g, dx, top, dw, 4, 0.5);
    }
    bx += bw;
  }
}

function facade(g, r, font, x, w, groundY, h, kind) {
  const top = groundY - h;
  const f = WALLS[Math.floor(r() * WALLS.length)];
  g.fillStyle = grey(f);
  g.fillRect(x, top, w, h);

  // Roofline: a plain coping, a stepped false front, or a tiled eave.
  const roof = r();
  let under = top;
  if (roof < 0.22 && kind === "one") {
    const eh = 9 + r() * 6;
    g.fillStyle = grey(0.42 + r() * 0.08);
    g.fillRect(x - 4, top, w + 8, eh);
    shadow(g, x, top + eh, w, 7 + r() * 3);
    under = top + eh + 9;
  } else {
    if (roof < 0.5) {
      const pw = w * (0.35 + r() * 0.35);
      const px = x + (w - pw) * (0.2 + r() * 0.6);
      const ph = 10 + r() * 16;
      g.fillStyle = grey(f);
      g.fillRect(px, top - ph, pw, ph);
      g.fillStyle = grey(Math.min(0.95, f + 0.07));
      g.fillRect(px - 2, top - ph, pw + 4, 3);
      shadow(g, px, top - ph + 3, pw, 3);
    }
    g.fillStyle = grey(Math.min(0.95, f + 0.07));
    g.fillRect(x - 1, top, w + 2, 4);
    shadow(g, x, top + 4, w, 3 + r() * 2);
    under = top + 8;
  }

  const shopTop = groundY - 52 - r() * 18;
  // Awning: a flat face of canvas and the deep band of shade it throws
  // straight down over the head of the glass.
  const awning = r() < 0.42;
  const ah = 11 + r() * 4;
  if (awning) {
    g.fillStyle = grey(r() < 0.6 ? 0.9 : 0.36);
    g.fillRect(x + 2, shopTop - ah - 2, w - 4, ah);
  }
  storefront(g, r, x + 6, w - 12, shopTop, groundY);
  if (awning) shadow(g, x + 4, shopTop - 2, w - 8, 15 + r() * 8);

  // Upper floor: a ribbon of glass, a few wide windows, or blank stucco.
  if (kind !== "one") {
    const y0 = under + 10;
    const y1 = shopTop - (awning ? ah + 26 : 26);
    const pick = r();
    if (y1 - y0 > 18) {
      if (pick < 0.3) {
        const wh = Math.min(28, y1 - y0);
        const wx = x + 14;
        glass(g, r, wx, y0, w - 28, wh);
        shadow(g, wx, y0, w - 28, 4);
        g.fillStyle = grey(f);
        let mx = wx;
        for (const bw of bays(r, w - 28, Math.max(2, Math.round(w / 70))).slice(0, -1)) {
          mx += bw;
          g.fillRect(mx - 1, y0, 2, wh);
        }
      } else if (pick < 0.75) {
        const n = 1 + Math.floor(r() * Math.min(3, w / 90));
        const ws = bays(r, w - 20, n);
        let wx = x + 10;
        const rows = kind === "tall" && y1 - y0 > 70 ? 2 : 1;
        const rh = (y1 - y0) / rows;
        for (const bw of ws) {
          const inner = bw * (0.45 + r() * 0.3);
          const ix = wx + (bw - inner) / 2;
          for (let row = 0; row < rows; row += 1) {
            const wy = y0 + row * rh + 2;
            const wh = Math.min(26, rh - 8);
            glass(g, r, ix, wy, inner, wh);
            shadow(g, ix, wy, inner, 4);
          }
          wx += bw;
        }
      }
    }
  }

  // Sparse lettering on the wall, above the shop.
  if (r() < 0.55) {
    const ly = awning ? shopTop - ah - 14 : kind === "one" ? (under + shopTop) / 2 : shopTop - 14;
    if (ly - SIGN_PX / 2 > under + 2) letter(g, r, font, x, w, ly, f);
  }
}

function alley(g, r, x, w, groundY) {
  // A gap between two buildings: a far wall, mostly in shade.
  const h = 70 + r() * 40;
  g.fillStyle = grey(0.62);
  g.fillRect(x, groundY - h, w, h);
  shadow(g, x, groundY - h, w * 0.7, h, 0.35);
}

function lot(g, r, font, x, w, groundY) {
  // Open asphalt: a far building behind it, a low block wall at the walk,
  // and sometimes a billboard on its posts.
  if (r() < 0.7) {
    const fh = 46 + r() * 30;
    const fw = w * (0.4 + r() * 0.5);
    const fx = x + (w - fw) * r();
    g.fillStyle = grey(0.88);
    g.fillRect(fx, groundY - fh, fw, fh);
    shadow(g, fx, groundY - fh + 3, fw, 3, 0.25);
  }
  g.fillStyle = grey(0.7);
  g.fillRect(x, groundY - 22, w, 22);
  g.fillStyle = grey(0.82);
  g.fillRect(x, groundY - 22, w, 3);
  shadow(g, x, groundY - 19, w, 3);
  if (r() < 0.55) {
    const bw = Math.min(w - 30, 140 + r() * 50);
    const bx = x + (w - bw) * (0.3 + r() * 0.4);
    const by = groundY - 154 - r() * 20;
    const bh = 52;
    g.fillStyle = grey(0.3);
    for (const sx of [bx + bw * 0.22, bx + bw * 0.78]) g.fillRect(sx - 2, by + bh, 4, groundY - 22 - by - bh);
    const face = 0.55 + r() * 0.3;
    g.fillStyle = grey(face);
    g.fillRect(bx, by, bw, bh);
    g.fillStyle = grey(0.3);
    g.fillRect(bx - 2, by - 3, bw + 4, 3);
    shadow(g, bx, by, bw, 5, 0.3);
    shadow(g, bx, by + bh, bw, 4, 0.5);
  } else if (r() < 0.6) {
    letter(g, r, font, x, w, groundY - 36, SKY);
  }
}

function motel(g, r, font, x, w, groundY) {
  // Two floors of rooms behind an open walkway, under a flat roof slab.
  const h = 104 + r() * 12;
  const top = groundY - h;
  const f = WALLS[Math.floor(r() * 2)];
  const floorH = (h - 10) / 2;
  g.fillStyle = grey(f);
  g.fillRect(x, top, w, h);
  for (let fl = 0; fl < 2; fl += 1) {
    const slab = top + fl * floorH;
    const fy = slab + 7;
    // Doors and windows first, then the slab's shadow laid over their heads.
    for (let ux = x + 16 + r() * 10; ux < x + w - 60; ux += 58 + r() * 10) {
      g.fillStyle = grey(0.12);
      g.fillRect(ux, fy + floorH - 44, 14, 44);
      glass(g, r, ux + 24, fy + floorH - 38, 26, 18);
    }
    g.fillStyle = grey(0.93);
    g.fillRect(x - 4, slab, w + 8, 7);
    shadow(g, x, fy, w, floorH * 0.42, 0.5);
    if (fl === 0) {
      g.fillStyle = grey(0.93);
      g.fillRect(x, fy + floorH - 20, w, 3);
      shadow(g, x, fy + floorH - 17, w, 2, 0.35);
    }
  }
  // Pole sign: a plain flat board, its name painted on in the same hand.
  const px = x + w * (0.15 + r() * 0.2);
  g.fillStyle = grey(0.28);
  g.fillRect(px - 2, groundY - 176, 5, 176);
  g.fillStyle = grey(0.24);
  g.fillRect(px - 40, groundY - 204, 84, 30);
  g.font = `600 ${SIGN_PX}px ${font}`;
  g.letterSpacing = "1px";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = grey(0.94);
  g.fillText("MOTEL", px + 2, groundY - 188);
  g.letterSpacing = "0px";
}

// Lay the frontages out along the street. Every frontage's left edge (and
// so its street number, which hangs right of it) is kept clear of the
// creases, which fall every `creases` px.
export function planStreet(W, seed, creases) {
  const r = rng(seed);
  const clear = (x) => {
    const p = mod(x, creases);
    if (p < FOLD_CLEAR) return x + FOLD_CLEAR - p;
    if (p > creases - NUM_W - FOLD_CLEAR) return x + creases - p + FOLD_CLEAR + r() * 30;
    return x;
  };
  const out = [];
  let x = -40 + r() * 20;
  while (x < W + 10) {
    const roll = r();
    const kind = roll < 0.42 ? "one" : roll < 0.7 ? "two" : roll < 0.8 ? "tall" : roll < 0.9 ? "lot" : "motel";
    const want = kind === "motel" ? 300 + r() * 120 : kind === "lot" ? 190 + r() * 110 : kind === "tall" ? 200 + r() * 120 : 140 + r() * 220;
    const gap = r() < 0.14 ? 10 + r() * 16 : 0;
    const next = clear(x + want + gap);
    out.push({ x, w: next - gap - x, kind, gap, h: r() });
    x = next;
  }
  return out;
}

// Paint one side of the street into a W x H canvas. `creases` is the panel
// width in px. Returns each frontage's left edge, for its street number.
export function paintStreet(W, H, seed, { creases, font = "sans-serif" }) {
  const r = rng(seed ^ 0x5bd1e995);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  const groundY = Math.round(H * 0.855);
  const kerbY = Math.round(H * 0.905);

  // Sky: overexposed, all but paper, the faintest weight overhead.
  const sky = g.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, grey(SKY - 0.03));
  sky.addColorStop(0.5, grey(SKY));
  g.fillStyle = sky;
  g.fillRect(0, 0, W, groundY);

  const plan = planStreet(W, seed, creases);
  for (const { x, w, kind, gap, h } of plan) {
    if (kind === "lot") lot(g, r, font, x, w, groundY);
    else if (kind === "motel") motel(g, r, font, x, w, groundY);
    else {
      const fh = kind === "one" ? 92 + h * 30 : kind === "two" ? 138 + h * 28 : 172 + h * 22;
      facade(g, r, font, x, w, groundY, fh, kind);
    }
    if (gap) alley(g, r, x + w, gap, groundY);
  }

  // Sidewalk, kerb, road: three flat planes.
  g.fillStyle = grey(0.82);
  g.fillRect(0, groundY, W, kerbY - groundY);
  g.fillStyle = grey(0.9);
  g.fillRect(0, kerbY - 3, W, 3);
  g.fillStyle = grey(0.36);
  g.fillRect(0, kerbY, W, 3);
  g.fillStyle = grey(0.56);
  g.fillRect(0, kerbY + 3, W, H - kerbY - 3);

  // Poles and wires, sparse, thin against the white.
  const poles = [];
  for (let px = 160 + r() * 260; px < W + 500; px += 560 + r() * 380) poles.push(px);
  g.strokeStyle = grey(0.3, 0.7);
  g.lineWidth = 1;
  for (let i = 0; i < poles.length - 1; i += 1) {
    for (const [dy, sag] of [[19, 14], [27, 18]]) {
      const a = poles[i];
      const b = poles[i + 1];
      g.beginPath();
      g.moveTo(a, dy);
      g.quadraticCurveTo((a + b) / 2, dy + sag * 2, b, dy);
      g.stroke();
    }
  }
  for (const px of poles) {
    g.fillStyle = grey(0.3);
    g.fillRect(px - 2, 10, 4, kerbY - 10);
    g.fillRect(px - 20, 18, 40, 3);
  }

  // Lens, film and plate: a breath of softness, exposure that steps where
  // the negatives were butted up, then an offset halftone screen at 45
  // degrees with a little grain through it.
  const soft = document.createElement("canvas");
  soft.width = W;
  soft.height = H;
  const sg = soft.getContext("2d");
  sg.filter = "blur(0.7px)";
  sg.drawImage(c, 0, 0);
  const img = sg.getImageData(0, 0, W, H);
  const d = img.data;
  const frame = 560;
  const exposure = Array.from({ length: Math.ceil(W / frame) + 1 }, () => 1 + (r() - 0.5) * 0.06);
  // A 45-degree screen: dark dots growing from each cell's centre up to
  // half cover, then light dots shrinking at the cell corners.
  const cell = 4.4;
  const dotAt = (u, v, ink) => {
    const du = u - Math.floor(u) - 0.5;
    const dv = v - Math.floor(v) - 0.5;
    if (ink <= 0.5) return Math.max(0, Math.min(1, (Math.sqrt(ink / Math.PI) - Math.hypot(du, dv)) * cell + 0.5));
    const cu = 0.5 - Math.abs(du);
    const cv = 0.5 - Math.abs(dv);
    return Math.max(0, Math.min(1, (Math.hypot(cu, cv) - Math.sqrt((1 - ink) / Math.PI)) * cell + 0.5));
  };
  for (let y = 0; y < H; y += 1) {
    for (let xx = 0; xx < W; xx += 1) {
      const i = (y * W + xx) * 4;
      const fx = (xx % frame) / frame;
      const e = exposure[Math.floor(xx / frame)] * (1 - 0.04 * (2 * fx - 1) ** 2);
      const v = Math.max(0, Math.min(1, (d[i] / 255) * e + (Math.random() - 0.5) * 0.05));
      // The plate drops the faintest highlights out to bare paper.
      const ink = Math.max(0, (1 - v - 0.06) / 0.94);
      const dot = dotAt((xx + y) / cell / Math.SQRT2, (xx - y) / cell / Math.SQRT2, ink);
      const out = 0.5 * (1 - dot) + 0.5 * (1 - ink);
      d[i] = d[i + 1] = d[i + 2] = out * 255;
    }
  }
  sg.filter = "none";
  sg.putImageData(img, 0, 0);
  return { canvas: soft, lots: plan.filter((p) => p.x > -10).map((p) => p.x) };
}

// Map a grey street onto the stock: ink never fully black, paper never
// fully white, and a slight warmth through the mids like a halftone on
// uncoated paper.
export function toStock(canvas, dark = [34, 31, 28], light = [234, 229, 218]) {
  const g = canvas.getContext("2d");
  const img = g.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = (d[i] / 255) ** 1.2;
    d[i] = dark[0] + (light[0] - dark[0]) * v;
    d[i + 1] = dark[1] + (light[1] - dark[1]) * v;
    d[i + 2] = dark[2] + (light[2] - dark[2]) * v;
  }
  g.putImageData(img, 0, 0);
  return canvas;
}
