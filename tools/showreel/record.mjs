#!/usr/bin/env node
// Usage: node record.mjs <reel> [--draft] [--format landscape,square,vertical] [--base URL] [--fps 60] [--headed] [--recompose]
//
//   <reel>       a file in reels/ (without .mjs) or a path to one
//   --format     comma list, or "all". Default: the reel's own `formats`, else landscape
//   --base       site to record. Default https://herb.art. Use http://localhost:3000 for drafts
//   --draft      fast preview: half size, 30fps, quick encode -> out/<reel>/<format>.draft.mp4
//   --realtime   record the screen as it paints instead of stepping frames: as fast as
//                the clip is long, smooth only on a machine with a real GPU (GPU=native)
//   --recompose  skip the browser run and re-render the last capture (tweak camera/cards fast)
//
// Clips land in out/<reel>/<format>.mp4 with a poster frame beside each.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { capture } from "./lib/capture.mjs";
import { compose } from "./lib/compose.mjs";
import { FORMATS, formatFor } from "./lib/formats.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const has = (name) => args.includes(`--${name}`);
const VALUED = ["--format", "--base", "--fps"];
const name = args.find((a, i) => !a.startsWith("--") && !VALUED.includes(args[i - 1]));
if (!name) { console.error("Usage: node record.mjs <reel> [--format landscape,square,vertical|all] [--base URL] [--fps 60] [--recompose]"); process.exit(1); }

const file = fs.existsSync(name) ? path.resolve(name) : path.join(HERE, "reels", `${name}.mjs`);
const reel = { name: path.basename(file, ".mjs"), ...(await import(pathToFileURL(file))).default };
const want = flag("format", reel.formats?.join?.(",") ?? "landscape");
const formats = want === "all" ? Object.keys(FORMATS) : want.split(",");
const base = flag("base", process.env.BASE || "https://herb.art");
// --draft: a quick look while directing. Half resolution, 30fps, 1x capture,
// JPEG frames and the fastest encoder. Same beats, same camera, same timing,
// so what you approve is what the full render shows.
const draft = has("draft");
const fps = Number(flag("fps", draft ? 30 : reel.fps ?? 60));
const outDir = path.join(HERE, "out", reel.name);
const log = (m) => console.log(m);

for (const fname of formats) {
  // A reel can swap beats or settings for one format: { per: { vertical: { beats: [...] } } }
  const r = { ...reel, ...(reel.per?.[fname] ?? {}), ...(has("realtime") ? { mode: "realtime" } : {}) };
  const full = formatFor(fname, r.format);
  const format = draft ? { ...full, dpr: 1, fps, out: full.out.map((n) => Math.round(n / 2 / 2) * 2) } : { ...full, fps };
  const dir = path.join(outDir, draft ? `${fname}-draft` : fname);
  log(`${reel.name} / ${fname}`);
  const cap = has("recompose") && fs.existsSync(path.join(dir, "capture.json"))
    ? JSON.parse(fs.readFileSync(path.join(dir, "capture.json"), "utf8"))
    : await capture(r, format, dir, { base, headed: has("headed"), log });
  await compose(cap, dir, path.join(outDir, `${fname}${draft ? ".draft" : ""}.mp4`), { fps, reel: r, log, draft });
}
