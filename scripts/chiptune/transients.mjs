// Render one of each chip voice in isolation (kick, snare, hat, a lead pluck,
// a triangle bass note) so their attacks can be measured: transients.py.
//   node --import ./scripts/chiptune/register.mjs scripts/chiptune/transients.mjs out.wav
import { OfflineAudioContext } from "node-web-audio-api";
import { renderSong } from "../../src/lib/chiptune/synth.js";
import { writeWav } from "./wav.mjs";

const events = [];
["k", "s", "h"].forEach((kind, i) => events.push({ ch: 3, s: 0.1 + i * 0.5, kind, v: 0.9 }));
events.push({ ch: 0, s: 1.6, d: 0.2, m: 72, v: 0.6, duty: 0.5, env: "pluck" });
events.push({ ch: 2, s: 2.1, d: 0.2, m: 40, v: 0.9 });
const { pcm, rate } = await renderSong({ events, length: 2.6 }, 2.6, 44100, OfflineAudioContext);
writeWav(process.argv[2], pcm, rate);
process.exit(0);
