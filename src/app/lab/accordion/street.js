// One side of a street, photographed flat-on from across the road at eye
// level, the way Ruscha drove the Strip: low stucco frontages abutting one
// another, a parking lot or a motel now and then, poles and wires running
// through the sky, cars at the kerb. Painted procedurally so the strip is
// one continuous elevation and every frontage's left edge is known, which
// is where its street number goes.
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

const NAMES = [
  "LIQUOR", "CLEANERS", "MOTEL", "CAFE", "RECORDS", "BARBER", "FLORIST", "TV REPAIR", "DRUGS", "SHOES",
  "LOANS", "HARDWARE", "PHOTO", "COCKTAILS", "MARKET", "TAILOR", "REALTY", "GIFTS", "BOOKS", "COFFEE SHOP",
];

// A storefront: plate glass in bays, a door, a bulkhead, sometimes an awning.
function storefront(g, r, x, w, top, base, f) {
  const bays = Math.max(1, Math.round(w / (70 + r() * 40)));
  const bw = w / bays;
  const doorAt = Math.floor(r() * bays);
  for (let b = 0; b < bays; b += 1) {
    const bx = x + b * bw + 3;
    const gw = bw - 6;
    const door = b === doorAt;
    const gx = door ? bx + gw * 0.3 : bx;
    const gwid = door ? gw * 0.4 : gw;
    const gb = door ? base : base - 7;
    // Recess shadow, then glass: dark at the head, reflecting street below.
    const glass = g.createLinearGradient(0, top, 0, gb);
    glass.addColorStop(0, grey(0.03));
    glass.addColorStop(0.35, grey(0.1 + r() * 0.08));
    glass.addColorStop(1, grey(0.2 + r() * 0.14));
    g.fillStyle = glass;
    g.fillRect(gx, top, gwid, gb - top);
    if (!door) {
      // A sky reflection raking across the pane.
      g.save();
      g.beginPath();
      g.rect(gx, top, gwid, gb - top);
      g.clip();
      g.fillStyle = grey(0.85, 0.12 + r() * 0.1);
      const s = gx + r() * gwid;
      g.beginPath();
      g.moveTo(s, top);
      g.lineTo(s + 18, top);
      g.lineTo(s - 10, gb);
      g.lineTo(s - 34, gb);
      g.fill();
      g.restore();
      g.fillStyle = grey(f - 0.16);
      g.fillRect(bx, gb, gw, 7);
    } else {
      g.fillStyle = grey(0.5, 0.5);
      g.fillRect(gx + gwid * 0.15, top + (gb - top) * 0.5, gwid * 0.7, 1.5);
    }
  }
  // Lintel shadow where the glass is set back from the wall.
  const sh = g.createLinearGradient(0, top, 0, top + 7);
  sh.addColorStop(0, "rgba(0,0,0,0.45)");
  sh.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = sh;
  g.fillRect(x, top, w, 7);
  if (r() < 0.45) {
    // Awning: a lit sloping face, its edge, and the shade it throws.
    const aw = 13 + r() * 6;
    const at = top - aw + 4;
    const striped = r() < 0.5;
    const base0 = 0.32 + r() * 0.45;
    g.fillStyle = grey(base0);
    g.fillRect(x - 2, at, w + 4, aw);
    if (striped) {
      g.fillStyle = grey(base0 + 0.3);
      for (let sx = x; sx < x + w; sx += 14) g.fillRect(sx, at, 7, aw);
    }
    const lit = g.createLinearGradient(0, at, 0, at + aw);
    lit.addColorStop(0, "rgba(255,255,255,0.25)");
    lit.addColorStop(1, "rgba(0,0,0,0.15)");
    g.fillStyle = lit;
    g.fillRect(x - 2, at, w + 4, aw);
    g.fillStyle = grey(0.12, 0.8);
    g.fillRect(x - 2, at + aw - 2, w + 4, 2);
    const shade = g.createLinearGradient(0, at + aw, 0, at + aw + 26);
    shade.addColorStop(0, "rgba(0,0,0,0.42)");
    shade.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = shade;
    g.fillRect(x, at + aw, w, 26);
  }
}

