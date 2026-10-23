import { readFileSync, writeFileSync } from "node:fs";

// 16-bit or float WAV to mono Float32Array.
export function readWav(path) {
  const buf = readFileSync(path);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 12;
  let fmt = null;
  while (p < buf.length - 8) {
    const id = buf.toString("ascii", p, p + 4);
    const size = dv.getUint32(p + 4, true);
    if (id === "fmt ") fmt = { format: dv.getUint16(p + 8, true), channels: dv.getUint16(p + 10, true), rate: dv.getUint32(p + 12, true), bits: dv.getUint16(p + 22, true) };
    if (id === "data") {
      const bytes = fmt.bits / 8;
      const frames = Math.floor(size / (bytes * fmt.channels));
      const out = new Float32Array(frames);
      for (let i = 0; i < frames; i += 1) {
        let s = 0;
        for (let c = 0; c < fmt.channels; c += 1) {
          const at = p + 8 + (i * fmt.channels + c) * bytes;
          s += fmt.format === 3 ? dv.getFloat32(at, true) : fmt.bits === 16 ? dv.getInt16(at, true) / 32768 : dv.getInt32(at, true) / 2147483648;
        }
        out[i] = s / fmt.channels;
      }
      return { pcm: out, rate: fmt.rate };
    }
    p += 8 + size + (size % 2);
  }
  throw new Error(`no data chunk in ${path}`);
}

export function writeWav(path, pcm, rate) {
  const buf = Buffer.alloc(44 + pcm.length * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + pcm.length * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(pcm.length * 2, 40);
  for (let i = 0; i < pcm.length; i += 1) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32767))), 44 + i * 2);
  writeFileSync(path, buf);
}

// Linear-phase-free but adequate resampler for analysis input.
export function resample(pcm, from, to) {
  if (from === to) return pcm;
  const ratio = from / to;
  const n = Math.floor(pcm.length / ratio);
  const out = new Float32Array(n);
  // crude low-pass when downsampling: average over the ratio window
  const w = Math.max(1, Math.round(ratio));
  for (let i = 0; i < n; i += 1) {
    const c = i * ratio;
    let s = 0;
    let k = 0;
    for (let j = Math.floor(c - w / 2); j <= Math.floor(c + w / 2); j += 1) {
      if (j < 0 || j >= pcm.length) continue;
      s += pcm[j];
      k += 1;
    }
    out[i] = k ? s / k : 0;
  }
  return out;
}
