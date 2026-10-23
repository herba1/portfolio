import { soundAllowed } from "@/lib/sound/desktopOnly";
import { workletSource } from "./scopeSynth";

export function createScopeSound(size) {
  if (!soundAllowed()) return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx || typeof AudioWorkletNode === "undefined") return null;
  const ctx = new Ctx({ latencyHint: "interactive" });
  const master = ctx.createGain();
  master.gain.value = 0;
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 5200;
  tone.Q.value = 0.5;
  const body = ctx.createBiquadFilter();
  body.type = "highpass";
  body.frequency.value = 38;
  tone.connect(body);
  body.connect(master);
  master.connect(ctx.destination);
  const splitter = ctx.createChannelSplitter(2);
  const left = ctx.createAnalyser();
  const right = ctx.createAnalyser();
  left.fftSize = 2048;
  right.fftSize = 2048;
  splitter.connect(left, 0);
  splitter.connect(right, 1);
  const bufL = new Float32Array(2048);
  const bufR = new Float32Array(2048);

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
        node = new AudioWorkletNode(ctx, "scope-xy", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { size } });
        node.connect(tone);
        node.connect(splitter);
        return true;
      })
      .catch(() => false);
    return loading;
  };

  return {
    get live() {
      return enabled && node !== null && ctx.state === "running";
    },
    get sampleRate() {
      return ctx.sampleRate;
    },
    async setEnabled(on, state) {
      enabled = on;
      if (on) {
        const resumed = ctx.state === "running" ? Promise.resolve() : ctx.resume().catch(() => {});
        const ok = await load();
        await resumed;
        if (!ok || ctx.state !== "running" || !enabled) return false;
        node.port.postMessage({ type: "state", state });
        const now = ctx.currentTime;
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(master.gain.value, now);
        master.gain.linearRampToValueAtTime(0.075, now + 0.4);
        return true;
      }
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(0, now + 0.12);
      await new Promise((r) => setTimeout(r, 160));
      if (!enabled && ctx.state === "running") await ctx.suspend().catch(() => {});
      return false;
    },
    target(message) {
      if (node) node.port.postMessage({ type: "target", ...message });
    },
    read(count) {
      if (!node) return null;
      left.getFloatTimeDomainData(bufL);
      right.getFloatTimeDomainData(bufR);
      const n = Math.min(2048, count);
      return { x: bufL.subarray(2048 - n), y: bufR.subarray(2048 - n), n };
    },
    destroy() {
      enabled = false;
      node?.disconnect();
      ctx.close().catch(() => {});
      if (url) URL.revokeObjectURL(url);
    },
  };
}
