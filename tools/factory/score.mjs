// Builds the leaderboard: the judge's scores (judgements.jsonl, written by
// whoever looked at the recordings) plus the measured part of each probe.
//
//   node tools/factory/score.mjs [round]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUT, ROOT } from "./lib.mjs";

const AXES = { surprise: 20, payoff: 20, material: 15, emergence: 10, fit: 5 };
const file = join(ROOT, "tools/factory/judgements.jsonl");
const rows = readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const round = process.argv[2];
const board = [];
for (const j of rows) {
  if (round && String(j.round) !== round) continue;
  for (const [k, max] of Object.entries(AXES)) if (!(j[k] >= 0 && j[k] <= max)) throw new Error(`${j.slug}/${j.tag}: ${k} must be 0..${max}`);
  const mfile = join(OUT, j.slug, j.tag, "metrics.json");
  const m = existsSync(mfile) ? JSON.parse(readFileSync(mfile, "utf8")) : null;
  const judged = Object.keys(AXES).reduce((a, k) => a + j[k], 0);
  const measured = m?.measured?.total ?? 0;
  board.push({ round: j.round, slug: j.slug, tag: j.tag, parent: j.parent ?? null, judged, measured, total: +(judged + measured).toFixed(1), pass: m?.pass ?? false, note: j.note });
}
board.sort((a, b) => b.total - a.total);
writeFileSync(join(ROOT, "tools/factory/leaderboard.json"), JSON.stringify(board, null, 2));
for (const b of board) console.log(`${String(b.total).padStart(5)}  ${b.pass ? "pass" : "FAIL"}  r${b.round} ${b.slug}/${b.tag}  judged ${b.judged} measured ${b.measured}${b.parent ? `  (from ${b.parent})` : ""}`);
