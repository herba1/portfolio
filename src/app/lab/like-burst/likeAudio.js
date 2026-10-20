export function createLikeAudio() {
  let ctx = null;

  const wake = () => {
    if (typeof window === "undefined") return;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
  };

  const blip = (from, to, length, level, type = "sine") => {
    if (!ctx || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.exponentialRampToValueAtTime(to, now + length);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(level, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + length);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + length + 0.02);
  };

  return {
    wake,
    like(big = false) {
      blip(420, 880, 0.12, big ? 0.07 : 0.05);
      setTimeout(() => blip(880, 1320, 0.1, 0.03, "triangle"), 60);
    },
    unlike() {
      blip(520, 260, 0.26, 0.035);
    },
    destroy() {
      ctx?.close();
      ctx = null;
    },
  };
}
