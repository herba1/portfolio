export const SUNRISE = 6;
export const SUNSET = 20.3;
const MOONRISE = 20.45;
const MOONSET = 5.6;
const DEG = Math.PI / 180;

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

function hex(h) {
  const n = parseInt(h.slice(1), 16);
  return [toLinear(((n >> 16) & 255) / 255), toLinear(((n >> 8) & 255) / 255), toLinear((n & 255) / 255)];
}

const PHASES = {
  night: { bounce: 0.22, light: hex("#3240ff"), sat: 0.62, power: 0.5, shadow: hex("#2f00db"), tint: 0.55, ambient: 0.28, fog: [hex("#10266f"), hex("#490a42")], rays: 0.75 },
  dawn: { bounce: 0.24, light: hex("#ffa882"), sat: 0.9, power: 1.05, shadow: hex("#db004f"), tint: 0.22, ambient: 0.62, fog: [hex("#f885ff"), hex("#ff7d24")], rays: 1 },
  day: { bounce: 0.08, light: hex("#ffd2c2"), sat: 0.5, power: 1, shadow: hex("#6d3fff"), tint: 0.15, ambient: 0.84, fog: [hex("#00ffff"), hex("#9b89ff")], rays: 0.32 },
  golden: { bounce: 0.14, light: hex("#ffb45e"), sat: 1, power: 1.14, shadow: hex("#6a37e8"), tint: 0.24, ambient: 0.7, fog: [hex("#ffb36b"), hex("#c77dff")], rays: 1 },
  dusk: { bounce: 0.34, light: hex("#ff8181"), sat: 0.95, power: 1, shadow: hex("#4e009c"), tint: 0.34, ambient: 0.5, fog: [hex("#3e53ff"), hex("#ff4ce4")], rays: 0.9 },
};

const KEYS = [
  [0, "night"],
  [4.6, "night"],
  [6.1, "dawn"],
  [8.6, "day"],
  [16.2, "day"],
  [18.5, "golden"],
  [19.8, "dusk"],
  [21.2, "night"],
  [24, "night"],
];

const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

export const wrap = (h) => ((h % 24) + 24) % 24;

function phaseAt(h) {
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1][0] <= h) i += 1;
  const [h0, n0] = KEYS[i];
  const [h1, n1] = KEYS[i + 1];
  const t = Math.min(1, Math.max(0, (h - h0) / (h1 - h0)));
  const e = t * t * (3 - 2 * t);
  const a = PHASES[n0];
  const b = PHASES[n1];
  const saturate = (p) => mix3([1, 1, 1], p.light, p.sat);
  return {
    light: mix3(saturate(a), saturate(b), e),
    power: mix(a.power, b.power, e),
    shadow: mix3(a.shadow, b.shadow, e),
    tint: mix(a.tint, b.tint, e),
    ambient: mix(a.ambient, b.ambient, e),
    fog0: mix3(a.fog[0], b.fog[0], e),
    fog1: mix3(a.fog[1], b.fog[1], e),
    rays: mix(a.rays, b.rays, e),
    bounce: mix(a.bounce, b.bounce, e),
  };
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function body(h) {
  const dayLen = SUNSET - SUNRISE;
  if (h > SUNRISE - 0.4 && h < SUNSET + 0.15) {
    const u = (h - SUNRISE) / dayLen;
    const az = (u - 0.5) * 2 * 46 * DEG;
    const s = Math.sin(Math.PI * Math.min(1, Math.max(0, u)));
    const el = Math.max(0.4, 57 * Math.pow(s, 1.15)) * DEG;
    const strength = smooth(0, 0.05, Math.pow(s, 1.15));
    return { az, el, strength, moon: false };
  }
  const nightLen = 24 - MOONRISE + MOONSET;
  const u = wrap(h - MOONRISE) / nightLen;
  if (u > 1) return { az: 0, el: 30 * DEG, strength: 0, moon: true };
  const s = Math.sin(Math.PI * u);
  const az = (u - 0.5) * 2 * 40 * DEG;
  const el = Math.max(0.4, 38 * s) * DEG;
  return { az, el, strength: smooth(0, 0.12, s), moon: true };
}

export function dayState(hours) {
  const h = wrap(hours);
  const p = phaseAt(h);
  const b = body(h);
  const ce = Math.cos(b.el);
  const dir = [Math.sin(b.az) * ce, Math.sin(b.el), Math.cos(b.az) * ce];
  const low = 1 - Math.min(1, b.el / (40 * DEG));
  const k = p.power * b.strength;
  return {
    hours: h,
    dir,
    light: [p.light[0] * k, p.light[1] * k, p.light[2] * k],
    hue: p.light,
    moon: b.moon,
    shadow: p.shadow,
    tint: p.tint,
    ambient: p.ambient,
    fog0: p.fog0,
    fog1: p.fog1,
    bounce: p.bounce,
    rays: p.rays * b.strength * (0.35 + 0.65 * low * low),
    dark: p.ambient < 0.34,
    dial: dialAngle(h),
  };
}

export function dialAngle(h) {
  if (h >= SUNRISE && h <= SUNSET) return Math.PI * (1 - (h - SUNRISE) / (SUNSET - SUNRISE));
  const nightLen = 24 - (SUNSET - SUNRISE);
  return -Math.PI * (wrap(h - SUNSET) / nightLen);
}

export function hoursFromAngle(theta) {
  if (theta >= 0) return SUNRISE + (1 - theta / Math.PI) * (SUNSET - SUNRISE);
  const nightLen = 24 - (SUNSET - SUNRISE);
  return wrap(SUNSET + (-theta / Math.PI) * nightLen);
}

export function formatTime(hours) {
  const total = Math.round(wrap(hours) * 60) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

export function toSrgbString(c) {
  const enc = (v) => {
    const x = Math.min(1, Math.max(0, v));
    return Math.round(255 * (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055));
  };
  return `rgb(${enc(c[0])} ${enc(c[1])} ${enc(c[2])})`;
}
