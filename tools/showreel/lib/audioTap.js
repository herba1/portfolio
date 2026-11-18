// Runs inside the recorded page (an init script) when a reel sets `audio`.
//
// The page's clock is frozen and stepped a frame at a time, so a real
// AudioContext would run on wall time and drift away from the picture. Every
// AudioContext the page makes is instead an OfflineAudioContext that renders
// only as far as the page's own clock has gone: the recorder calls
// __audioAdvance() after each frame, and the context renders up to that
// instant and suspends. currentTime therefore means exactly what the page
// thinks it means, and every scheduled sound lands on the frame that caused
// it. At the end __audioFinish() renders the tail and hands back each
// context's samples with the capture time it was born at.
(() => {
  const Offline = window.OfflineAudioContext;
  if (!Offline) return;
  const SR = 48000;
  const SECONDS = 60;
  const Q = 128 / SR; // render quantum: suspend points snap to it
  const contexts = [];
  window.__vt = 0;

  function TapContext(options = {}) {
    const ctx = new Offline({ numberOfChannels: 2, length: SR * SECONDS, sampleRate: SR });
    const suspend = ctx.suspend.bind(ctx);
    const resume = ctx.resume.bind(ctx);
    let state = "running";
    let target = Q;
    const entry = { ctx, bornVt: window.__vt, bornNow: performance.now(), done: null, suspend, resume, rendering: false };
    // Hold at the first quantum, then let the recorder walk it forward.
    suspend(Q).catch(() => {});
    entry.done = ctx.startRendering();
    Object.defineProperty(ctx, "state", { get: () => state, configurable: true });
    Object.defineProperty(ctx, "baseLatency", { value: 0, configurable: true });
    Object.defineProperty(ctx, "outputLatency", { value: 0, configurable: true });
    ctx.resume = () => Promise.resolve();
    ctx.suspend = () => Promise.resolve();
    ctx.close = () => { state = "closed"; return Promise.resolve(); };
    ctx.getOutputTimestamp = () => ({ contextTime: ctx.currentTime, performanceTime: performance.now() });
    entry.advance = async () => {
      const want = (performance.now() - entry.bornNow) / 1000;
      const next = Math.ceil(want / Q) * Q;
      if (next <= target + 1e-9 || next >= SECONDS - Q) return;
      target = next;
      const reached = suspend(target).catch(() => {});
      await resume().catch(() => {});
      await reached;
    };
    contexts.push(entry);
    return ctx;
  }
  TapContext.prototype = window.AudioContext ? window.AudioContext.prototype : Offline.prototype;
  window.AudioContext = TapContext;
  window.webkitAudioContext = TapContext;

  window.__audioAdvance = async (vt) => {
    window.__vt = vt;
    for (const e of contexts) await e.advance();
  };

  window.__audioFinish = async (endVt) => {
    const out = [];
    for (const e of contexts) {
      await e.resume().catch(() => {});
      const buffer = await e.done;
      const usable = Math.min(buffer.length, Math.ceil(((endVt - e.bornVt) / 1000) * SR));
      if (usable <= 0) continue;
      const pcm = new Int16Array(usable * 2);
      const L = buffer.getChannelData(0), R = buffer.getChannelData(1);
      let peak = 0;
      for (let i = 0; i < usable; i++) {
        const l = Math.max(-1, Math.min(1, L[i])), r = Math.max(-1, Math.min(1, R[i]));
        peak = Math.max(peak, Math.abs(l), Math.abs(r));
        pcm[i * 2] = l * 32767;
        pcm[i * 2 + 1] = r * 32767;
      }
      if (peak < 1e-4) continue; // a context that never made a sound
      const bytes = new Uint8Array(pcm.buffer);
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      out.push({ at: e.bornVt, rate: SR, b64: btoa(bin) });
    }
    return out;
  };
})();
