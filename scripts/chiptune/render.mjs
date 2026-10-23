// Arrange an analysis (from analyze.mjs) and render it through the real chip
// voices with a native Web Audio implementation, so the harness hears exactly
// what the browser plays.
//   node --import ./scripts/chiptune/register.mjs scripts/chiptune/render.mjs analysis.json out_prefix
// Writes out_prefix.wav (mix), out_prefix.ch{0..3}.wav (stems), out_prefix.mid
// and out_prefix.song.json.
import { readFileSync, writeFileSync } from "node:fs";
import { OfflineAudioContext } from "node-web-audio-api";
import { arrange } from "../../src/lib/chiptune/arrange.js";
import { songToMidi } from "../../src/lib/chiptune/midi.js";
import { sixteenths } from "../../src/lib/chiptune/rhythm.js";
import { renderSong } from "../../src/lib/chiptune/synth.js";
import { writeWav } from "./wav.mjs";

globalThis.window = { OfflineAudioContext };

const [input, prefix] = process.argv.slice(2);
const analysis = JSON.parse(readFileSync(input, "utf8"));
analysis.grid ??= sixteenths(analysis.beats);
const opts = process.env.ARRANGE ? JSON.parse(process.env.ARRANGE) : {};
const song = arrange(analysis, { title: prefix.split("/").pop(), ...opts });
writeFileSync(`${prefix}.song.json`, JSON.stringify(song));
writeFileSync(`${prefix}.mid`, songToMidi(song, analysis.beats, analysis.downbeat));
const rate = 22050;
const mix = await renderSong(song, song.length, rate);
writeWav(`${prefix}.wav`, mix.pcm, rate);
for (let ch = 0; ch < 4; ch += 1) {
  const stem = await renderSong({ ...song, events: song.events.filter((e) => e.ch === ch) }, song.length, rate);
  writeWav(`${prefix}.ch${ch}.wav`, stem.pcm, rate);
}
const counts = [0, 1, 2, 3].map((ch) => song.events.filter((e) => e.ch === ch).length);
console.log(`${prefix}: ${song.length.toFixed(1)}s, events per channel ${counts.join("/")}, peak ${mix.pcm.reduce((m, v) => Math.max(m, Math.abs(v)), 0).toFixed(2)}`);
