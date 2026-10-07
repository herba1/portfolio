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
  turnoverAt: 0.92,
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
