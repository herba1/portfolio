import { workletSource } from "./spectroSynth";

export function createSpectroSound({ freqs, gains, colRate, fftSize }) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx || typeof AudioWorkletNode === "undefined") return null;
  const ctx = new Ctx({ latencyHint: "interactive" });
  const analyser = ctx.createAnalyser();
  analyser.fftSize = fftSize;
  analyser.smoothingTimeConstant = 0;
  analyser.minDecibels = -140;
  analyser.maxDecibels = 0;
  const master = ctx.createGain();
  master.gain.value = 0;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 10;
  comp.ratio.value = 4;
  comp.attack.value = 0.004;
  comp.release.value = 0.2;
  master.connect(comp);
  comp.connect(ctx.destination);
  const spectrum = new Float32Array(analyser.frequencyBinCount);

  let node = null;
  let loading = null;
  let enabled = false;
  let url = "";

  const load = () => {
    if (loading) return loading;
    url = URL.createObjectURL(new Blob([workletSource()], { type: "application/javascript" }));
    loading = ctx.audioWorklet
      .addModule(url)
      .then(() => {
        node = new AudioWorkletNode(ctx, "spectro-bank", {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          processorOptions: { freqs: Array.from(freqs), gains: Array.from(gains), colRate },
        });
        node.connect(analyser);
        node.connect(master);
        return true;
      })
      .catch(() => false);
    return loading;
  };

  return {
    get live() {
      return enabled && node !== null && ctx.state === "running";
    },
    get currentTime() {
      return ctx.currentTime;
    },
    get sampleRate() {
      return ctx.sampleRate;
    },
    resume() {
      if (ctx.state !== "running") ctx.resume().catch(() => {});
    },
    async enable(getState) {
      enabled = true;
      const resumed = ctx.state === "running" ? Promise.resolve() : ctx.resume().catch(() => {});
      const ok = await load();
      await resumed;
      if (!ok || !enabled) return false;
      node.port.postMessage({ type: "state", state: getState() });
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(0, now);
      master.gain.linearRampToValueAtTime(1.4, now + 0.6);
      return true;
    },
    push(data, cols) {
      if (node) node.port.postMessage({ type: "push", data, cols });
    },
    clear() {
      if (node) node.port.postMessage({ type: "clear" });
    },
    read() {
      analyser.getFloatFrequencyData(spectrum);
      return spectrum;
    },
    suspend() {
      if (ctx.state === "running") ctx.suspend().catch(() => {});
    },
    destroy() {
      enabled = false;
      node?.disconnect();
      ctx.close().catch(() => {});
      if (url) URL.revokeObjectURL(url);
    },
  };
}
