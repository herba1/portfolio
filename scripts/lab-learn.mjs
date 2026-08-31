import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  MODELS,
  NOTES_FILE,
  PROFILE_DIR,
  SEED_FILE,
  TASTE_SKILL,
  VOTES_FILE,
  args,
  claude,
  fmtRun,
  listManifests,
  log,
  readJson,
  readJsonl,
  readText,
  stripFences,
  tasteVersion,
  writeJson,
} from "./lab-lib.mjs";

const opts = args();
const force = Boolean(opts.force);
const minNew = Number(opts.min || 25);
const STATE_FILE = join(PROFILE_DIR, "state.json");

const votes = readJsonl(VOTES_FILE).filter((v) => !v.undone);
const notes = readJsonl(NOTES_FILE);
const manifests = listManifests();
const seed = readJson(SEED_FILE, { loved: [], hated: [] });
const state = readJson(STATE_FILE, { votesAtVersion: 0 });
const current = readText(TASTE_SKILL);
const version = tasteVersion();

const signal = votes.length + notes.length + seed.loved.length + seed.hated.length;
if (!force && signal - state.votesAtVersion < minNew) {
  log(`not yet: ${signal - state.votesAtVersion} new signals since v${version}, need ${minNew} (use --force)`);
  process.exit(0);
}

const bySlug = Object.fromEntries(manifests.map((m) => [m.slug, m]));
const verdicts = votes.filter((v) => v.kind === "verdict" && !v.recheck);
const points = votes.filter((v) => v.kind === "point");
const latest = new Map();
for (const v of verdicts) latest.set(v.slug, v);

const describe = (slug) => {
  const m = bySlug[slug];
  return m ? `${m.title} — ${m.description} [${(m.tags || []).join(", ")}]${m.intent ? ` (intent: ${m.intent})` : ""}` : slug;
};

const likedLines = [];
const rejectedLines = [];
for (const [slug, v] of latest) {
  const line = `- ${describe(slug)}${v.reasons?.length ? ` · reasons: ${v.reasons.join(", ")}` : ""}${v.msToDecide ? ` · decided in ${(v.msToDecide / 1000).toFixed(1)}s` : ""}`;
  if (v.verdict === "like" || v.verdict === "continue") likedLines.push(line + (v.verdict === "continue" ? " · asked to evolve" : ""));
  if (v.verdict === "dislike") rejectedLines.push(line);
}

const pointLines = points.map((p) => {
  const c = p.point?.computed || {};
  return `- ${p.verdict} · ${bySlug[p.slug]?.title || p.slug} · <${p.point?.tag}> "${p.point?.text || ""}" · font ${c.fontSize}/${c.fontWeight}/${c.letterSpacing} · ${c.color} on ${c.backgroundColor} · radius ${c.borderRadius} · shadow ${c.boxShadow} · transition ${c.transition} · animation ${c.animation}${p.reasons?.length ? ` · ${p.reasons.join(", ")}` : ""}${p.note ? ` · "${p.note}"` : ""}`;
});

const noteLines = notes.map((n) => `- ${n.slug ? `[${bySlug[n.slug]?.title || n.slug}] ` : ""}${n.text}${n.distilled ? ` → rule: ${n.distilled}` : ""}`);

const reasonCount = {};
for (const v of [...verdicts, ...points]) {
  for (const r of v.reasons || []) {
    const key = `${r}:${v.verdict === "like" || v.verdict === "love" ? "pos" : "neg"}`;
    reasonCount[key] = (reasonCount[key] || 0) + 1;
  }
}

