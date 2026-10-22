// Symbolicate LoAF script entries from a results json (scroll-*.json or any with .loafAll) and rank by duration.
import fs from "node:fs";
import { SourceMapConsumer } from "source-map";
import { CHUNKS as D } from "./lib.mjs";
const cache = new Map();
async function at(file, pos) {
  if (!file?.endsWith(".js") || pos == null || pos < 0) return file || "(none)";
  if (!cache.has(file)) { try { const js = fs.readFileSync(D + file, "utf8"); const mm = js.match(/sourceMappingURL=(\S+)\s*$/); cache.set(file, { js, c: await new SourceMapConsumer(JSON.parse(fs.readFileSync(D + mm[1], "utf8"))) }); } catch { cache.set(file, null); } }
  const e = cache.get(file); if (!e) return file;
  const before = e.js.slice(0, pos); const line = before.split("\n").length; const col = pos - before.lastIndexOf("\n") - 1;
  const p = e.c.originalPositionFor({ line, column: col });
  return `${(p.source || file).replace("turbopack:///[project]/", "")}:${p.line}${p.name ? " " + p.name : ""}`;
}
const r = JSON.parse(fs.readFileSync(process.argv[2]));
const loafs = r.loafAll || r.worstLoaf;
const agg = new Map();
for (const l of loafs) for (const s of l.scripts) { const k = `${await at(s.src, s.pos)} <${(s.inv || "").replace(/https?:\/\/[^ ]+\//, "").slice(0, 50)}>`; const a = agg.get(k) || { ms: 0, n: 0, max: 0 }; a.ms += s.dur; a.n++; a.max = Math.max(a.max, s.dur); agg.set(k, a); }
for (const [k, v] of [...agg].sort((a, b) => b[1].ms - a[1].ms).slice(0, Number(process.argv[3] || 40))) console.log(`${String(v.ms).padStart(6)}ms ${String(v.n).padStart(4)}x max ${String(v.max).padStart(5)}  ${k}`);