function signText(g, r, text, cx, cy, maxW, size, ink) {
  const face = r() < 0.55 ? `700 ${size}px Helvetica, Arial, sans-serif` : `700 ${size}px Georgia, "Times New Roman", serif`;
  g.font = face;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const m = g.measureText(text).width;
  g.save();
  g.translate(cx, cy);
  if (m > maxW) g.scale(maxW / m, 1);
  g.fillStyle = ink;
  g.fillText(text, 0, 0);
  g.restore();
}

function sign(g, r, x, w, y, h, f) {
  const text = NAMES[Math.floor(r() * NAMES.length)];
  const style = r();
  if (style < 0.4) {
    // Letters painted straight onto the stucco.
    signText(g, r, text, x + w / 2, y + h / 2, w * 0.8, Math.min(h * 0.7, 26), grey(f > 0.55 ? 0.12 : 0.92));
  } else {
    const sw = w * (0.5 + r() * 0.35);
    const sx = x + (w - sw) * (0.2 + r() * 0.6);
    const dark = style < 0.75;
    g.fillStyle = grey(dark ? 0.14 : 0.9);
    g.fillRect(sx, y + 2, sw, h - 4);
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.fillRect(sx + 2, y + h - 2, sw, 2);
    signText(g, r, text, sx + sw / 2, y + h / 2, sw * 0.86, Math.min(h * 0.62, 22), grey(dark ? 0.93 : 0.1));
  }
}

function windows(g, r, x, w, top, bottom, f) {
  const n = Math.max(1, Math.round(w / (44 + r() * 16)));
  const ww = 16 + r() * 10;
  const step = w / n;
  const rows = Math.max(1, Math.round((bottom - top) / 34));
  const rh = (bottom - top) / rows;
  for (let row = 0; row < rows; row += 1) {
    for (let i = 0; i < n; i += 1) {
      const wx = x + step * (i + 0.5) - ww / 2;
      const wy = top + row * rh + rh * 0.18;
      const wh = rh * 0.62;
      g.fillStyle = grey(0.16 + r() * 0.14);
      g.fillRect(wx, wy, ww, wh);
      // Blinds half drawn in some, a sill catching light under each.
      if (r() < 0.4) {
        g.fillStyle = grey(0.62 + r() * 0.2);
        g.fillRect(wx, wy, ww, wh * (0.2 + r() * 0.5));
      }
      g.fillStyle = "rgba(0,0,0,0.4)";
      g.fillRect(wx, wy, ww, 2.5);
      g.fillStyle = grey(Math.min(0.97, f + 0.12));
      g.fillRect(wx - 2, wy + wh, ww + 4, 2.5);
    }
  }
}

function facade(g, r, x, w, groundY, h, kind) {
  const top = groundY - h;
  const f = r() < 0.6 ? 0.8 + r() * 0.17 : 0.3 + r() * 0.35; // white stucco, or a dark front
  g.fillStyle = grey(f);
  g.fillRect(x, top, w, h);
  // Stucco is never even: a soft vertical falloff and a few weather stains.
  const fall = g.createLinearGradient(0, top, 0, groundY);
  fall.addColorStop(0, "rgba(255,255,255,0.08)");
  fall.addColorStop(1, "rgba(0,0,0,0.1)");
  g.fillStyle = fall;
  g.fillRect(x, top, w, h);
  // Parapet: a lit coping and the shadow line it throws.
  const cap = 3 + r() * 4;
  g.fillStyle = grey(Math.min(0.97, f + 0.1));
  g.fillRect(x, top, w, cap);
  g.fillStyle = "rgba(0,0,0,0.3)";
  g.fillRect(x, top + cap, w, 2);
  if (r() < 0.35) {
    // A stepped false front rising over part of the facade.
    const pw = w * (0.3 + r() * 0.4);
    const px = x + (w - pw) / 2;
    const ph = 10 + r() * 14;
    g.fillStyle = grey(f);
    g.fillRect(px, top - ph, pw, ph);
    g.fillStyle = grey(Math.min(0.97, f + 0.1));
    g.fillRect(px, top - ph, pw, cap);
  }
  const shopTop = kind === "one" ? top + h * 0.4 : groundY - 64;
  if (kind !== "one") windows(g, r, x + 6, w - 12, top + cap + 6, shopTop - 22, f);
  sign(g, r, x + 4, w - 8, shopTop - (kind === "one" ? h * 0.36 : 22), kind === "one" ? h * 0.32 : 20, f);
  storefront(g, r, x + 4, w - 8, shopTop, groundY, f);
  // Sun from the left: the left arris catches it, the right falls off.
  g.fillStyle = "rgba(255,255,255,0.22)";
  g.fillRect(x, top, 2, h);
  g.fillStyle = "rgba(0,0,0,0.22)";
  g.fillRect(x + w - 2, top, 2, h);
}

