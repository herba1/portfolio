export const SCORCH_BASE = {
  burnRate: 1,
  heatSpread: 1,
  fibre: 0.5,
  wind: 1,
  ember: 1,
  linger: 0.25,
  charTone: 0,
  halo: 1,
  fuse: 0,
};

export const SCORCH_PRESETS = [
  { name: "Paper", values: {} },
  { name: "Board", values: { burnRate: 0.62, heatSpread: 1.3, linger: 0.14, halo: 1.6, ember: 0.85, fibre: 0.3 } },
  { name: "Newsprint", values: { burnRate: 1.55, heatSpread: 0.85, fibre: 1, linger: 0.42, charTone: 1, halo: 0.8, ember: 1.15 } },
  { name: "Fuse", values: { fuse: 1, burnRate: 1.2, heatSpread: 0.9, fibre: 0.35, ember: 1.25, halo: 1.2 } },
];

export const DEFAULT_PRESET = "Paper";

export const SCORCH_CONTROLS = [
  { key: "burnRate", label: "Burn rate", min: 0.3, max: 2, step: 0.05 },
  { key: "heatSpread", label: "Heat spread", min: 0.5, max: 2, step: 0.05 },
  { key: "fibre", label: "Fibre", min: 0, max: 1, step: 0.05 },
  { key: "wind", label: "Wind", min: 0, max: 2, step: 0.05 },
  { key: "ember", label: "Ember", min: 0, max: 2, step: 0.05 },
];

export function presetValues(name) {
  const preset = SCORCH_PRESETS.find((entry) => entry.name === name) ?? SCORCH_PRESETS[0];
  return { ...SCORCH_BASE, ...preset.values };
}

export const SCORCH_DEFAULTS = presetValues(DEFAULT_PRESET);

export const SIM = {
  diffusion: 2.2e-4,
  rateBase: 0.27,
  rateInk: 6.6,
  gain: 1.3,
  loss: 0.33,
  thresholdBase: 0.5,
  thresholdFuel: 0.4,
  thresholdFloor: 0.07,
  fibreThreshold: 0.08,
  paperFloor: 0.2,
  windReach: 0.2,
  windGlobal: 0.12,
  windScale: 0.32,
  windMax: 0.9,
  windEase: 10,
  windDecay: 0.8,
  sourceRadius: 0.025,
  sourceGrow: 0.24,
  sourceHold: 0.6,
  sourceHeat: 1,
  holdSpread: 0.009,
  holdReachMax: 3,
  presimSeconds: 2.6,
  introLimit: 0.04,
  introReach: 1.5,
  introSecondReach: 1.1,
  introSecondDelay: 0.7,
  introSecondOffset: [0.045, 0.03],
  introGrow: 0.014,
  introLinger: 0.8,
  introSmother: 1.2,
  introSmotherRate: 0.4,
  windCool: 6,
};

export const BLEED = { left: 0.2, right: 0.2, top: 0.3, bottom: 0.24 };

export const FLAME = {
  max: 4,
  radius: 0.054,
  heatRate: 8,
  char: 3.2,
  cap: 1.15,
  growRate: 0.22,
  growMax: 0.85,
  stillSpeed: 0.3,
  rise: 16,
  fall: 7,
  tapMs: 240,
  windHover: 0.35,
};

export const DEBRIS = {
  maskSize: 128,
  holeAt: 0.92,
  minTexels: 2,
  fleckTexels: 8,
  lastLabel: 254,
  maxPieces: 96,
  cutDelay: 0.14,
  dilate: 2,
  reference: 1 / 6,
  gravity: 1.1,
  buoyancy: 1.4,
  buoyancyHeat: 0.9,
  buoyancyTau: 0.65,
  dragFlat: 0.9,
  dragEdge: 0.55,
  dragSide: 0.9,
  flutter: 0.9,
  lift: 0.08,
  shrink: 0.2,
  emberTau: 1.5,
  snapGlow: 0.6,
  maxAge: 7,
  hurrySeconds: 0.22,
  updraft: 1.8,
  updraftReach: 0.16,
  push: 0.6,
  fleckLift: 0.95,
  fleckLife: 2.8,
  sinkStart: 0.12,
  sinkEnd: 0.34,
  wobble: 0.45,
  curlReach: 1.1,
  curlFloor: 0.3,
  curlCeiling: 1.5,
  fleckCurl: 1.7,
  curlTau: 0.7,
  curlUnder: 0.2,
  flutterSmall: 0.3,
  flutterBig: 0.05,
  waveSmall: 0.012,
  waveBig: 0.05,
};

export const DETACH = {
  everyMs: 160,
  tailMs: 720,
  goneShare: 0.1,
  holeHeat: 0.4,
  quietShare: 0.002,
};

export const CURL = {
  camera: 2.4,
  grid: 10,
  sheetShift: 0.009,
  sheetSlope: 1.6,
  sheetShade: 0.65,
  shadow: 0.24,
  shadowReach: 0.02,
};
