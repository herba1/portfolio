export const TILT = 0.42;
export const DESIGN = 240;

export const MODULES = [
  { id: "park", title: "Park", kind: "park" },
  { id: "source", title: "Friday beat", kind: "source", knob: { label: "Level", value: 0.72 }, jacks: ["Out"] },
  { id: "lowpass", title: "Low pass", kind: "effect", knob: { label: "Cutoff", value: 0.46 }, jacks: ["In", "Out"] },
  { id: "echo", title: "Tape echo", kind: "effect", knob: { label: "Time", value: 0.42 }, jacks: ["In", "Out"] },
  { id: "wobble", title: "Wobble", kind: "effect", knob: { label: "Depth", value: 0.5 }, jacks: ["In", "Out"] },
  { id: "crush", title: "Crush", kind: "effect", knob: { label: "Bits", value: 0.55 }, jacks: ["In", "Out"] },
  { id: "room", title: "Room", kind: "effect", knob: { label: "Wet", value: 0.42 }, jacks: ["In", "Out"] },
  { id: "output", title: "Output", kind: "output", knob: { label: "Volume", value: 0.78 }, jacks: ["In"] },
];

export const EFFECT_IDS = ["lowpass", "echo", "wobble", "crush", "room"];

const ORDER_WIDE = ["park", "source", "lowpass", "echo", "wobble", "crush", "room", "output"];
const ORDER_TALL = ["source", "lowpass", "echo", "wobble", "crush", "room", "output", "park"];

export const CABLES = [
  { color: [222, 214, 196], from: "source:Out", to: "lowpass:In", slack: 1.18 },
  { color: [168, 72, 58], from: "lowpass:Out", to: "room:In", slack: 1.08 },
  { color: [62, 88, 112], from: "park:2", to: "park:3", length: 0.72 },
  { color: [184, 140, 62], from: "park:1", to: "park:4", length: 0.98 },
  { color: [104, 122, 92], from: "park:0", to: "park:5", length: 1.24 },
];

function pickGrid(w, h) {
  const options = [
    [4, 2],
    [2, 4],
    [8, 1],
  ];
  let best = options[0];
  let bestScore = Infinity;
  for (const [cols, rows] of options) {
    const aspect = w / cols / (h / rows);
    const score = Math.abs(Math.log(aspect / 0.92));
    if (score < bestScore) {
      bestScore = score;
      best = [cols, rows];
    }
  }
  return best;
}

export function computeLayout({ width, height, top, side, bottom, embedded }) {
  const availW = Math.max(160, width - side * 2);
  const availH = Math.max(160, height - top - bottom);
  const [cols, rows] = pickGrid(availW, availH);
  const order = cols >= 4 ? ORDER_WIDE : ORDER_TALL;
  const frame = Math.max(6, Math.round(Math.min(availW / cols, availH / rows) * 0.035));
  const railFor = (cell) => Math.max(8, Math.round(cell * 0.05));
  let cellH = (availH - frame * 2) / rows;
  let rail = railFor(Math.min(availW / cols, cellH));
  let modW = (availW - frame * 2) / cols;
  let modH = cellH - rail * 2;
  let u = Math.min(modW / DESIGN, modH / DESIGN);
  const minU = embedded ? 0.6 : 0.56;
  let caseW = availW;
  let caseH = availH;
  let caseX = side;
  let caseY = top;
  if (u < minU) {
    const grow = minU / u;
    u = minU;
    modW *= grow;
    modH *= grow;
    rail = railFor(Math.min(modW, modH));
    caseW = modW * cols + frame * 2;
    caseH = (modH + rail * 2) * rows + frame * 2;
    const focusIndex = order.indexOf("lowpass");
    const fc = focusIndex % cols;
    const fr = Math.floor(focusIndex / cols);
    const focusX = frame + (fc + 0.5) * modW;
    const focusY = frame + (fr + 0.85) * (modH + rail * 2);
    caseX = Math.min(side, Math.max(width - side - caseW, width / 2 - focusX));
    caseY = Math.min(top, Math.max(height - bottom - caseH, top + availH / 2 - focusY));
  } else {
    caseW = modW * cols + frame * 2;
    caseH = (modH + rail * 2) * rows + frame * 2;
    caseX = side + (availW - caseW) / 2;
    caseY = top + (availH - caseH) / 2;
  }
  const d = 13 * u;
  const modules = [];
  const jacks = [];
  const knobs = [];
  const rails = [];
  for (let r = 0; r < rows; r += 1) {
    const rowY = caseY + frame + r * (modH + rail * 2);
    rails.push({ x: caseX + frame, y: rowY, w: modW * cols, h: rail });
    rails.push({ x: caseX + frame, y: rowY + rail + modH, w: modW * cols, h: rail });
  }
  order.forEach((id, index) => {
    const spec = MODULES.find((m) => m.id === id);
    const c = index % cols;
    const r = Math.floor(index / cols);
    const x = caseX + frame + c * modW;
    const y = caseY + frame + r * (modH + rail * 2) + rail;
    const face = (r + c) % 2 === 0 ? "black" : "alu";
    const cx = x + modW / 2;
    const mod = { ...spec, index, x, y, w: modW, h: modH, cx, face, number: String(index + 1).padStart(2, "0") };
    const jackY = y + modH * 0.84;
    const spread = Math.min(46 * u, modW * 0.22);
    if (spec.kind === "park") {
      const step = Math.min(44 * u, modW * 0.155);
      for (let i = 0; i < 6; i += 1) {
        jacks.push({ id: `park:${i}`, module: mod, kind: "park", x: cx + (i - 2.5) * step, y: y + 72 * u, label: "", plug: null, glow: 0 });
      }
    } else if (spec.kind === "output") {
      const vuW = Math.min(modW * 0.8, 176 * u);
      const vuH = Math.min(vuW * 0.6, modH * 0.42);
      mod.vu = { x: cx - vuW / 2, y: y + modH * 0.44 - vuH / 2, w: vuW, h: vuH, angle: 0 };
      jacks.push({ id: "output:In", module: mod, kind: "jack", x: cx - spread, y: jackY, label: "In", plug: null, glow: 0 });
      knobs.push({ id: "output", module: mod, x: cx + spread, y: jackY, r: 17 * u, small: true, label: spec.knob.label, value: spec.knob.value, shown: spec.knob.value });
    } else {
      const ky = y + modH * 0.42;
      knobs.push({ id: spec.id, module: mod, x: cx, y: ky, r: 26 * u, small: false, label: spec.knob.label, value: spec.knob.value, shown: spec.knob.value });
      if (spec.jacks.length === 1) {
        jacks.push({ id: `${spec.id}:${spec.jacks[0]}`, module: mod, kind: "jack", x: cx, y: jackY, label: spec.jacks[0], plug: null, glow: 0 });
      } else {
        spec.jacks.forEach((label, i) => {
          jacks.push({ id: `${spec.id}:${label}`, module: mod, kind: "jack", x: cx + (i ? spread : -spread), y: jackY, label, plug: null, glow: 0 });
        });
      }
    }
    modules.push(mod);
  });
  return {
    width,
    height,
    cols,
    rows,
    u,
    d,
    frame,
    rail,
    modW,
    modH,
    modSize: Math.sqrt(modW * modH),
    case: { x: caseX, y: caseY, w: caseW, h: caseH },
    rails,
    modules,
    jacks,
    knobs,
    nutR: 12.5 * u,
    plug: {
      sleeve: 4.2 * d,
      collar: 0.7 * d,
      body: 2.6 * d,
      boot: 2.4 * d,
      seat: 3 * u,
    },
  };
}