// A clipped ficus at the kerb: a dense dark crown on a short trunk.
function tree(g, r, x, base) {
  const h = 120 + r() * 50;
  const rad = 34 + r() * 18;
  g.fillStyle = grey(0.16);
  g.fillRect(x - 3, base - h * 0.55, 6, h * 0.55);
  const cy = base - h + rad;
  // A solid mass first, then leaf clumps broken over its edge, lit from
  // the upper left like everything else on the street.
  g.fillStyle = grey(0.14);
  g.beginPath();
  g.ellipse(x, cy, rad * 1.2, rad * 0.85, 0, 0, Math.PI * 2);
  g.fill();
  for (let i = 0; i < 160; i += 1) {
    const a = r() * Math.PI * 2;
    const d = (0.55 + 0.45 * Math.sqrt(r())) * rad;
    const lx = Math.cos(a);
    const ly = Math.sin(a);
    const v = 0.1 + r() * 0.08 + Math.max(0, -0.7 * lx - 0.7 * ly) * 0.2;
    g.fillStyle = grey(v);
    g.beginPath();
    g.arc(x + lx * d * 1.2, cy + ly * d * 0.85, 2.5 + r() * 4, 0, Math.PI * 2);
    g.fill();
  }
}

function motel(g, r, x, w, groundY) {
  // Two floors of rooms behind an open walkway, under a flat roof slab.
  const h = 104 + r() * 12;
  const top = groundY - h;
  const f = 0.82 + r() * 0.12;
  const floorH = (h - 10) / 2;
  g.fillStyle = grey(f);
  g.fillRect(x, top, w, h);
  for (let fl = 0; fl < 2; fl += 1) {
    const slab = top + fl * floorH;
    const fy = slab + 8;
    // The slab above each floor throws a deep band of shade onto the rooms.
    g.fillStyle = grey(0.86);
    g.fillRect(x - 4, slab, w + 8, 7);
    g.fillStyle = grey(0.2);
    g.fillRect(x - 4, slab + 6, w + 8, 2);
    const shade = g.createLinearGradient(0, fy, 0, fy + floorH);
    shade.addColorStop(0, "rgba(0,0,0,0.42)");
    shade.addColorStop(0.5, "rgba(0,0,0,0.16)");
    shade.addColorStop(1, "rgba(0,0,0,0.05)");
    g.fillStyle = shade;
    g.fillRect(x, fy, w, floorH);
    for (let ux = x + 14; ux < x + w - 56; ux += 62) {
      g.fillStyle = grey(0.14);
      g.fillRect(ux, fy + floorH - 40, 15, 40);
      g.fillStyle = grey(0.2 + r() * 0.1);
      g.fillRect(ux + 24, fy + floorH - 36, 30, 20);
      g.fillStyle = grey(0.62 + r() * 0.2); // drawn curtains
      g.fillRect(ux + 24, fy + floorH - 36, 30 * (0.3 + r() * 0.5), 20);
    }
    if (fl === 0) {
      // Upper walkway railing, lit along its top rail.
      const ry = fy + floorH - 2;
      g.fillStyle = grey(0.95);
      g.fillRect(x, ry - 18, w, 2.5);
      g.fillStyle = grey(0.3);
      for (let px = x + 4; px < x + w; px += 9) g.fillRect(px, ry - 16, 1.5, 16);
    }
  }
  g.fillStyle = "rgba(255,255,255,0.22)";
  g.fillRect(x, top, 2, h);
  // Pole sign.
  const px = x + w * (0.15 + r() * 0.2);
  g.fillStyle = grey(0.2);
  g.fillRect(px, groundY - 172, 5, 172);
  g.fillStyle = grey(0.12);
  g.fillRect(px - 44, groundY - 206, 94, 40);
  g.fillStyle = grey(0.86);
  g.fillRect(px - 41, groundY - 203, 88, 34);
  signText(g, r, "MOTEL", px + 3, groundY - 186, 80, 22, grey(0.1));
  g.fillStyle = grey(0.12);
  g.fillRect(px - 30, groundY - 164, 66, 16);
  signText(g, r, "VACANCY", px + 3, groundY - 156, 56, 11, grey(0.88));
}

