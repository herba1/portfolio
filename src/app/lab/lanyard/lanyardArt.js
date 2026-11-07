import { loadCover } from "../_kit/covers";

// Print for a 1964 backstage pass, painted once into a canvas atlas:
// front on the left half, back on the right. 1024 px per card width.
const PX = 1024;
const CW = PX;
const CH = Math.round(PX * 1.5);

const PAPER = "#eee3c9";
const LAMINATE = "#f6f2e8";
const INK = "#1c1915";
const RED = "#ad2d1b";
const CREAM = "#f4ead2";

// On screen the card is about 170 css px wide, so texture px × 0.17 is the
// type's real size. Tracking follows the house law at that size.
const SCREEN = 0.17;
const track = (sizeTex) => {
  const s = sizeTex * SCREEN;
  return (-0.043 * (s - 12)) / SCREEN;
};

function fontFamilies() {
  const css = getComputedStyle(document.body);
  const sans = css.getPropertyValue("--font-geist-sans").trim() || "Geist, sans-serif";
  const mono = css.getPropertyValue("--font-geist-mono").trim() || "ui-monospace, monospace";
  return { sans, mono };
}

function text(ctx, str, x, y, { size, weight = 600, family, color = INK, align = "left" }) {
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.letterSpacing = `${track(size).toFixed(2)}px`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(str, x, y);
}

