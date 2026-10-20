function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function buildLoop(ctx) {
  const rate = ctx.sampleRate;
  const seconds = 2;
  const length = rate * seconds;
  const buffer = ctx.createBuffer(2, length, rate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const rand = rng(1969);
  let lp = 0;
  let bp1 = 0;
  let bp2 = 0;
  for (let i = 0; i < length; i += 1) {
    const n = rand() * 2 - 1;
    lp += (n - lp) * 0.02;
    left[i] = lp * 0.18 + n * 0.012;
    right[i] = lp * 0.16 + n * 0.012;
  }
  const clicks = 24 * seconds;
  for (let c = 0; c < clicks; c += 1) {
    const start = Math.floor((c / clicks) * length + (rand() - 0.5) * rate * 0.0012);
    const strong = c % 2 === 0;
    const amp = (strong ? 0.5 : 0.32) * (0.85 + rand() * 0.3);
    const dur = Math.floor(rate * (strong ? 0.012 : 0.008));
    bp1 = 0;
    bp2 = 0;
    for (let k = 0; k < dur; k += 1) {
      const i = (start + k + length) % length;
      const env = Math.exp(-k / (rate * 0.0022));
      const n = rand() * 2 - 1;
      bp1 += (n - bp1) * 0.45;
      bp2 += (bp1 - bp2) * 0.45;
      const v = (bp1 - bp2) * amp * env;
      left[i] += v;
      right[i] += v * 0.9;
    }
    const thump = Math.floor(rate * 0.02);
    for (let k = 0; k < thump; k += 1) {
      const i = (start + k + length) % length;
      const v = Math.sin((k / rate) * Math.PI * 2 * 92) * Math.exp(-k / (rate * 0.006)) * amp * 0.25;
      left[i] += v;
      right[i] += v;
    }
  }
  for (let i = 0; i < length; i += 1) {
    const hum = Math.sin((i / rate) * Math.PI * 2 * 48) * 0.02 + Math.sin((i / rate) * Math.PI * 2 * 96) * 0.008;
    left[i] += hum;
    right[i] += hum;
  }
  const fade = Math.floor(rate * 0.004);
  for (let k = 0; k < fade; k += 1) {
    const w = k / fade;
    left[k] *= w;
    right[k] *= w;
    left[length - 1 - k] *= w;
    right[length - 1 - k] *= w;
  }
  return buffer;
}

const VOWELS = [
  [800, 1200, 2500],
  [500, 1900, 2550],
  [320, 2250, 2950],
  [520, 920, 2400],
  [360, 860, 2300],
  [560, 1480, 2480],
  [690, 1680, 2450],
  [420, 1250, 2350],
];

function buildRoom(ctx) {
  const rate = ctx.sampleRate;
  const length = rate * 6;
  const buffer = ctx.createBuffer(2, length, rate);
  const rand = rng(2001);
  for (let c = 0; c < 2; c += 1) {
    const d = buffer.getChannelData(c);
    let brown = 0;
    let pink = 0;
    for (let i = 0; i < length; i += 1) {
      const n = rand() * 2 - 1;
      brown = (brown + n * 0.02) * 0.998;
      pink += (n - pink) * 0.08;
      d[i] = brown * 1.6 + pink * 0.05;
    }
    const fade = Math.floor(rate * 0.25);
    for (let k = 0; k < fade; k += 1) {
      const w = k / fade;
      const a = d[k];
      const b = d[length - fade + k];
      d[length - fade + k] = b * (1 - w) + a * w;
    }
    for (let k = 0; k < fade; k += 1) d[k] = d[length - fade + k];
  }
  return buffer;
}

function buildNoise(ctx, seconds, seed) {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const buffer = ctx.createBuffer(1, length, rate);
  const d = buffer.getChannelData(0);
  const rand = rng(seed);
  for (let i = 0; i < length; i += 1) d[i] = rand() * 2 - 1;
  return buffer;
}

function buildHall(ctx) {
  const rate = ctx.sampleRate;
  const seconds = 3.2;
  const length = Math.floor(rate * seconds);
  const pre = Math.floor(rate * 0.024);
  const buffer = ctx.createBuffer(2, length, rate);
  const rand = rng(77);
  for (let c = 0; c < 2; c += 1) {
    const d = buffer.getChannelData(c);
    let lp = 0;
    for (let i = pre; i < length; i += 1) {
      const t = (i - pre) / rate;
      const n = rand() * 2 - 1;
      const k = 0.5 * Math.exp(-t / 0.7) + 0.04;
      lp += (n - lp) * k;
      const env = Math.exp(-t / 0.62) * Math.min(1, t / 0.012);
      d[i] = lp * env * 0.6;
    }
  }
  return buffer;
}

export function createCreditsAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  let ctx = null;
  let enabled = true;
  let listener = null;
  let lastReport = "";
  let timer = 0;
  let projectorSrc = null;
  let tone = null;
  let projectorGain = null;
  let master = null;
  let bed = null;
  let crowd = null;
  let whisperBus = null;
  let hall = null;
  let noise = null;
  let voices = [];
  let nextWhisper = 0;
  let ended = false;
  let side = 1;
  const rand = rng(31);

  const report = () => {
    const next = !enabled ? "off" : ctx && ctx.state === "running" ? "on" : "pending";
    if (next === lastReport) return;
    lastReport = next;
    listener?.(next);
  };

  const makeVoice = (i) => {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    const base = i % 2 === 0 ? 108 + rand() * 30 : 186 + rand() * 46;
    osc.frequency.value = base;
    const breath = ctx.createBufferSource();
    breath.buffer = noise;
    breath.loop = true;
    const breathGain = ctx.createGain();
    breathGain.gain.value = 0.18;
    const sum = ctx.createGain();
    sum.gain.value = 0.5;
    const f1 = ctx.createBiquadFilter();
    f1.type = "bandpass";
    f1.Q.value = 5;
    const f2 = ctx.createBiquadFilter();
    f2.type = "bandpass";
    f2.Q.value = 7;
    const f2Gain = ctx.createGain();
    f2Gain.gain.value = 0.55;
    const env = ctx.createGain();
    env.gain.value = 0;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (pan.pan) pan.pan.value = ((i / 5) * 2 - 1) * 0.85 + (rand() - 0.5) * 0.1;
    osc.connect(sum);
    breath.connect(breathGain);
    breathGain.connect(sum);
    sum.connect(f1);
    sum.connect(f2);
    f2.connect(f2Gain);
    f1.connect(env);
    f2Gain.connect(env);
    env.connect(pan);
    pan.connect(crowd);
    const start = ctx.currentTime + 0.05;
    osc.start(start);
    breath.start(start, rand() * 3);
    return { osc, breath, f1, f2, env, base, next: start + rand() * 2.5, left: 0, level: 0.5 + rand() * 0.5 };
  };

  const speak = (voice, horizon) => {
    while (voice.next < horizon) {
      const t = voice.next;
      if (voice.left <= 0) {
        voice.left = 4 + Math.floor(rand() * 10);
        voice.level = 0.45 + rand() * 0.55;
        voice.pitch = voice.base * (0.94 + rand() * 0.14);
        voice.next = t + 0.35 + rand() * 1.6;
        voice.env.gain.setTargetAtTime(0, t, 0.06);
        voice.osc.frequency.setTargetAtTime(voice.pitch * 1.06, voice.next, 0.05);
        continue;
      }
      const syl = 0.13 + rand() * 0.16;
      const [a, b] = VOWELS[Math.floor(rand() * VOWELS.length)];
      voice.f1.frequency.setTargetAtTime(a, t, 0.03);
      voice.f2.frequency.setTargetAtTime(b, t, 0.04);
      voice.pitch *= 0.985 + rand() * 0.02;
      voice.osc.frequency.setTargetAtTime(voice.pitch * (0.97 + rand() * 0.07), t, 0.05);
      const peak = voice.level * (0.6 + rand() * 0.4);
      voice.env.gain.setTargetAtTime(peak, t, 0.025);
      voice.env.gain.setTargetAtTime(peak * 0.25, t + syl * 0.6, 0.04);
      voice.left -= 1;
      voice.next = t + syl + (rand() < 0.2 ? 0.06 + rand() * 0.12 : 0);
    }
  };

  const whisper = (t0) => {
    const words = 2 + Math.floor(rand() * 4);
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const formants = [
      [ctx.createBiquadFilter(), 1, 9],
      [ctx.createBiquadFilter(), 0.75, 11],
      [ctx.createBiquadFilter(), 0.35, 12],
    ];
    const env = ctx.createGain();
    env.gain.value = 0;
    for (const [f, g, q] of formants) {
      f.type = "bandpass";
      f.Q.value = q;
      const fg = ctx.createGain();
      fg.gain.value = g * 2.6;
      src.connect(f);
      f.connect(fg);
      fg.connect(env);
    }
    const hiss = ctx.createBiquadFilter();
    hiss.type = "highpass";
    hiss.frequency.value = 3600;
    const hissEnv = ctx.createGain();
    hissEnv.gain.value = 0;
    src.connect(hiss);
    hiss.connect(hissEnv);
    const soft = ctx.createBiquadFilter();
    soft.type = "lowpass";
    soft.frequency.value = 5200;
    soft.Q.value = 0.5;
    env.connect(soft);
    hissEnv.connect(soft);
    const panner = ctx.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = 1;
    panner.rolloffFactor = 0.8;
    side = -side;
    const angle = side * (0.45 + rand() * 0.95);
    const dist = 3 + rand() * 2.6;
    const x = Math.sin(angle) * dist;
    const z = -Math.cos(angle) * dist;
    soft.connect(panner);
    panner.connect(whisperBus);
    let t = t0;
    for (let w = 0; w < words; w += 1) {
      const syllables = 1 + Math.floor(rand() * 3);
      if (rand() < 0.55) {
        const sDur = 0.06 + rand() * 0.09;
        hissEnv.gain.setTargetAtTime(0.42, t, 0.015);
        hissEnv.gain.setTargetAtTime(0, t + sDur, 0.02);
        hiss.frequency.setValueAtTime(rand() < 0.5 ? 3600 : 5200, t);
        t += sDur * 0.8;
      } else if (rand() < 0.6) {
        hissEnv.gain.setTargetAtTime(0.3, t, 0.002);
        hissEnv.gain.setTargetAtTime(0, t + 0.012, 0.008);
        t += 0.03;
      }
      for (let k = 0; k < syllables; k += 1) {
        const v = VOWELS[Math.floor(rand() * VOWELS.length)];
        const dur = 0.1 + rand() * 0.14;
        formants.forEach(([f], j) => f.frequency.setTargetAtTime(v[j] * (1.06 + rand() * 0.06), t, 0.03));
        const peak = 0.55 + rand() * 0.45;
        env.gain.setTargetAtTime(peak, t, 0.03);
        env.gain.setTargetAtTime(peak * 0.2, t + dur * 0.7, 0.035);
        if (k < syllables - 1 && rand() < 0.4) {
          hissEnv.gain.setTargetAtTime(0.22, t + dur * 0.8, 0.004);
          hissEnv.gain.setTargetAtTime(0, t + dur * 0.8 + 0.02, 0.01);
        }
        t += dur;
      }
      env.gain.setTargetAtTime(0, t, 0.05);
      t += 0.1 + rand() * 0.22;
    }
    const end = t + 0.4;
    const drift = (rand() - 0.5) * 1.4;
    if (panner.positionX) {
      panner.positionX.setValueAtTime(x, t0);
      panner.positionX.linearRampToValueAtTime(x + drift, end);
      panner.positionY.setValueAtTime(0.3, t0);
      panner.positionZ.setValueAtTime(z, t0);
    } else panner.setPosition(x, 0.3, z);
    src.start(t0, rand() * 2, end - t0 + 0.1);
    src.onended = () => {
      panner.disconnect();
      soft.disconnect();
    };
    return end;
  };

  const tick = () => {
    if (!ctx || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const horizon = now + 0.6;
    for (const v of voices) speak(v, horizon);
    if (nextWhisper < now) nextWhisper = now + 1.5 + rand() * 2;
    if (nextWhisper < horizon) {
      const done = whisper(nextWhisper);
      nextWhisper = done + 3.5 + rand() * 6;
    }
  };

  const ensure = () => {
    if (ctx) return ctx;
    if (!Ctx) return null;
    try {
      if (navigator.audioSession) navigator.audioSession.type = "playback";
    } catch {}
    ctx = new Ctx({ latencyHint: "playback" });
    ctx.onstatechange = report;
    master = ctx.createGain();
    master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 10;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.3;
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -3;
    limit.knee.value = 0;
    limit.ratio.value = 20;
    limit.attack.value = 0.002;
    limit.release.value = 0.1;
    master.connect(comp);
    comp.connect(limit);
    limit.connect(ctx.destination);

    tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 3800;
    tone.Q.value = 0.5;
    projectorGain = ctx.createGain();
    projectorGain.gain.value = 0;
    tone.connect(projectorGain);
    projectorGain.connect(master);
    projectorSrc = ctx.createBufferSource();
    projectorSrc.buffer = buildLoop(ctx);
    projectorSrc.loop = true;
    projectorSrc.connect(tone);

    bed = ctx.createGain();
    bed.gain.value = 1.4;
    bed.connect(master);
    hall = ctx.createConvolver();
    hall.buffer = buildHall(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.9;
    hall.connect(wet);
    wet.connect(bed);

    const room = ctx.createBufferSource();
    room.buffer = buildRoom(ctx);
    room.loop = true;
    const roomTone = ctx.createBiquadFilter();
    roomTone.type = "lowpass";
    roomTone.frequency.value = 320;
    const roomGain = ctx.createGain();
    roomGain.gain.value = 0.005;
    room.connect(roomTone);
    roomTone.connect(roomGain);
    roomGain.connect(bed);

    crowd = ctx.createGain();
    crowd.gain.value = 0.16;
    const crowdTone = ctx.createBiquadFilter();
    crowdTone.type = "lowpass";
    crowdTone.frequency.value = 820;
    crowdTone.Q.value = 0.4;
    const crowdDry = ctx.createGain();
    crowdDry.gain.value = 0.35;
    crowd.connect(crowdTone);
    crowdTone.connect(crowdDry);
    crowdDry.connect(bed);
    crowdTone.connect(hall);

    whisperBus = ctx.createGain();
    whisperBus.gain.value = 0.42;
    const whisperDry = ctx.createGain();
    whisperDry.gain.value = 0.42;
    whisperBus.connect(whisperDry);
    whisperDry.connect(bed);
    const whisperSend = ctx.createGain();
    whisperSend.gain.value = 0.7;
    whisperBus.connect(whisperSend);
    whisperSend.connect(hall);

    noise = buildNoise(ctx, 4, 909);
    voices = Array.from({ length: 6 }, (_, i) => makeVoice(i));
    const start = ctx.currentTime + 0.05;
    projectorSrc.start(start);
    room.start(start);
    nextWhisper = start + 2.5;
    return ctx;
  };

  const fadeIn = () => {
    if (!ctx) return;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(1, now + 2.4);
    if (!timer) timer = window.setInterval(tick, 120);
    tick();
  };

  const onVisibility = () => {
    if (!ctx || !enabled) return;
    if (document.hidden) {
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
    } else if (ctx.state === "running") fadeIn();
  };
  document.addEventListener("visibilitychange", onVisibility);

  const unlock = () => {
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(ctx.destination);
    src.start(0);
  };

  const begin = () => {
    report();
    if (enabled && ctx.state === "running") fadeIn();
  };

  return {
    onState(fn) {
      listener = fn;
      report();
    },
    arm() {
      if (!enabled) return;
      const fresh = !ctx;
      const c = ensure();
      if (!c) return;
      if (fresh) unlock();
      if (c.state === "running") {
        if (!timer) begin();
      } else c.resume().then(begin).catch(() => {});
    },
    async setEnabled(on) {
      enabled = on;
      if (on) {
        const fresh = !ctx;
        const c = ensure();
        if (!c) return false;
        if (fresh) unlock();
        await c.resume().catch(() => {});
        begin();
        return c.state === "running";
      }
      report();
      if (!ctx) return false;
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
      await new Promise((r) => setTimeout(r, 300));
      if (!enabled && ctx.state === "running") {
        if (timer) window.clearInterval(timer);
        timer = 0;
        await ctx.suspend().catch(() => {});
      }
      return false;
    },
    update(ratio, isEnded) {
      if (ctx && isEnded !== ended) {
        ended = isEnded;
        crowd.gain.setTargetAtTime(ended ? 0.26 : 0.16, ctx.currentTime, 1.2);
      }
      if (!ctx || !enabled || ctx.state !== "running") return;
      const speed = Math.min(2.4, Math.abs(ratio));
      const now = ctx.currentTime;
      projectorSrc.playbackRate.setTargetAtTime(Math.max(0.3, speed), now, 0.06);
      projectorGain.gain.setTargetAtTime(speed < 0.05 ? 0 : 0.32 * Math.min(1, 0.35 + speed * 0.65), now, 0.08);
      tone.frequency.setTargetAtTime(2400 + speed * 1600, now, 0.1);
    },
    destroy() {
      enabled = false;
      if (timer) window.clearInterval(timer);
      timer = 0;
      document.removeEventListener("visibilitychange", onVisibility);
      ctx?.close().catch(() => {});
      ctx = null;
    },
  };
}
