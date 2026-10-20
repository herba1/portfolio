export function createSaveAudio() {
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

  const tone = (freq, at, length, level) => {
    if (!ctx || ctx.state !== "running") return;
    const now = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(level, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + length);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + length + 0.02);
  };

  return {
    wake,
    track() {
      tone(1320, 0, 0.08, 0.018);
    },
    done() {
      tone(784, 0, 0.3, 0.04);
      tone(1175, 0.09, 0.4, 0.035);
      tone(1568, 0.18, 0.5, 0.025);
    },
    cancel() {
      tone(520, 0, 0.12, 0.03);
      tone(390, 0.06, 0.16, 0.025);
    },
    destroy() {
      ctx?.close();
      ctx = null;
    },
  };
}