function grain(ctx, x, y, w, h, amount, seed = 7) {
  let a = seed;
  const rnd = () => {
    a = (a * 16807) % 2147483647;
    return a / 2147483647;
  };
  for (let i = 0; i < w * h * 0.02; i += 1) {
    ctx.fillStyle = rnd() > 0.5 ? `rgba(60,40,20,${amount})` : `rgba(255,250,240,${amount})`;
    ctx.fillRect(x + rnd() * w, y + rnd() * h, 1.5, 1.5);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function front(ctx, cover, { sans, mono }) {
  const m = 34;
  ctx.fillStyle = LAMINATE;
  ctx.fillRect(0, 0, CW, CH);
  roundRect(ctx, m, m, CW - m * 2, CH - m * 2, 22);
  ctx.fillStyle = PAPER;
  ctx.fill();
  ctx.save();
  ctx.clip();

  const L = 84;
  // Header row, under the clip: tiny mono on either side.
  text(ctx, "No. 0417", L, 196, { size: 34, weight: 500, family: mono });
  text(ctx, "Aug 23 ’64", CW - L, 196, { size: 34, weight: 500, family: mono, align: "right" });

  // The red block.
  const top = 236;
  const blockH = 500;
  ctx.fillStyle = RED;
  ctx.fillRect(m, top, CW - m * 2, blockH);
  text(ctx, "Back", L - 10, top + 222, { size: 260, weight: 800, family: sans, color: CREAM });
  text(ctx, "stage", L - 10, top + 436, { size: 260, weight: 800, family: sans, color: CREAM });

  // Photo window and the bill.
  const py = top + blockH + 64;
  const ps = 284;
  ctx.fillStyle = INK;
  ctx.fillRect(L - 8, py - 8, ps + 16, ps + 16);
  if (cover) {
    ctx.drawImage(cover, L, py, ps, ps);
    ctx.fillStyle = "rgba(238,227,201,0.12)";
    ctx.fillRect(L, py, ps, ps);
  }
  const tx = L + ps + 56;
  text(ctx, "The Beatles", tx, py + 62, { size: 68, weight: 750, family: sans });
  text(ctx, "Hollywood Bowl", tx, py + 130, { size: 44, weight: 500, family: sans });
  text(ctx, "Los Angeles", tx, py + 182, { size: 44, weight: 500, family: sans });
  text(ctx, "Sunday 8 pm", tx, py + 262, { size: 34, weight: 500, family: mono });

  // Rule and the tier.
  const ry = py + ps + 64;
  ctx.fillStyle = INK;
  ctx.fillRect(L, ry, CW - L * 2, 6);
  text(ctx, "All access", L - 4, ry + 156, { size: 132, weight: 800, family: sans });
  ctx.fillRect(L, CH - m - 120, CW - L * 2, 2);
  text(ctx, "Admit bearer only. Not transferable.", L, CH - m - 62, { size: 30, weight: 500, family: mono });

  grain(ctx, m, m, CW - m * 2, CH - m * 2, 0.06);
  ctx.restore();
  // Where the paper stops inside the laminate.
  roundRect(ctx, m, m, CW - m * 2, CH - m * 2, 22);
  ctx.strokeStyle = "rgba(90,70,40,0.18)";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function back(ctx, { sans, mono }) {
  const m = 34;
  ctx.fillStyle = LAMINATE;
  ctx.fillRect(0, 0, CW, CH);
  roundRect(ctx, m, m, CW - m * 2, CH - m * 2, 22);
  ctx.fillStyle = PAPER;
  ctx.fill();
  ctx.save();
  ctx.clip();
  const L = 84;
  text(ctx, "Conditions", L, 330, { size: 64, weight: 700, family: sans });
  const lines = [
    "This pass must be worn",
    "where it can be seen at",
    "all times backstage.",
    "",
    "Valid for the date shown.",
    "Void if altered.",
  ];
  lines.forEach((l, i) => text(ctx, l, L, 420 + i * 58, { size: 38, weight: 500, family: mono }));
  const fy = 900;
  ["Name", "Crew", "Issued by"].forEach((label, i) => {
    const y = fy + i * 130;
    text(ctx, label, L, y, { size: 36, weight: 600, family: sans });
    ctx.fillStyle = INK;
    ctx.fillRect(L + 220, y + 8, CW - L * 2 - 220, 3);
  });
  // A rubber stamp, a little off true.
  ctx.save();
  ctx.translate(CW - 290, 1300);
  ctx.rotate(-0.21);
  ctx.strokeStyle = "rgba(191,58,34,0.78)";
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(0, 0, 128, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, 106, 0, Math.PI * 2);
  ctx.stroke();
  text(ctx, "Checked", 0, -8, { size: 50, weight: 800, family: sans, color: "rgba(191,58,34,0.8)", align: "center" });
  text(ctx, "23.8.64", 0, 46, { size: 34, weight: 600, family: mono, color: "rgba(191,58,34,0.8)", align: "center" });
  ctx.restore();
  grain(ctx, m, m, CW - m * 2, CH - m * 2, 0.06, 13);
  ctx.restore();
  roundRect(ctx, m, m, CW - m * 2, CH - m * 2, 22);
  ctx.strokeStyle = "rgba(90,70,40,0.18)";
  ctx.lineWidth = 2;
  ctx.stroke();
}

export async function paintCard() {
  const fams = fontFamilies();
  const wait = (p) => Promise.race([p, new Promise((r) => setTimeout(r, 2000))]);
  const [cover] = await Promise.all([
    wait(loadCover("a-hard-days-night")).catch(() => null),
    wait(Promise.all([800, 750, 700, 600, 500].map((wt) => document.fonts.load(`${wt} 100px ${fams.sans}`)).concat(document.fonts.load(`500 40px ${fams.mono}`)))).catch(() => null),
  ]);
  const canvas = document.createElement("canvas");
  canvas.width = CW * 2;
  canvas.height = CH;
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "alphabetic";
  front(ctx, cover && cover.naturalWidth ? cover : null, fams);
  ctx.save();
  ctx.translate(CW, 0);
  back(ctx, fams);
  ctx.restore();
  return { canvas };
}

// The strap: a tight rib weave in deep red with selvage edges and a cream
// woven repeat. Returns a colour map and a matching normal map.
export function paintStrap() {
  const w = 128;
  const h = 1024;
  const aspect = h / w;
  const fams = fontFamilies();
  const color = document.createElement("canvas");
  color.width = w;
  color.height = h;
  const c = color.getContext("2d");
  c.fillStyle = "#9c2c1b";
  c.fillRect(0, 0, w, h);
  // The repeat, woven in: cream type along the strap.
  c.save();
  c.translate(w / 2, h);
  c.rotate(-Math.PI / 2);
  const size = 46;
  c.font = `700 ${size}px ${fams.sans}`;
  c.letterSpacing = "0px";
  c.fillStyle = "#efe1c4";
  c.textBaseline = "middle";
  const word = "Backstage  ·  Hollywood Bowl  ·  ";
  const ww = c.measureText(word).width;
  const reps = Math.max(1, Math.round(h / ww));
  const scale = h / (ww * reps);
  c.scale(scale, 1);
  for (let i = 0; i < reps; i += 1) c.fillText(word, i * ww, 2);
  c.restore();

  // Ribs: one every 4 px across the strap, alternating light and shade.
  const height = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const rib = 0.5 + 0.5 * Math.cos((y / 4) * Math.PI * 2);
    for (let x = 0; x < w; x += 1) {
      const thread = 0.5 + 0.5 * Math.cos((x / 3) * Math.PI * 2 + (Math.floor(y / 4) % 2) * Math.PI);
      let hgt = rib * 0.75 + thread * 0.25;
      const e = Math.min(x, w - 1 - x);
      if (e < 6) hgt = 0.6 + 0.4 * Math.cos((y / 3) * Math.PI);
      height[y * w + x] = hgt;
    }
  }
  const img = c.getImageData(0, 0, w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const k = 0.82 + height[y * w + x] * 0.22;
      const e = Math.min(x, w - 1 - x);
      const edge = e < 6 ? 0.78 : 1;
      img.data[i] = Math.min(255, img.data[i] * k * edge);
      img.data[i + 1] = Math.min(255, img.data[i + 1] * k * edge);
      img.data[i + 2] = Math.min(255, img.data[i + 2] * k * edge);
    }
  }
  c.putImageData(img, 0, 0);

  const normal = document.createElement("canvas");
  normal.width = w;
  normal.height = h;
  const n = normal.getContext("2d");
  const nd = n.createImageData(w, h);
  const H = (x, y) => height[((y + h) % h) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * 1.2;
      const dy = (H(x, y + 1) - H(x, y - 1)) * 1.2;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      nd.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      nd.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      nd.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      nd.data[i + 3] = 255;
    }
  }
  n.putImageData(nd, 0, 0);
  return { color, normal, aspect };
}

// Orange peel: the faint waviness of a heat-sealed pouch, as a normal map.
export function paintPeel() {
  const s = 256;
  const cells = 16;
  let a = 99;
  const rnd = () => {
    a = (a * 16807) % 2147483647;
    return a / 2147483647;
  };
  const grid = Array.from({ length: cells * cells }, rnd);
  const at = (x, y) => grid[(((y % cells) + cells) % cells) * cells + (((x % cells) + cells) % cells)];
  const noise = (u, v) => {
    const x = u * cells;
    const y = v * cells;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const p = at(xi, yi);
    const q = at(xi + 1, yi);
    const r = at(xi, yi + 1);
    const t = at(xi + 1, yi + 1);
    return p + (q - p) * sx + (r - p) * sy + (p - q - r + t) * sx * sy;
  };
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(s, s);
  const e = 1 / s;
  for (let y = 0; y < s; y += 1) {
    for (let x = 0; x < s; x += 1) {
      const u = x / s;
      const v = y / s;
      const dx = (noise(u + e, v) - noise(u - e, v)) * 6;
      const dy = (noise(u, v + e) - noise(u, v - e)) * 6;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * s + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