const digest = [
  `Signals: ${verdicts.length} verdicts, ${points.length} pointed elements, ${notes.length} notes, ${seed.loved.length} loved links, ${seed.hated.length} hated links.`,
  "",
  "Reason tallies (chip:pos/neg):",
  Object.entries(reasonCount)
    .map(([k, n]) => `- ${k} ${n}`)
    .join("\n") || "- none",
  "",
  `Liked experiments (${likedLines.length}):`,
  likedLines.join("\n") || "- none yet",
  "",
  `Rejected experiments (${rejectedLines.length}):`,
  rejectedLines.join("\n") || "- none yet",
  "",
  `Pointed elements (${pointLines.length}):`,
  pointLines.join("\n") || "- none yet",
  "",
  `Notes from Herb (${noteLines.length}):`,
  noteLines.join("\n") || "- none yet",
  "",
  "Links Herb loves:",
  seed.loved.map((e) => `- ${e.url}${e.note ? ` — ${e.note}` : ""}`).join("\n") || "- none",
  "",
  "Links Herb hates:",
  seed.hated.map((e) => `- ${e.url}${e.note ? ` — ${e.note}` : ""}`).join("\n") || "- none",
].join("\n");

const systemPrompt = [
  "You maintain the taste skill for herb.art's experiment lab. The skill is loaded by every agent that builds an experiment, so it must be concrete, testable, and short enough to be obeyed.",
  "Write from evidence only. Every rule must trace to a verdict, a pointed element, a note, or a seed link. When evidence conflicts, say so in Open questions instead of inventing a rule.",
  "Never contradict the project's type system (CLAUDE.md): tracking law, 4px vertical grid, weight ladder, no all-caps UI text, no faded text.",
].join("\n");

const prompt = [
  `Rewrite the taste skill as version ${version + 1}. Keep everything from the current version that is still supported by evidence, sharpen what got new evidence, and remove what the evidence now contradicts.`,
  "",
  "Output the complete SKILL.md file and nothing else. Format:",
  "---",
  "name: taste",
  `description: Herb's taste for interactive experiments, learned from his votes. Load before designing or building anything for herb.art.`,
  `version: ${version + 1}`,
  "---",
  "then these sections, in this order, each with short declarative bullets (max 12 bullets per section, max 900 words total):",
  "# Taste",
  "## Loves — specific things to reach for, each with the experiment or element that proves it",
  "## Hates — specific things to never do, each with evidence",
  "## Rules — the operating rules an agent follows while building (motion, material, typography, colour, density, interaction), most important first",
  "## Exemplars — up to 5 liked experiment slugs to read before building, one line each on why",
  "## Open questions — where evidence is thin or conflicting, phrased as what to try next",
  "",
  "Current version:",
  current || "(none — this is the first learned version)",
  "",
  "Evidence:",
  digest,
].join("\n");

log(`writing taste skill v${version + 1} from ${signal} signals…`);
const out = await claude({ prompt, systemPrompt, model: opts.model || MODELS.judge, maxTurns: 1, budgetUsd: 1.5, tools: "", timeoutMs: 6 * 60 * 1000 });
if (!out.ok || !out.result) {
  log("learn failed", out.reason, String(out.result).slice(0, 300), out.stderr.slice(0, 300), out.raw);
  process.exit(1);
}
let body = stripFences(out.result);
if (!body.startsWith("---")) body = `---\nname: taste\ndescription: Herb's taste for interactive experiments, learned from his votes.\nversion: ${version + 1}\n---\n\n${body}`;
if (!/^version:\s*\d+/m.test(body)) body = body.replace(/^---\n/, `---\nversion: ${version + 1}\n`);

mkdirSync(PROFILE_DIR, { recursive: true });
if (current) copyFileSync(TASTE_SKILL, join(PROFILE_DIR, `v${String(version).padStart(3, "0")}.md`));
mkdirSync(join(TASTE_SKILL, ".."), { recursive: true });
writeFileSync(TASTE_SKILL, body.trimEnd() + "\n");
writeJson(STATE_FILE, { votesAtVersion: signal, updatedAt: new Date().toISOString(), version: version + 1, usage: out.usage });
log(`taste skill v${version + 1} written · ${fmtRun(out)}`);
