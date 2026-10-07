export function createCopierSound() {
  let context = null;
  let master = null;
  let motorGain = null;
  let motorFilter = null;
  let humGain = null;
  let hum = null;
  let noise = null;
  let noiseBuffer = null;
  let enabled = true;
  let lastLevel = -1;
  let sleepTimer = 0;

  function build() {
    const AudioEngine = window.AudioContext || window.webkitAudioContext;
    if (!AudioEngine) return;
    context = new AudioEngine();
    master = context.createGain();
    master.gain.value = 0.9;
    master.connect(context.destination);

    noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const channel = noiseBuffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < channel.length; i += 1) {
      brown = (brown + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      channel[i] = brown * 3.2;
    }

    noise = context.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    motorFilter = context.createBiquadFilter();
    motorFilter.type = "bandpass";
    motorFilter.frequency.value = 420;
    motorFilter.Q.value = 0.9;
    motorGain = context.createGain();
    motorGain.gain.value = 0;
    noise.connect(motorFilter).connect(motorGain).connect(master);
    noise.start();

    hum = context.createOscillator();
    hum.type = "triangle";
    hum.frequency.value = 96;
    humGain = context.createGain();
    humGain.gain.value = 0;
    hum.connect(humGain).connect(master);
    hum.start();
  }

  function cancelSleep() {
    if (!sleepTimer) return;
    clearTimeout(sleepTimer);
    sleepTimer = 0;
  }

  function rouse() {
    cancelSleep();
    if (context && context.state === "suspended") return context.resume().catch(() => null);
    return Promise.resolve();
  }

  return {
    wake() {
      if (!enabled) return;
      if (!context) build();
      rouse();
    },
    rouse() {
      if (enabled) rouse();
    },
    sleep() {
      if (!context || sleepTimer) return;
      if (context.state === "running") {
        const now = context.currentTime;
        motorGain.gain.cancelScheduledValues(now);
        motorGain.gain.setTargetAtTime(0, now, 0.03);
        humGain.gain.cancelScheduledValues(now);
        humGain.gain.setTargetAtTime(0, now, 0.03);
      }
      lastLevel = 0;
      sleepTimer = setTimeout(() => {
        sleepTimer = 0;
        if (context && context.state === "running") context.suspend().catch(() => null);
      }, 260);
    },
    setEnabled(next) {
      enabled = next;
      if (!context) return;
      master.gain.setTargetAtTime(next ? 0.9 : 0, context.currentTime, 0.04);
    },
    drive(level) {
      if (!context || context.state !== "running") return;
      const rounded = Math.round(level * 40) / 40;
      if (rounded === lastLevel) return;
      lastLevel = rounded;
      const now = context.currentTime;
      motorGain.gain.setTargetAtTime(rounded * 0.07, now, 0.06);
      motorFilter.frequency.setTargetAtTime(380 + rounded * 700, now, 0.06);
      humGain.gain.setTargetAtTime(rounded > 0 ? 0.012 + rounded * 0.01 : 0, now, 0.08);
      hum.frequency.setTargetAtTime(90 + rounded * 18, now, 0.08);
    },
    thunk() {
      if (!context || !enabled) return;
      rouse().then(() => {
        if (context && context.state === "running") playThunk();
      });
    },
    dispose() {
      cancelSleep();
      if (!context) return;
      const closing = context;
      context = null;
      closing.close().catch(() => null);
    },
  };

  function playThunk() {
    const now = context.currentTime;
    const burst = context.createBufferSource();
    burst.buffer = noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.16, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.22);
    burst.connect(filter).connect(gain).connect(master);
    burst.start(now, Math.random() * 1.5, 0.3);
  }
}
