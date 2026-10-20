export const C_MAX = 0.37;

const LUT_SIZE = 4096;
const ENCODE = new Uint8ClampedArray(LUT_SIZE + 1);
for (let i = 0; i <= LUT_SIZE; i += 1) {
  const x = i / LUT_SIZE;
  const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  ENCODE[i] = Math.round(v * 255);
}

const RAD = Math.PI / 180;
const scratch = [0, 0, 0];

export function linearRgb(L, C, h, out = scratch) {
  const a = C * Math.cos(h * RAD);
  const b = C * Math.sin(h * RAD);
  const l1 = L + 0.3963377774 * a + 0.2158037573 * b;
  const m1 = L - 0.1055613458 * a - 0.0638541728 * b;
  const s1 = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l1 * l1 * l1;
  const m = m1 * m1 * m1;
  const s = s1 * s1 * s1;
  out[0] = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  out[1] = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  out[2] = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return out;
}

const LO = -0.000001;
const HI = 1.000001;

export function inSrgb(rgb) {
  return rgb[0] >= LO && rgb[0] <= HI && rgb[1] >= LO && rgb[1] <= HI && rgb[2] >= LO && rgb[2] <= HI;
}

export function inP3(rgb) {
  const r = 0.8224621 * rgb[0] + 0.177538 * rgb[1];
  const g = 0.0331941 * rgb[0] + 0.9668058 * rgb[1];
  const b = 0.0170827 * rgb[0] + 0.0723974 * rgb[1] + 0.9105199 * rgb[2];
  return r >= LO && r <= HI && g >= LO && g <= HI && b >= LO && b <= HI;
}

export function maxChroma(L, h, test = inSrgb) {
  if (L <= 0.0001 || L >= 0.9999) return 0;
  let lo = 0;
  let hi = 0.4;
  for (let i = 0; i < 15; i += 1) {
    const mid = (lo + hi) / 2;
    if (test(linearRgb(L, mid, h))) lo = mid;
    else hi = mid;
  }
  return lo;
}

function encodeByte(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 255;
  return ENCODE[(x * LUT_SIZE) | 0];
}

function encodeExact(x) {
  const c = Math.min(1, Math.max(0, x));
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function mapped(L, C, h) {
  const edge = maxChroma(L, h);
  const c = Math.min(C, edge);
  const rgb = linearRgb(L, c, h, [0, 0, 0]);
  return { rgb: rgb.map((v) => Math.min(1, Math.max(0, v))), clipped: C > edge + 0.0005, edge };
}

export function hexOf(linear) {
  return (
    "#" +
    linear
      .map((v) => Math.round(encodeExact(v) * 255).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

export function luminance(linear) {
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function luminanceOfHex(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lin = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return luminance(lin);
}

export function contrast(y1, y2) {
  const hi = Math.max(y1, y2);
  const lo = Math.min(y1, y2);
  return (hi + 0.05) / (lo + 0.05);
}

export function grade(ratio) {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "AA Large";
  return "Fail";
}

export function paintPlane(image, hue) {
  const { width: w, height: h, data } = image;
  const rgb = [0, 0, 0];
  for (let y = 0; y < h; y += 1) {
    const L = 1 - (y + 0.5) / h;
    const edge = maxChroma(L, hue);
    let i = y * w * 4;
    for (let x = 0; x < w; x += 1, i += 4) {
      const C = Math.min(((x + 0.5) / w) * C_MAX, edge);
      linearRgb(L, C, hue, rgb);
      data[i] = encodeByte(rgb[0]);
      data[i + 1] = encodeByte(rgb[1]);
      data[i + 2] = encodeByte(rgb[2]);
      data[i + 3] = 255;
    }
  }
}

export function paintHue(image, L, C) {
  const { width: w, data } = image;
  const rgb = [0, 0, 0];
  for (let x = 0; x < w; x += 1) {
    const h = ((x + 0.5) / w) * 360;
    const c = Math.min(C, maxChroma(L, h));
    linearRgb(L, c, h, rgb);
    const i = x * 4;
    data[i] = encodeByte(rgb[0]);
    data[i + 1] = encodeByte(rgb[1]);
    data[i + 2] = encodeByte(rgb[2]);
    data[i + 3] = 255;
  }
}

export function edgePoints(hue, test = inSrgb, rows = 96) {
  const points = [];
  for (let i = 0; i <= rows; i += 1) {
    const L = 1 - i / rows;
    points.push([Math.min(maxChroma(L, hue, test) / C_MAX, 1), i / rows]);
  }
  return points;
}

export function pathOf(points) {
  return points.map(([x, y], i) => (i ? "L" : "M") + x.toFixed(4) + " " + y.toFixed(4)).join("");
}

const NAMES = [
  [20, "Rose"],
  [45, "Red"],
  [70, "Orange"],
  [95, "Amber"],
  [115, "Yellow"],
  [135, "Lime"],
  [165, "Green"],
  [190, "Teal"],
  [225, "Cyan"],
  [265, "Blue"],
  [290, "Indigo"],
  [315, "Violet"],
  [345, "Magenta"],
  [361, "Rose"],
];

export function nameOf(L, C, h) {
  if (C < 0.02) return L > 0.6 ? "Stone" : "Graphite";
  const hue = ((h % 360) + 360) % 360;
  return NAMES.find(([limit]) => hue < limit)[1];
}

export function cssOf(L, C, h) {
  const hue = ((h % 360) + 360) % 360;
  return `oklch(${(L * 100).toFixed(1)}% ${C.toFixed(3)} ${hue.toFixed(1)})`;
}