function lot(g, r, x, w, groundY) {
  // Asphalt, a low wall, a billboard on stilts or a price sign.
  g.fillStyle = grey(0.46);
  g.fillRect(x, groundY - 3, w, 3);
  if (r() < 0.6) {
    g.fillStyle = grey(0.66);
    g.fillRect(x, groundY - 14, w, 14);
    g.fillStyle = grey(0.82);
    g.fillRect(x, groundY - 14, w, 2);
  }
  if (r() < 0.65) {
    const bw = Math.min(w - 20, 150 + r() * 40);
    const bx = x + (w - bw) / 2;
    const by = groundY - 150 - r() * 24;
    const bh = 58;
    g.fillStyle = grey(0.18);
    for (const sx of [bx + bw * 0.2, bx + bw * 0.8]) g.fillRect(sx, by + bh, 4, groundY - by - bh);
    g.fillRect(bx - 3, by - 3, bw + 6, bh + 6);
    const paper = g.createLinearGradient(bx, 0, bx + bw, 0);
    const p = 0.45 + r() * 0.4;
    paper.addColorStop(0, grey(p + 0.1));
    paper.addColorStop(1, grey(p - 0.15));
    g.fillStyle = paper;
    g.fillRect(bx, by, bw, bh);
    g.fillStyle = grey(p > 0.6 ? 0.12 : 0.92);
    g.beginPath();
    g.arc(bx + bw * 0.78, by + bh * 0.5, bh * 0.32, 0, Math.PI * 2);
    g.fill();
    signText(g, r, r() < 0.5 ? "FLY WEST" : "DRINK COLA", bx + bw * 0.36, by + bh * 0.5, bw * 0.56, 22, grey(p > 0.6 ? 0.1 : 0.94));
  }
}

