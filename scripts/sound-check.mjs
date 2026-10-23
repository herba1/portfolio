// Renders every sound a piece banks and checks it the way an ear would, but
// with numbers: does it start from silence and end in silence (no click), is
// there DC, how loud is it at its peak and on average, where does its energy
// sit (spectral centroid), how long until it has died 40 dB, and are its
// takes actually different from each other (no machine-gun).
//
//   node scripts/sound-check.mjs [outDir]
//
// Writes a WAV per take to outDir (default .sound-check/) so the takes can be
// auditioned or drawn as spectrograms (ffmpeg -i x.wav -lavfi showspectrumpic x.png).
// Each piece's banks are listed in the piece's own `*Takes` export.
import { mkdirSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { rng } from "../src/lib/sound/synth.js";

const SR = 48000;
const out = process.argv[2] || ".sound-check";
mkdirSync(out, { recursive: true });

function wav(data) {
  const n = data.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i += 1) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(data[i] * 32767))), 44 + i * 2);
  return buf;
}

const dbfs = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k += 1) {
        const c = Math.cos(a * k);
        const s = Math.sin(a * k);
        const xr = re[i + k + len / 2] * c - im[i + k + len / 2] * s;
        const xi = re[i + k + len / 2] * s + im[i + k + len / 2] * c;
        re[i + k + len / 2] = re[i + k] - xr;
        im[i + k + len / 2] = im[i + k] - xi;
        re[i + k] += xr;
        im[i + k] += xi;
      }
    }
  }
}

// The energy-weighted mean frequency of the whole take.
function centroid(data) {
  let n = 1;
  while (n < data.length) n <<= 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  re.set(data);
  fft(re, im);
  let num = 0;
  let den = 0;
  for (let k = 1; k < n / 2; k += 1) {
    const e = re[k] * re[k] + im[k] * im[k];
    num += e * ((k * SR) / n);
    den += e;
  }
  return den ? num / den : 0;
}

function measure(data) {
  let peak = 0;
  let sum = 0;
  let mean = 0;
  let nan = false;
  for (const v of data) {
    if (!Number.isFinite(v)) nan = true;
    peak = Math.max(peak, Math.abs(v));
    sum += v * v;
    mean += v;
  }
  const rms = Math.sqrt(sum / data.length);
  // Decay: the last 5 ms window still within 40 dB of the peak.
  const win = Math.round(SR * 0.005);
  let tail = 0;
  for (let i = 0; i + win <= data.length; i += win) {
    let m = 0;
    for (let j = i; j < i + win; j += 1) m = Math.max(m, Math.abs(data[j]));
    if (m > peak * 0.01) tail = (i + win) / SR;
  }
  return {
    peak: dbfs(peak),
    rms: dbfs(rms),
    crest: dbfs(peak) - dbfs(rms),
    dc: mean / data.length,
    first: Math.abs(data[0]) / (peak || 1),
    last: Math.abs(data[data.length - 1]) / (peak || 1),
    decay40: tail,
    centroid: centroid(data),
    nan,
  };
}

function similarity(a, b) {
  const n = Math.min(a.length, b.length);
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i += 1) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
}

// Every module that exports `takes`: { name: { render, count } }.
const roots = ["src/app/lab", "src/app"];
const modules = [];
for (const root of roots) {
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const folder = join(root, dir.name);
    for (const file of readdirSync(folder)) {
      if (!/Takes\.js$/.test(file)) continue;
      modules.push(join(folder, file));
    }
  }
}

let failures = 0;
const rows = [];
for (const path of modules) {
  const mod = await import(pathToFileURL(join(process.cwd(), path)).href);
  for (const [name, spec] of Object.entries(mod.takes ?? {})) {
    const takes = [];
    for (let i = 0; i < (spec.count ?? 6); i += 1) {
      const data = spec.render(SR, rng((spec.seed ?? 1) * 7919 + i * 104729), i);
      takes.push(data);
      writeFileSync(join(out, `${path.split("/").at(-2)}-${name}-${i}.wav`), wav(data));
    }
    const m = takes.map(measure);
    const avg = (key) => m.reduce((s, x) => s + x[key], 0) / m.length;
    let maxSim = 0;
    for (let i = 0; i < takes.length; i += 1) for (let j = i + 1; j < takes.length; j += 1) maxSim = Math.max(maxSim, similarity(takes[i], takes[j]));
    const problems = [];
    if (m.some((x) => x.nan)) problems.push("NaN");
    if (m.some((x) => x.peak > -0.1)) problems.push("clips");
    if (m.some((x) => x.first > 0.02)) problems.push("starts on a step");
    if (m.some((x) => x.last > 0.01 && !spec.loop)) problems.push("ends on a step");
    if (m.some((x) => Math.abs(x.dc) > 0.01)) problems.push("DC");
    if (takes.length > 1 && maxSim > 0.995) problems.push("takes identical");
    if (problems.length) failures += 1;
    rows.push({
      sound: `${path.split("/").at(-2)}/${name}`,
      takes: takes.length,
      ms: Math.round((takes[0].length / SR) * 1000),
      "rms dB": avg("rms").toFixed(1),
      crest: avg("crest").toFixed(1),
      "centroid Hz": Math.round(avg("centroid")),
      "decay40 ms": Math.round(avg("decay40") * 1000),
      "max sim": maxSim.toFixed(3),
      problems: problems.join(", ") || "ok",
    });
  }
}
console.table(rows);
console.log(`${rows.length} sounds, ${failures} with problems. WAVs in ${out}/`);
process.exit(failures ? 1 : 0);
