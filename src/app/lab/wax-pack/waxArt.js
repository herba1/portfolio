export const PACK = { W: 1.14, H: 2.04, h: 0.085, TAB_W: 0.17, TAB_H: 0.075, END: 0.075 };
export const GUM = { w: 0.86, h: 0.7, t: 0.014 };
export const ART_PX = 800;
export const CREASE_PX = 360;

export const CARDS = [
  { src: "/flyout/card-01.jpg", aspect: 660 / 1232, name: "Honus Wagner", role: "Shortstop", team: "Pittsburgh", stats: [["AVG", ".328"], ["Hits", "3,420"]], fact: "Won eight National League batting titles, the last of them in 1911." },
  { src: "/flyout/card-02.jpg", aspect: 660 / 1183, name: "Ty Cobb", role: "Outfield", team: "Detroit", stats: [["AVG", ".366"], ["Hits", "4,189"]], fact: "Retired with the highest career batting average the game has seen." },
  { src: "/flyout/card-03.jpg", aspect: 660 / 1178, name: "Christy Mathewson", role: "Pitcher", team: "New York", stats: [["Wins", "373"], ["ERA", "2.13"]], fact: "Threw three complete-game shutouts in the 1905 World Series." },
  { src: "/flyout/card-04.jpg", aspect: 660 / 1168, name: "Cy Young", role: "Pitcher", team: "Cleveland", stats: [["Wins", "511"], ["CG", "749"]], fact: "The yearly award for the best pitcher in each league carries his name." },
  { src: "/flyout/card-05.jpg", aspect: 660 / 1169, name: "Walter Johnson", role: "Pitcher", team: "Washington", stats: [["Wins", "417"], ["Shutouts", "110"]], fact: "Called the Big Train for a fastball nobody in his day could catch up to." },
  { src: "/flyout/card-06.jpg", aspect: 660 / 1181, name: "Nap Lajoie", role: "Second base", team: "Cleveland", stats: [["AVG", ".338"], ["Triple Crown", "1901"]], fact: "So beloved in Cleveland that the club was renamed the Naps after him." },
  { src: "/flyout/card-07.jpg", aspect: 660 / 1183, name: "Tris Speaker", role: "Outfield", team: "Boston", stats: [["AVG", ".345"], ["Doubles", "792"]], fact: "Still holds the career record for doubles, set over twenty-two seasons." },
  { src: "/flyout/card-08.jpg", aspect: 660 / 1172, name: "Willie Keeler", role: "Outfield", team: "New York", stats: [["AVG", ".341"], ["Hit streak", "44"]], fact: "Hit safely in forty-four straight games to open the 1897 season." },
  { src: "/flyout/card-09.jpg", aspect: 660 / 1188, name: "Joe Tinker", role: "Shortstop", team: "Chicago", stats: [["Titles", "1907, 08"], ["Hall", "1946"]], fact: "The Tinker of Tinker to Evers to Chance, the most famous double play." },
  { src: "/flyout/card-10.jpg", aspect: 660 / 801, name: "Babe Ruth", role: "Outfield", team: "New York", stats: [["Home runs", "714"], ["AVG", ".342"]], fact: "Hit sixty home runs in 1927, a single-season mark that stood for 34 years." },
  { src: "/flyout/card-11.jpg", aspect: 660 / 1176, name: "Pud Galvin", role: "Pitcher", team: "Pittsburgh", stats: [["Wins", "365"], ["First to", "300"]], fact: "The first pitcher in the major leagues to reach three hundred wins." },
  { src: "/flyout/card-12.jpg", aspect: 660 / 1194, name: "King Kelly", role: "Catcher", team: "Boston", stats: [["AVG", ".308"], ["Sold for", "$10,000"]], fact: "Sold to Boston in 1887 for a record price, and sung about in Slide, Kelly, Slide." },
];

const INK = {
  mustard: "#efb52c",
  mustardHi: "#f5c94f",
  mustardLo: "#e3a21c",
  teal: "#11706c",
  tealLo: "#0b5652",
  cream: "#fbf0d4",
  brown: "#3a1d12",
  orange: "#e0522a",
  orangeLo: "#b93b1b",
  pink: "#e38fa6",
};

