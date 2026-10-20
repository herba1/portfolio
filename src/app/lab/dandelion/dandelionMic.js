export function micSupported() {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && typeof window.AudioContext === "function";
}

export default class Breath {
  constructor() {
    this.stream = null;
    this.context = null;
    this.analyser = null;
    this.buffer = null;
    this.floor = 0.012;
    this.level = 0;
    this.token = 0;
  }

  async open() {
    const token = (this.token += 1);
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    if (token !== this.token) {
      stream.getTracks().forEach((track) => track.stop());
      return false;
    }
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    this.stream = stream;
    this.context = context;
    this.analyser = analyser;
    this.buffer = new Float32Array(analyser.fftSize);
    this.level = 0;
    return true;
  }

  read(dt) {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.buffer);
    let sum = 0;
    for (let i = 0; i < this.buffer.length; i += 1) sum += this.buffer[i] * this.buffer[i];
    const rms = Math.sqrt(sum / this.buffer.length);
    if (rms < this.floor * 1.6) this.floor += (rms - this.floor) * Math.min(1, dt * 0.8);
    const raw = Math.max(0, (rms - this.floor * 2.2) * 7);
    const target = Math.min(1, raw);
    const rate = target > this.level ? 14 : 3;
    this.level += (target - this.level) * Math.min(1, dt * rate);
    return this.level;
  }

  close() {
    this.token += 1;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.context?.close().catch(() => {});
    this.stream = null;
    this.context = null;
    this.analyser = null;
    this.level = 0;
  }
}
