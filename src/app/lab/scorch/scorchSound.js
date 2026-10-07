const TICK_MS = 60;
const LOOKAHEAD_SECONDS = 0.12;
const QUIET = 0.002;

export function createCrackle() {
  let context = null;
  let master = null;
  let hissGain = null;
  let noise = null;
  let hissSource = null;
  let enabled = true;
  let level = 0;
  let nextPop = 0;
  let timer = 0;

  function build() {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return false;
    context = new AudioCtor();
    master = context.createGain();
    master.gain.value = enabled ? 1 : 0;
    master.connect(context.destination);
    const length = context.sampleRate;
    noise = context.createBuffer(1, length, context.sampleRate);
    const channel = noise.getChannelData(0);
    for (let index = 0; index < length; index += 1) channel[index] = Math.random() * 2 - 1;
    hissSource = context.createBufferSource();
    hissSource.buffer = noise;
    hissSource.loop = true;
    const band = context.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 2600;
    band.Q.value = 0.6;
    hissGain = context.createGain();
    hissGain.gain.value = 0;
    hissSource.connect(band);
    band.connect(hissGain);
    hissGain.connect(master);
    hissSource.start();
    return true;
  }

  function pop(at, strength) {
    const source = context.createBufferSource();
    source.buffer = noise;
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1300 + Math.random() * 4200;
    filter.Q.value = 1.1 + Math.random() * 2;
    const gain = context.createGain();
    const length = 0.006 + Math.random() * 0.03;
    const peak = (0.03 + Math.random() * 0.11) * strength;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(at, Math.random() * 0.9, length + 0.01);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }

  function tick() {
    if (!context || !enabled || level < QUIET) return;
    const now = context.currentTime;
    if (nextPop < now) nextPop = now;
    const rate = 6 + level * 140;
    const strength = Math.min(1, 0.35 + level * 3);
    while (nextPop < now + LOOKAHEAD_SECONDS) {
      pop(nextPop, strength);
      nextPop += -Math.log(1 - Math.random()) / rate;
    }
  }

  function syncTimer() {
    const wanted = context && enabled && level >= QUIET;
    if (wanted && !timer) timer = window.setInterval(tick, TICK_MS);
    if (!wanted && timer) {
      window.clearInterval(timer);
      timer = 0;
    }
  }

  function whoosh() {
    const at = context.currentTime;
    const source = context.createBufferSource();
    source.buffer = noise;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(320, at);
    filter.frequency.exponentialRampToValueAtTime(2400, at + 0.18);
    filter.frequency.exponentialRampToValueAtTime(700, at + 0.5);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.16, at + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.55);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(at, Math.random() * 0.4, 0.6);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }

  return {
    wake() {
      if (!context && !build()) return;
      if (context.state === "suspended") context.resume().catch(() => {});
      syncTimer();
    },
    setLevel(next) {
      level = next;
      if (context && hissGain) hissGain.gain.setTargetAtTime(enabled ? Math.min(0.045, next * 0.2) : 0, context.currentTime, 0.3);
      syncTimer();
    },
    setEnabled(next) {
      enabled = next;
      if (context && master) master.gain.setTargetAtTime(next ? 1 : 0, context.currentTime, 0.05);
      syncTimer();
    },
    catchFire() {
      if (!context || !enabled) return;
      if (context.state !== "suspended") {
        whoosh();
        return;
      }
      const waiting = context;
      waiting.resume().then(
        () => {
          if (context === waiting && enabled) whoosh();
        },
        () => {},
      );
    },
    dispose() {
      if (timer) window.clearInterval(timer);
      timer = 0;
      if (hissSource) {
        try {
          hissSource.stop();
        } catch {
          hissSource = null;
        }
      }
      if (context) context.close();
      context = null;
    },
  };
}
