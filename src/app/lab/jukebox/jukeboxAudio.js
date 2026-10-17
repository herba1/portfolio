const SRC = "/blog/audio/friday-beat.wav";

export function createJukeboxAudio() {
  let ctx = null;
  let master = null;
  let music = null;
  let foley = null;
  let buffer = null;
  let loading = null;
  let noise = null;
  let crackle = null;
  let voice = null;
  let muted = false;
  let pending = null;

  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC({ latencyHint: "interactive" });
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);

    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i += 1) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 1.6) / Math.tanh(1.6);
    }
    shaper.curve = curve;
    shaper.oversample = "2x";
    const high = ctx.createBiquadFilter();
    high.type = "highpass";
    high.frequency.value = 110;
    high.Q.value = 0.6;
    const body = ctx.createBiquadFilter();
    body.type = "peaking";
    body.frequency.value = 340;
    body.Q.value = 0.9;
    body.gain.value = 4.5;
    const horn = ctx.createBiquadFilter();
    horn.type = "peaking";
    horn.frequency.value = 1500;
    horn.Q.value = 1.1;
    horn.gain.value = 3;
    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 3200;
    low.Q.value = 0.7;
    const low2 = ctx.createBiquadFilter();
    low2.type = "lowpass";
    low2.frequency.value = 5200;
    low2.Q.value = 0.5;
    const cabinet = ctx.createDelay(0.05);
    cabinet.delayTime.value = 0.011;
    const cabinetGain = ctx.createGain();
    cabinetGain.gain.value = 0.16;
    music = ctx.createGain();
    music.gain.value = 0.62;
    music.connect(high);
    high.connect(body);
    body.connect(horn);
    horn.connect(shaper);
    shaper.connect(low);
    low.connect(low2);
    low2.connect(master);
    low2.connect(cabinet);
    cabinet.connect(cabinetGain);
    cabinetGain.connect(master);

    foley = ctx.createGain();
    foley.gain.value = 0.5;
    foley.connect(master);

    const length = ctx.sampleRate * 2;
    noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noise.getChannelData(0);
    let seed = 7;
    for (let i = 0; i < length; i += 1) {
      seed = (seed * 16807) % 2147483647;
      data[i] = (seed / 2147483647) * 2 - 1;
    }
    crackle = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const cd = crackle.getChannelData(0);
    let lp = 0;
    for (let i = 0; i < cd.length; i += 1) {
      seed = (seed * 16807) % 2147483647;
      const r = seed / 2147483647;
      lp += (r * 2 - 1 - lp) * 0.08;
      let v = lp * 0.035;
      if (r > 0.99965) v += (r > 0.99985 ? 0.5 : 0.22) * (i % 2 ? 1 : -1);
      cd[i] = v;
    }
    return true;
  }

  function load() {
    if (loading) return loading;
    loading = fetch(SRC)
      .then((r) => r.arrayBuffer())
      .then((data) => ctx.decodeAudioData(data))
      .then((decoded) => {
        buffer = decoded;
        if (pending) {
          const p = pending;
          pending = null;
          startVoice(p.rate);
        }
        return decoded;
      })
      .catch(() => null);
    return loading;
  }

  function unlock() {
    if (!ctx && !build()) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    load();
  }

  function burst({ at = 0, freq = 2400, q = 2, gain = 0.3, decay = 0.03, thump = 0 }) {
    if (!ctx || muted || ctx.state !== "running") return;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = freq;
    band.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(band);
    band.connect(g);
    g.connect(foley);
    src.start(t, Math.random() * 1.5, decay + 0.02);
    if (thump > 0) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(60, t + 0.08);
      const og = ctx.createGain();
      og.gain.setValueAtTime(thump, t);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      osc.connect(og);
      og.connect(foley);
      osc.start(t);
      osc.stop(t + 0.12);
    }
  }

  function click(intensity) {
    burst({ freq: 1800 + intensity * 900, q: 3, gain: 0.08 + intensity * 0.14, decay: 0.035, thump: 0.18 + intensity * 0.2 });
  }

  function clunk() {
    burst({ freq: 900, q: 1.2, gain: 0.12, decay: 0.06, thump: 0.32 });
  }

  function startVoice(rate) {
    if (!ctx || !buffer) return;
    stopVoice(0.02);
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + 0.09);
    src.connect(g);
    g.connect(music);
    const cr = ctx.createBufferSource();
    cr.buffer = crackle;
    cr.loop = true;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0, t);
    cg.gain.linearRampToValueAtTime(0.9, t + 0.05);
    cr.connect(cg);
    cg.connect(music);
    src.start(t + 0.04);
    cr.start(t);
    voice = { src, g, cr, cg };
  }

  function stopVoice(fade = 0.14) {
    if (!voice || !ctx) return;
    const { src, g, cr, cg } = voice;
    voice = null;
    const t = ctx.currentTime;
    for (const node of [g, cg]) {
      node.gain.cancelScheduledValues(t);
      node.gain.setValueAtTime(node.gain.value, t);
      node.gain.linearRampToValueAtTime(0, t + fade);
    }
    src.playbackRate.setTargetAtTime(src.playbackRate.value * 0.82, t, fade);
    src.stop(t + fade + 0.05);
    cr.stop(t + fade + 0.05);
  }

  function needleDown(rate) {
    if (!ctx) return;
    burst({ freq: 700, q: 0.8, gain: 0.2, decay: 0.05, thump: 0.12 });
    if (buffer) startVoice(rate);
    else pending = { rate };
  }

  function needleUp() {
    pending = null;
    if (voice) burst({ freq: 1200, q: 1, gain: 0.1, decay: 0.04 });
    stopVoice();
  }

  function setMuted(value) {
    muted = value;
    if (!ctx) return;
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(value ? 0 : 1, t + 0.12);
  }

  function suspend() {
    if (ctx && ctx.state === "running") ctx.suspend().catch(() => {});
  }

  function resume() {
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
  }

  function destroy() {
    stopVoice(0.01);
    if (ctx) ctx.close().catch(() => {});
    ctx = null;
  }

  return { unlock, click, clunk, needleDown, needleUp, setMuted, suspend, resume, destroy, get unlocked() {
    return Boolean(ctx);
  } };
}
