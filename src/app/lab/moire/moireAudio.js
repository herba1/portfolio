const BASE = 174.61;

export function createMoireSound() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx({ latencyHint: "interactive" });
  const master = ctx.createGain();
  master.gain.value = 0;
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 1400;
  tone.Q.value = 0.3;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 8;
  comp.ratio.value = 3;
  comp.attack.value = 0.01;
  comp.release.value = 0.3;
  tone.connect(master);
  master.connect(comp);
  comp.connect(ctx.destination);

  const voice = (freq, gain, pan) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = gain;
    osc.connect(g);
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      p.connect(tone);
    } else g.connect(tone);
    return osc;
  };
  const a1 = voice(BASE, 0.3, -0.25);
  const b1 = voice(BASE, 0.3, 0.25);
  const a2 = voice(BASE * 3, 0.1, -0.15);
  const b2 = voice(BASE * 3, 0.1, 0.15);
  const a3 = voice(BASE * 5, 0.03, 0);
  const b3 = voice(BASE * 5, 0.03, 0);
  const oscs = [a1, b1, a2, b2, a3, b3];

  let started = false;
  let enabled = false;

  return {
    async setEnabled(on) {
      enabled = on;
      if (on) {
        const resumed = ctx.state === "running" ? Promise.resolve() : ctx.resume().catch(() => {});
        if (!started) {
          started = true;
          const t = ctx.currentTime + 0.02;
          oscs.forEach((o) => o.start(t));
        }
        await resumed;
        if (ctx.state !== "running" || !enabled) return false;
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
        master.gain.linearRampToValueAtTime(0.32, ctx.currentTime + 0.6);
        return true;
      }
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.2);
      await new Promise((r) => setTimeout(r, 260));
      if (!enabled && ctx.state === "running") await ctx.suspend().catch(() => {});
      return false;
    },
    update(beat, clarity) {
      if (!enabled || ctx.state !== "running") return;
      const now = ctx.currentTime;
      b1.frequency.setTargetAtTime(BASE + beat, now, 0.05);
      b2.frequency.setTargetAtTime(BASE * 3 + beat * 3, now, 0.05);
      b3.frequency.setTargetAtTime(BASE * 5 + beat * 5, now, 0.05);
      tone.frequency.setTargetAtTime(900 + 1400 * clarity, now, 0.2);
    },
    destroy() {
      enabled = false;
      try {
        oscs.forEach((o) => o.stop());
      } catch {}
      ctx.close().catch(() => {});
    },
  };
}
