// node --import ./scripts/chiptune/register.mjs scripts/chiptune/analyze.mjs in.wav out.json
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { analyze } from "../../src/lib/chiptune/analyze.js";
import { loudestWindow } from "../../src/lib/chiptune/audio.js";
import { posteriorgrams } from "../../src/lib/chiptune/model.js";
import { diskModel } from "./model-node.mjs";
import { readWav, resample } from "./wav.mjs";

const [input, output] = process.argv.slice(2);
const { pcm, rate } = readWav(input);
// Same cut the browser makes: the loudest 30 seconds.
const full = resample(pcm, rate, 22050);
const offset = loudestWindow(full, 22050, 30);
const mono = full.subarray(Math.round(offset * 22050), Math.round((offset + 30) * 22050));
// The model pass is the slow part on the CPU backend; keep its output next to
// the input so tuning the decoders afterwards is instant.
// Keyed by the model weights too, so a new model is never scored on old output.
const weights = createHash("sha1").update(readFileSync(new URL("../../public/models/basic-pitch/group1-shard1of1.bin", import.meta.url))).digest("hex").slice(0, 8);
const cache = `${input}.${offset}.${weights}.post.json`;
let posteriors;
if (existsSync(cache)) {
  const c = JSON.parse(readFileSync(cache, "utf8"));
  posteriors = { ...c, frames: Float32Array.from(c.frames), onsets: Float32Array.from(c.onsets), contours: new Float32Array(0) };
} else {
  posteriors = await posteriorgrams(mono, { model: diskModel() });
  writeFileSync(cache, JSON.stringify({ nFrames: posteriors.nFrames, fps: posteriors.fps, frames: Array.from(posteriors.frames, (v) => +v.toFixed(3)), onsets: Array.from(posteriors.onsets, (v) => +v.toFixed(3)) }));
}
const t = performance.now();
const result = await analyze(mono, { posteriors });
result.ms = Math.round(performance.now() - t);
result.offset = offset;
delete result.grid;
writeFileSync(output, JSON.stringify(result));
console.log(`${input}: ${result.ms}ms, ${result.bpm.toFixed(1)} bpm, ${result.melody.length} melody, ${result.bass.length} bass, ${result.chords.length} chords, ${result.drums.length} drums`);