function car(g, r, x, y) {
  const L = 176 + r() * 40;
  const body = 0.18 + r() * 0.66;
  const hgt = 27 + r() * 5;
  // Shadow pooled under the car.
  g.fillStyle = "rgba(0,0,0,0.55)";
  g.beginPath();
  g.ellipse(x + L / 2, y - 1, L * 0.52, 4, 0, 0, Math.PI * 2);
  g.fill();
  // Greenhouse.
  const gx0 = x + L * (0.26 + r() * 0.06);
  const gx1 = x + L * (0.7 + r() * 0.06);
  const gy = y - hgt - 18;
  g.fillStyle = grey(body);
  g.beginPath();
  g.moveTo(gx0 - 12, y - hgt + 1);
  g.lineTo(gx0 + 6, gy);
  g.lineTo(gx1 - 4, gy);
  g.lineTo(gx1 + 14, y - hgt + 1);
  g.fill();
  g.fillStyle = grey(0.22);
  g.beginPath();
  g.moveTo(gx0 - 6, y - hgt);
  g.lineTo(gx0 + 8, gy + 3);
  g.lineTo(gx1 - 6, gy + 3);
  g.lineTo(gx1 + 8, y - hgt);
  g.fill();
  g.fillStyle = grey(body);
  g.fillRect((gx0 + gx1) / 2 - 2, gy + 2, 4, hgt - 6);
  // Long low body, lit along its shoulder.
  g.fillStyle = grey(body);
  g.beginPath();
  g.roundRect(x, y - hgt, L, hgt - 4, [6, 4, 3, 3]);
  g.fill();
  const lit = g.createLinearGradient(0, y - hgt, 0, y - 4);
  lit.addColorStop(0, "rgba(255,255,255,0.32)");
  lit.addColorStop(0.45, "rgba(255,255,255,0)");
  lit.addColorStop(1, "rgba(0,0,0,0.3)");
  g.fillStyle = lit;
  g.fill();
  g.fillStyle = grey(0.93, 0.8); // chrome strip and bumpers
  g.fillRect(x + 6, y - hgt + 9, L - 12, 1.5);
  g.fillRect(x - 2, y - 9, 6, 4);
  g.fillRect(x + L - 4, y - 9, 6, 4);
  for (const wx of [x + L * 0.19, x + L * 0.81]) {
    g.fillStyle = grey(0.06);
    g.beginPath();
    g.arc(wx, y - 9, 11, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = grey(0.62);
    g.beginPath();
    g.arc(wx, y - 9, 4.5, 0, Math.PI * 2);
    g.fill();
  }
  return L;
}

function palm(g, r, x, y0, yTop) {
  const lean = (r() - 0.5) * 22;
  g.strokeStyle = grey(0.2);
  g.lineCap = "round";
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(x, y0);
  g.quadraticCurveTo(x + lean * 0.2, (y0 + yTop) / 2, x + lean, yTop);
  g.stroke();
  const cx = x + lean;
  // Dead fronds hanging as a skirt, live fronds arching out.
  g.fillStyle = grey(0.24);
  g.beginPath();
  g.moveTo(cx - 6, yTop);
  g.lineTo(cx + 6, yTop);
  g.lineTo(cx + 4, yTop + 16);
  g.lineTo(cx - 4, yTop + 16);
  g.fill();
  g.lineWidth = 2.4;
  g.strokeStyle = grey(0.14);
  const n = 11 + Math.floor(r() * 4);
  for (let i = 0; i < n; i += 1) {
    const a = -Math.PI + (i / (n - 1)) * Math.PI + (r() - 0.5) * 0.25;
    const len = 26 + r() * 12;
    const ex = cx + Math.cos(a) * len;
    const ey = yTop + Math.sin(a) * len * 0.45 + len * 0.55;
    g.beginPath();
    g.moveTo(cx, yTop);
    g.quadraticCurveTo(cx + Math.cos(a) * len * 0.6, yTop + Math.sin(a) * len * 0.9 - 6, ex, ey);
    g.stroke();
  }
}

// Paint one side of the street into a W x H canvas. `creases` is the panel
// width in px: frontage edges are nudged off the last ~120px before a crease
// so their numbers never break over a fold. Returns each frontage's left edge.
export function paintStreet(W, H, seed, { creases, hills }) {
  const r = rng(seed);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  const groundY = Math.round(H * 0.855);
  const kerbY = Math.round(H * 0.905);

  // Sky: a yellow-filtered B&W sky, darker overhead, glaring at the horizon.
  const sky = g.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, grey(0.6));
  sky.addColorStop(0.65, grey(0.86));
  sky.addColorStop(1, grey(0.94));
  g.fillStyle = sky;
  g.fillRect(0, 0, W, groundY);
  for (let i = 0; i < 9; i += 1) {
    const cx = r() * W;
    const cy = r() * groundY * 0.5;
    const rad = 120 + r() * 260;
    const cl = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
    cl.addColorStop(0, "rgba(255,255,255,0.14)");
    cl.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = cl;
    g.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  }
  if (hills) {
    // The hills behind the Strip, hazed out by distance.
    g.fillStyle = grey(0.7);
    g.beginPath();
    g.moveTo(0, groundY);
    const phase = r() * 10;
    for (let x = 0; x <= W; x += 16) {
      const y = groundY - 120 - 26 * Math.sin(x / 610 + phase) - 14 * Math.sin(x / 173 + phase * 2) - 5 * Math.sin(x / 41);
      g.lineTo(x, y);
    }
    g.lineTo(W, groundY);
    g.fill();
  }

  // Frontages.
  const lots = [];
  let x = -30 + r() * 20;
  while (x < W + 10) {
    const roll = r();
    const kind = roll < 0.42 ? "one" : roll < 0.7 ? "two" : roll < 0.8 ? "tall" : roll < 0.9 ? "lot" : "motel";
    let w = kind === "motel" ? 300 + r() * 120 : kind === "lot" ? 190 + r() * 110 : kind === "tall" ? 200 + r() * 120 : 150 + r() * 210;
    let next = x + w;
    const p = ((next % creases) + creases) % creases;
    if (p > creases - 122) next += creases - p + 8; // push past the fold
    else if (p < 8) next += 8 - p;
    w = next - x;
    if (kind === "lot") lot(g, r, x, w, groundY);
    else if (kind === "motel") motel(g, r, x, w, groundY);
    else {
      const h = kind === "one" ? 92 + r() * 30 : kind === "two" ? 138 + r() * 28 : 172 + r() * 24;
      facade(g, r, x, w, groundY, h, kind);
    }
    if (x > -10) lots.push(x);
    x = next + (r() < 0.12 ? 6 + r() * 14 : 0);
  }

  // Sidewalk, kerb, road.
  g.fillStyle = grey(0.8);
  g.fillRect(0, groundY, W, kerbY - groundY);
  g.fillStyle = grey(0.88);
  g.fillRect(0, kerbY - 3, W, 3);
  g.fillStyle = grey(0.3);
  g.fillRect(0, kerbY, W, 2);
  const road = g.createLinearGradient(0, kerbY, 0, H);
  road.addColorStop(0, grey(0.36));
  road.addColorStop(1, grey(0.26));
  g.fillStyle = road;
  g.fillRect(0, kerbY + 2, W, H - kerbY - 2);

  // Poles and wires, palms, parked cars.
  const poles = [];
  for (let px = 120 + r() * 200; px < W + 400; px += 430 + r() * 260) poles.push(px);
  g.strokeStyle = grey(0.18, 0.75);
  g.lineWidth = 1.1;
  for (let i = 0; i < poles.length - 1; i += 1) {
    for (const [dy, sag] of [[18, 16], [24, 20], [34, 26]]) {
      const a = poles[i];
      const b = poles[i + 1];
      g.beginPath();
      g.moveTo(a, dy);
      g.quadraticCurveTo((a + b) / 2, dy + sag * 2, b, dy);
      g.stroke();
    }
  }
  for (const px of poles) {
    g.fillStyle = grey(0.2);
    g.fillRect(px - 2.5, 8, 5, kerbY - 8);
    g.fillRect(px - 22, 16, 44, 4);
    g.fillRect(px - 16, 30, 32, 3);
    g.fillStyle = "rgba(255,255,255,0.25)";
    g.fillRect(px - 2.5, 8, 1.5, kerbY - 8);
  }
  for (let px = 300 + r() * 500; px < W; px += 700 + r() * 900) palm(g, r, px, kerbY, 6 + r() * 26);
  for (let tx = 500 + r() * 700; tx < W; tx += 900 + r() * 1100) tree(g, r, tx, kerbY);
  for (let cx = r() * 120; cx < W; ) {
    if (r() < 0.62) cx += car(g, r, cx, H - 5) + 14 + r() * 40;
    else cx += 120 + r() * 180;
  }

  // Film and lens: a breath of softness, then grain, then frame-to-frame
  // exposure that steps slightly where Ruscha's negatives were butted up.
  const soft = document.createElement("canvas");
  soft.width = W;
  soft.height = H;
  const sg = soft.getContext("2d");
  sg.filter = "blur(0.8px)";
  sg.drawImage(c, 0, 0);
  const img = sg.getImageData(0, 0, W, H);
  const d = img.data;
  const frame = 560;
  const exposure = Array.from({ length: Math.ceil(W / frame) + 1 }, () => 1 + (r() - 0.5) * 0.07);
  for (let y = 0; y < H; y += 1) {
    for (let xx = 0; xx < W; xx += 1) {
      const i = (y * W + xx) * 4;
      const fi = Math.floor(xx / frame);
      const fx = (xx % frame) / frame;
      const e = exposure[fi] * (1 - 0.05 * (2 * fx - 1) ** 2); // gentle lens falloff
      let v = (d[i] / 255) * e + (Math.random() - 0.5) * 0.07;
      v = Math.max(0, Math.min(1, v));
      d[i] = d[i + 1] = d[i + 2] = v * 255;
    }
  }
  sg.filter = "none";
  sg.putImageData(img, 0, 0);
  return { canvas: soft, lots };
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