export function mulberry(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fontStack(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export async function readyFonts() {
  const sans = fontStack("--font-sans", "ui-sans-serif, system-ui, sans-serif");
  const mono = fontStack("--font-mono", "ui-monospace, Menlo, monospace");
  try {
    await Promise.all([document.fonts.load(`900 40px ${sans}`), document.fonts.load(`700 40px ${sans}`), document.fonts.load(`600 40px ${mono}`)]);
  } catch {}
  return { sans, mono, serif: "Georgia, 'Times New Roman', serif" };
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function makeCanvas(w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function speckle(ctx, w, h, seed, amount, light, dark) {
  const random = mulberry(seed);
  const count = Math.round(w * h * amount);
  for (let i = 0; i < count; i += 1) {
    const x = random() * w;
    const y = random() * h;
    const up = random() > 0.5;
    ctx.fillStyle = up ? `rgba(255,250,235,${light * (0.4 + random() * 0.6)})` : `rgba(40,20,10,${dark * (0.4 + random() * 0.6)})`;
    const size = 0.6 + random() * 1.4;
    ctx.fillRect(x, y, size, size);
  }
}

function fitFont(ctx, text, weight, family, targetWidth, maxSize) {
  let size = maxSize;
  ctx.font = `${weight} ${size}px ${family}`;
  const width = ctx.measureText(text).width;
  if (width > targetWidth) size = Math.floor((size * targetWidth) / width);
  ctx.font = `${weight} ${size}px ${family}`;
  return size;
}

function spacedText(ctx, text, x, y, spacing, mode) {
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  let cx = x - total / 2;
  chars.forEach((c, i) => {
    if (mode === "stroke") ctx.strokeText(c, cx, y);
    else ctx.fillText(c, cx, y);
    cx += widths[i] + spacing;
  });
  return total;
}

function extruded(ctx, text, x, y, size, family, opts) {
  const { depth, skew, face, edge, side, spacing = 0 } = opts;
  ctx.save();
  ctx.translate(x, y);
  ctx.transform(1, 0, skew, 1, 0, 0);
  ctx.font = `900 ${size}px ${family}`;
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  ctx.lineWidth = size * 0.14;
  ctx.strokeStyle = edge;
  for (let i = depth; i >= 1; i -= 1) {
    ctx.save();
    ctx.translate(i * 0.7, i);
    spacedText(ctx, text, 0, 0, spacing, "stroke");
    ctx.restore();
  }
  ctx.fillStyle = side;
  for (let i = depth; i >= 1; i -= 1) {
    ctx.save();
    ctx.translate(i * 0.7, i);
    spacedText(ctx, text, 0, 0, spacing, "fill");
    ctx.restore();
  }
  ctx.lineWidth = size * 0.11;
  spacedText(ctx, text, 0, 0, spacing, "stroke");
  ctx.fillStyle = face;
  spacedText(ctx, text, 0, 0, spacing, "fill");
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function baseball(ctx, cx, cy, r) {
  ctx.save();
  ctx.fillStyle = INK.brown;
  ctx.beginPath();
  ctx.arc(cx + r * 0.08, cy + r * 0.1, r * 1.06, 0, Math.PI * 2);
  ctx.fill();
  const grad = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
  grad.addColorStop(0, "#fffaf0");
  grad.addColorStop(0.55, INK.cream);
  grad.addColorStop(0.85, "#ecdcb4");
  grad.addColorStop(1, "#dcc79a");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = r * 0.07;
  ctx.strokeStyle = INK.brown;
  ctx.stroke();
  ctx.clip();
  ctx.strokeStyle = INK.orange;
  ctx.lineWidth = r * 0.05;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + side * r * 1.32, cy, r * 0.82, 0, Math.PI * 2);
    ctx.stroke();
    for (let k = -6; k <= 6; k += 1) {
      const a = Math.PI + (side > 0 ? 0 : Math.PI) + k * 0.13;
      const px = cx + side * r * 1.32 + Math.cos(a) * r * 0.82;
      const py = cy + Math.sin(a) * r * 0.82;
      const nx = Math.cos(a);
      const ny = Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(px - nx * r * 0.07 - ny * r * 0.05, py - ny * r * 0.07 + nx * r * 0.05);
      ctx.lineTo(px + nx * r * 0.07 + ny * r * 0.05, py + ny * r * 0.07 - nx * r * 0.05);
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function wrapperArt(fonts) {
  const P = ART_PX;
  const W = Math.round(PACK.W * P);
  const tab = Math.round(PACK.TAB_H * P);
  const H = Math.round(PACK.H * P);
  const canvas = makeCanvas(W, H + tab);
  const ctx = canvas.getContext("2d");
  const end = PACK.END * P;
  ctx.save();
  ctx.translate(0, tab);

  ctx.fillStyle = INK.mustard;
  ctx.fillRect(0, 0, W, H);
  const sx = W * 0.5;
  const sy = H * 0.33;
  const rays = 32;
  for (let i = 0; i < rays; i += 1) {
    const a0 = (i / rays) * Math.PI * 2;
    const a1 = ((i + 0.5) / rays) * Math.PI * 2;
    ctx.fillStyle = INK.mustardHi;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.cos(a0) * H * 1.4, sy + Math.sin(a0) * H * 1.4);
    ctx.lineTo(sx + Math.cos(a1) * H * 1.4, sy + Math.sin(a1) * H * 1.4);
    ctx.closePath();
    ctx.fill();
  }
  const glow = ctx.createRadialGradient(sx, sy, W * 0.05, sx, sy, H * 0.75);
  glow.addColorStop(0, "rgba(255,236,170,0.55)");
  glow.addColorStop(0.35, "rgba(255,226,140,0.22)");
  glow.addColorStop(0.7, "rgba(230,160,30,0.06)");
  glow.addColorStop(1, "rgba(200,120,20,0.22)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = INK.brown;
  ctx.lineWidth = W * 0.012;
  roundRect(ctx, W * 0.05, end + W * 0.035, W * 0.9, H - 2 * end - W * 0.07, W * 0.04);
  ctx.stroke();
  ctx.strokeStyle = INK.cream;
  ctx.lineWidth = W * 0.006;
  roundRect(ctx, W * 0.068, end + W * 0.053, W * 0.864, H - 2 * end - W * 0.106, W * 0.03);
  ctx.stroke();

  ctx.save();
  ctx.translate(W * 0.5, H * 0.585);
  ctx.rotate(-0.2);
  ctx.fillStyle = INK.brown;
  ctx.fillRect(-W, -H * 0.068 + 6, W * 2, H * 0.136);
  ctx.fillStyle = INK.teal;
  ctx.fillRect(-W, -H * 0.068, W * 2, H * 0.13);
  ctx.fillStyle = INK.tealLo;
  ctx.fillRect(-W, H * 0.048, W * 2, H * 0.014);
  ctx.fillStyle = INK.cream;
  ctx.fillRect(-W, -H * 0.06, W * 2, H * 0.005);
  ctx.fillRect(-W, H * 0.04, W * 2, H * 0.005);
  const bandSize = fitFont(ctx, "BASEBALL", 900, fonts.sans, W * 0.74, H * 0.07);
  ctx.textBaseline = "middle";
  ctx.fillStyle = INK.brown;
  spacedText(ctx, "BASEBALL", 4, 6, bandSize * 0.1, "fill");
  ctx.fillStyle = INK.cream;
  spacedText(ctx, "BASEBALL", 0, 0, bandSize * 0.1, "fill");
  ctx.restore();

  const hotSize = fitFont(ctx, "HOT", 900, fonts.sans, W * 0.5, H * 0.16);
  extruded(ctx, "HOT", W * 0.43, H * 0.255, hotSize, fonts.sans, { depth: 16, skew: -0.2, face: INK.cream, edge: INK.brown, side: INK.orange, spacing: hotSize * 0.02 });
  baseball(ctx, W * 0.79, H * 0.17, W * 0.12);
  const cornerSize = fitFont(ctx, "CORNER", 900, fonts.sans, W * 0.74, H * 0.12);
  extruded(ctx, "CORNER", W * 0.5, H * 0.395, cornerSize, fonts.sans, { depth: 13, skew: -0.2, face: INK.cream, edge: INK.brown, side: INK.orange, spacing: cornerSize * 0.01 });

  ctx.fillStyle = INK.brown;
  ctx.textBaseline = "middle";
  fitFont(ctx, "BUBBLE GUM & PICTURE CARDS", 800, fonts.sans, W * 0.66, H * 0.03);
  ctx.textAlign = "center";
  ctx.fillText("BUBBLE GUM & PICTURE CARDS", W * 0.5, H * 0.445);
  ctx.textAlign = "left";

  ctx.save();
  ctx.translate(W * 0.33, H * 0.775);
  ctx.fillStyle = INK.brown;
  roundRect(ctx, -W * 0.25, -H * 0.06, W * 0.5, H * 0.12, W * 0.04);
  ctx.fill();
  ctx.strokeStyle = INK.cream;
  ctx.lineWidth = 3;
  roundRect(ctx, -W * 0.235, -H * 0.052, W * 0.47, H * 0.104, W * 0.03);
  ctx.stroke();
  ctx.fillStyle = INK.cream;
  ctx.textBaseline = "middle";
  const twelve = fitFont(ctx, "12", 900, fonts.sans, W * 0.2, H * 0.07);
  ctx.font = `900 ${twelve}px ${fonts.sans}`;
  ctx.fillText("12", -W * 0.205, H * 0.004);
  fitFont(ctx, "PICTURE", 800, fonts.sans, W * 0.2, H * 0.03);
  ctx.textAlign = "left";
  ctx.fillText("PICTURE", -W * 0.04, -H * 0.022);
  ctx.fillText("CARDS", -W * 0.04, H * 0.022);
  ctx.restore();

  ctx.save();
  ctx.translate(W * 0.74, H * 0.77);
  ctx.rotate(0.16);
  ctx.fillStyle = INK.brown;
  ctx.beginPath();
  ctx.arc(5, 7, W * 0.145, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = INK.orange;
  ctx.beginPath();
  ctx.arc(0, 0, W * 0.145, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = INK.cream;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, 0, W * 0.125, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = INK.cream;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const price = fitFont(ctx, "35¢", 900, fonts.sans, W * 0.19, H * 0.07);
  ctx.font = `900 ${price}px ${fonts.sans}`;
  ctx.fillText("35¢", 0, H * 0.004);
  ctx.restore();

  ctx.fillStyle = INK.brown;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  fitFont(ctx, "SERIES 2", 800, fonts.sans, W * 0.2, H * 0.022);
  ctx.textAlign = "center";
  ctx.fillText("SERIES 2 · 1986", W * 0.5, H * 0.685);
  fitFont(ctx, "HOT CORNER GUM CO. · DAYTON, OHIO", 700, fonts.sans, W * 0.6, H * 0.016);
  ctx.fillText("HOT CORNER GUM CO. · DAYTON, OHIO", W * 0.5, H * 0.875);

  for (const top of [true, false]) {
    const y0 = top ? 0 : H - end;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y0, W, end);
    ctx.clip();
    ctx.fillStyle = INK.mustardLo;
    ctx.fillRect(0, y0, W, end);
    ctx.fillStyle = "rgba(58,29,18,0.85)";
    ctx.font = `800 ${Math.round(end * 0.32)}px ${fonts.sans}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    let x = -40;
    const word = "HOT CORNER  ·  ";
    const ww = ctx.measureText(word).width;
    while (x < W) {
      ctx.fillText(word, x, y0 + end * 0.52);
      x += ww;
    }
    ctx.strokeStyle = "rgba(58,29,18,0.16)";
    ctx.lineWidth = 1;
    for (let k = -end; k < W + end; k += 5) {
      ctx.beginPath();
      ctx.moveTo(k, y0);
      ctx.lineTo(k + end * 0.5, y0 + end);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(58,29,18,0.4)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (top) {
      ctx.moveTo(0, end);
      ctx.lineTo(W * 0.16, 0);
      ctx.moveTo(W, end);
      ctx.lineTo(W * 0.84, 0);
    } else {
      ctx.moveTo(0, H - end);
      ctx.lineTo(W * 0.16, H);
      ctx.moveTo(W, H - end);
      ctx.lineTo(W * 0.84, H);
    }
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = "rgba(58,29,18,0.5)";
    ctx.fillRect(0, top ? end - 1.5 : H - end - 0.5, W, 2);
    ctx.fillStyle = "rgba(255,240,200,0.45)";
    ctx.fillRect(0, top ? end + 0.5 : H - end - 2.5, W, 1.5);
  }

  speckle(ctx, W, H, 11, 0.012, 0.12, 0.08);
  ctx.restore();

  const tw = PACK.TAB_W * P;
  ctx.save();
  ctx.fillStyle = INK.cream;
  roundRect(ctx, W / 2 - tw / 2, 0, tw, tab + end * 0.9, tw * 0.16);
  ctx.fill();
  ctx.strokeStyle = INK.brown;
  ctx.lineWidth = 3;
  roundRect(ctx, W / 2 - tw / 2 + 6, 6, tw - 12, tab + end * 0.9 - 12, tw * 0.12);
  ctx.stroke();
  ctx.fillStyle = INK.orange;
  ctx.beginPath();
  const ax = W / 2;
  const ay = tab * 0.62;
  const as = tab * 0.32;
  ctx.moveTo(ax - as, ay - as * 0.55);
  ctx.lineTo(ax + as, ay - as * 0.55);
  ctx.lineTo(ax, ay + as * 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = INK.brown;
  ctx.font = `800 ${Math.round(end * 0.3)}px ${fonts.sans}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("PULL", ax, tab + end * 0.42);
  ctx.restore();
  return canvas;
}

function ridge(ctx, pts, strength, sign) {
  const color = sign > 0 ? "255,255,255" : "0,0,0";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const layers = [
    [9, 0.05],
    [5, 0.08],
    [2.4, 0.12],
    [1.1, 0.16],
  ];
  for (const [width, alpha] of layers) {
    ctx.strokeStyle = `rgba(${color},${Math.min(1, alpha * strength)})`;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }
}

function crinkleLine(random, x, y, angle, length, kinks) {
  const pts = [[x, y]];
  let a = angle;
  let px = x;
  let py = y;
  const step = length / kinks;
  for (let i = 0; i < kinks; i += 1) {
    a += (random() - 0.5) * 0.5;
    px += Math.cos(a) * step;
    py += Math.sin(a) * step;
    pts.push([px, py]);
  }
  return pts;
}

export function creaseCanvas() {
  const P = CREASE_PX;
  const W = Math.round(PACK.W * P);
  const tab = Math.round(PACK.TAB_H * P);
  const H = Math.round(PACK.H * P);
  return { canvas: makeCanvas(W, H + tab), W, H, tab, P };
}

export function drawBaseCreases(crease, seed) {
  const { canvas, W, H, tab, P } = crease;
  const ctx = canvas.getContext("2d");
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "rgb(128,128,128)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const random = mulberry(seed);
  ctx.save();
  ctx.translate(0, tab);
  for (let i = 0; i < 70; i += 1) {
    const x = random() * W;
    const y = random() * H;
    const angle = random() * Math.PI * 2;
    const length = (0.05 + random() * random() * 0.42) * P;
    ridge(ctx, crinkleLine(random, x, y, angle, length, 3), 0.35 + random() * 0.6, random() > 0.45 ? 1 : -1);
  }
  const end = PACK.END * P;
  for (const top of [true, false]) {
    const y0 = top ? 0 : H - end;
    for (let k = 0; k < W; k += 3) {
      ctx.fillStyle = k % 6 === 0 ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";
      ctx.fillRect(k, y0 + 2, 1.5, end - 4);
    }
    ridge(ctx, [[0, top ? end : H - end], [W, top ? end : H - end]], 1.6, -1);
    ridge(ctx, top ? [[2, end], [W * 0.16, 1]] : [[2, H - end], [W * 0.16, H - 1]], 1.2, 1);
    ridge(ctx, top ? [[W - 2, end], [W * 0.84, 1]] : [[W - 2, H - end], [W * 0.84, H - 1]], 1.2, 1);
  }
  const ix = ((PACK.W - 1) / 2) * P;
  const iy = ((PACK.H - 1.79) / 2) * P;
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 7;
  roundRect(ctx, ix, iy, W - 2 * ix, H - 2 * iy, 10);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 2.5;
  roundRect(ctx, ix, iy, W - 2 * ix, H - 2 * iy, 10);
  ctx.stroke();
  ctx.restore();
}

export function stampCrease(crease, random, u, v, angle, lengthWorld, strength) {
  const { canvas, tab, P } = crease;
  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.translate(0, tab);
  const pts = crinkleLine(random, u * PACK.W * P, v * PACK.H * P, angle, lengthWorld * P, 3 + Math.floor(random() * 3));
  ridge(ctx, pts, strength, random() > 0.35 ? 1 : -1);
  ctx.restore();
}

export function gumArt(seed) {
  const P = 560;
  const w = Math.round(GUM.w * P);
  const h = Math.round(GUM.h * P);
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d");
  const random = mulberry(seed);
  const pts = [];
  const edge = (x0, y0, x1, y1, n) => {
    for (let i = 0; i < n; i += 1) {
      const t = i / n;
      const jitter = (random() - 0.5) * 3.5;
      const nx = -(y1 - y0);
      const ny = x1 - x0;
      const len = Math.hypot(nx, ny);
      pts.push([x0 + (x1 - x0) * t + (nx / len) * jitter, y0 + (y1 - y0) * t + (ny / len) * jitter]);
    }
  };
  const m = 6;
  const chip = 0.16 + random() * 0.06;
  edge(m + 10, m, w - m - w * chip, m, 28);
  pts.push([w - m - w * chip * 0.55, m + h * 0.03]);
  pts.push([w - m - w * chip * 0.3, m + h * chip * 0.4]);
  edge(w - m, m + h * chip * 0.9, w - m, h - m - 10, 26);
  edge(w - m - 10, h - m, m + 10, h - m, 28);
  edge(m, h - m - 10, m, m + 10, 26);
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = "#e7a8b8";
  ctx.fillRect(0, 0, w, h);
  const blot = (cells, alphaLight, alphaDark) => {
    const cw = Math.max(2, Math.round(w / cells));
    const ch = Math.max(2, Math.round(h / cells));
    const small = makeCanvas(cw, ch);
    const sctx = small.getContext("2d");
    const img = sctx.createImageData(cw, ch);
    for (let i = 0; i < cw * ch; i += 1) {
      const n = random();
      const light = n > 0.5;
      img.data[i * 4] = light ? 255 : 170;
      img.data[i * 4 + 1] = light ? 236 : 90;
      img.data[i * 4 + 2] = light ? 242 : 120;
      img.data[i * 4 + 3] = Math.round(Math.abs(n - 0.5) * 2 * (light ? alphaLight : alphaDark) * 255);
    }
    sctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(small, -w * 0.05, -h * 0.05, w * 1.1, h * 1.1);
  };
  blot(40, 0.22, 0.1);
  blot(14, 0.18, 0.06);
  const shade = ctx.createLinearGradient(0, 0, w, h);
  shade.addColorStop(0, "rgba(255,240,245,0.18)");
  shade.addColorStop(0.45, "rgba(255,240,245,0.04)");
  shade.addColorStop(0.8, "rgba(160,80,105,0.05)");
  shade.addColorStop(1, "rgba(150,70,95,0.12)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < w * h * 0.35; i += 1) {
    const x = random() * w;
    const y = random() * h;
    const up = random() > 0.5;
    ctx.fillStyle = up ? `rgba(255,240,244,${0.05 + random() * 0.08})` : `rgba(150,70,95,${0.04 + random() * 0.07})`;
    ctx.fillRect(x, y, 1, 1);
  }
  const mask = makeCanvas(Math.round(w / 24), Math.round(h / 24));
  const mctx = mask.getContext("2d");
  const mimg = mctx.createImageData(mask.width, mask.height);
  for (let i = 0; i < mask.width * mask.height; i += 1) mimg.data[i * 4] = Math.round(random() * 255);
  mctx.putImageData(mimg, 0, 0);
  const big = makeCanvas(w, h);
  const bctx = big.getContext("2d");
  bctx.imageSmoothingEnabled = true;
  bctx.drawImage(mask, 0, 0, w, h);
  const density = bctx.getImageData(0, 0, w, h).data;
  for (let i = 0; i < w * h * 0.16; i += 1) {
    const x = Math.floor(random() * w);
    const y = Math.floor(random() * h);
    const edgeDist = Math.min(x, y, w - x, h - y);
    const p = 0.12 + 0.7 * Math.pow(density[(y * w + x) * 4] / 255, 2.2) + 0.6 * Math.exp(-edgeDist / 26);
    if (random() > p) continue;
    ctx.fillStyle = `rgba(255,252,250,${0.18 + random() * 0.5})`;
    const sz = 0.8 + random() * 1.4;
    ctx.fillRect(x, y, sz, sz);
  }
  const crack = (x, y, a, len) => {
    const line = [[x, y]];
    let px = x;
    let py = y;
    let ang = a;
    const n = 6 + Math.floor(random() * 6);
    for (let i = 0; i < n; i += 1) {
      ang += (random() - 0.5) * 0.9;
      px += Math.cos(ang) * (len / n);
      py += Math.sin(ang) * (len / n);
      line.push([px, py]);
    }
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(255,236,240,0.7)";
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    line.forEach(([lx, ly], i) => (i ? ctx.lineTo(lx + 1.2, ly + 1.2) : ctx.moveTo(lx + 1.2, ly + 1.2)));
    ctx.stroke();
    ctx.strokeStyle = "rgba(120,45,70,0.75)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    line.forEach(([lx, ly], i) => (i ? ctx.lineTo(lx, ly) : ctx.moveTo(lx, ly)));
    ctx.stroke();
    return line;
  };
  for (let i = 0; i < 4; i += 1) {
    const side = Math.floor(random() * 4);
    const t = 0.15 + random() * 0.7;
    const starts = [
      [t * w, m, Math.PI / 2],
      [w - m, t * h, Math.PI],
      [t * w, h - m, -Math.PI / 2],
      [m, t * h, 0],
    ];
    const [x, y, a] = starts[side];
    const line = crack(x, y, a + (random() - 0.5) * 0.6, (0.25 + random() * 0.45) * Math.min(w, h));
    if (random() > 0.4) {
      const [bx, by] = line[Math.floor(line.length / 2)];
      crack(bx, by, a + (random() > 0.5 ? 1 : -1) * (0.8 + random() * 0.6), 30 + random() * 60);
    }
  }
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.clip();
  ctx.lineJoin = "round";
  ctx.lineWidth = 7;
  const trace = (ox, oy) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x + ox, y + oy) : ctx.moveTo(x + ox, y + oy)));
    ctx.closePath();
  };
  trace(-2, -2);
  ctx.strokeStyle = "rgba(255,246,248,0.55)";
  ctx.stroke();
  trace(2, 2);
  ctx.strokeStyle = "rgba(140,60,88,0.35)";
  ctx.stroke();
  ctx.restore();
  return canvas;
}

export function backArt(card, number, fonts) {
  const P = 420;
  const w = P;
  const h = Math.round(P / card.aspect);
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d");
  const random = mulberry(number * 977 + 13);
  const stock = ctx.createLinearGradient(0, 0, w, h);
  stock.addColorStop(0, "#cfc5b2");
  stock.addColorStop(0.5, "#c9bea9");
  stock.addColorStop(1, "#c2b6a0");
  ctx.fillStyle = stock;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 260; i += 1) {
    ctx.strokeStyle = random() > 0.5 ? "rgba(90,70,50,0.08)" : "rgba(255,250,240,0.1)";
    ctx.lineWidth = 0.6 + random();
    const x = random() * w;
    const y = random() * h;
    const a = random() * Math.PI;
    const l = 3 + random() * 9;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  speckle(ctx, w, h, number * 31 + 7, 0.02, 0.08, 0.12);
  const m = w * 0.06;
  const ink = "#33241b";
  const spot = INK.orange;
  const mis = 1.5;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 3;
  roundRect(ctx, m, m, w - 2 * m, h - 2 * m, 8);
  ctx.stroke();

  ctx.fillStyle = spot;
  ctx.globalAlpha = 0.92;
  roundRect(ctx, m + 10 + mis, m + 10, w - 2 * m - 20, h * 0.15, 6);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(m + 10 + h * 0.075, m + 10 + h * 0.075, h * 0.058, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e9dfc8";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `900 ${Math.round(h * 0.05)}px ${fonts.sans}`;
  ctx.fillText(String(number), m + 10 + h * 0.075, m + 10 + h * 0.077);
  ctx.fillStyle = ink;
  ctx.textAlign = "left";
  const nameX = m + 20 + h * 0.15;
  fitFont(ctx, card.name.toUpperCase(), 900, fonts.sans, w - nameX - m - 16, h * 0.045);
  ctx.fillText(card.name.toUpperCase(), nameX, m + 10 + h * 0.055);
  ctx.font = `600 ${Math.round(h * 0.026)}px ${fonts.sans}`;
  ctx.fillText(`${card.role} · ${card.team}`, nameX, m + 10 + h * 0.105);

  const statTop = m + 10 + h * 0.19;
  const boxH = h * 0.2;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  roundRect(ctx, m + 10, statTop, w - 2 * m - 20, boxH, 6);
  ctx.stroke();
  ctx.fillStyle = "rgba(224,82,42,0.16)";
  roundRect(ctx, m + 10 + mis, statTop, w - 2 * m - 20, h * 0.045, 6);
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.font = `800 ${Math.round(h * 0.022)}px ${fonts.sans}`;
  ctx.textAlign = "left";
  ctx.fillText("CAREER", m + 22, statTop + h * 0.024);
  const colW = (w - 2 * m - 20) / 2;
  card.stats.forEach(([label, value], i) => {
    const cx = m + 10 + colW * i + colW / 2;
    ctx.textAlign = "center";
    ctx.font = `900 ${Math.round(h * 0.062)}px ${fonts.sans}`;
    fitFont(ctx, value, 900, fonts.sans, colW - 24, h * 0.062);
    ctx.fillText(value, cx, statTop + h * 0.105);
    ctx.font = `600 ${Math.round(h * 0.022)}px ${fonts.sans}`;
    ctx.fillText(label, cx, statTop + h * 0.165);
  });
  ctx.beginPath();
  ctx.moveTo(m + 10 + colW, statTop + h * 0.06);
  ctx.lineTo(m + 10 + colW, statTop + boxH - h * 0.02);
  ctx.stroke();

  const factTop = statTop + boxH + h * 0.04;
  ctx.fillStyle = spot;
  ctx.font = `900 ${Math.round(h * 0.026)}px ${fonts.sans}`;
  ctx.textAlign = "left";
  ctx.fillText("HOT CORNER FACT", m + 14 + mis, factTop);
  ctx.fillStyle = ink;
  ctx.font = `500 ${Math.round(h * 0.03)}px ${fonts.serif}`;
  const words = card.fact.split(" ");
  let line = "";
  let y = factTop + h * 0.05;
  const maxW = w - 2 * m - 28;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, m + 14, y);
      line = word;
      y += h * 0.04;
    } else line = test;
  }
  if (line) ctx.fillText(line, m + 14, y);

  const footY = h - m - h * 0.08;
  ctx.save();
  ctx.translate(w / 2, footY);
  ctx.rotate(Math.PI / 4);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  ctx.strokeRect(-h * 0.022, -h * 0.022, h * 0.044, h * 0.044);
  ctx.fillStyle = spot;
  ctx.fillRect(-h * 0.008, -h * 0.008, h * 0.016, h * 0.016);
  ctx.restore();
  ctx.fillStyle = ink;
  ctx.textAlign = "center";
  ctx.font = `700 ${Math.round(h * 0.02)}px ${fonts.sans}`;
  ctx.fillText(`HOT CORNER GUM CO. · SERIES 2 · No. ${number} of 12`, w / 2, footY + h * 0.05);
  return canvas;
}
