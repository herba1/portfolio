import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import {
  ARCHIVE_DIR,
  BATCH_FILE,
  BUILD_SKILL,
  LAB_DIR,
  MODELS,
  NOTES_FILE,
  ROOT,
  TASTE_SKILL,
  VOTES_FILE,
  args,
  claude,
  fmtRun,
  fmtTokens,
  log,
  newId,
  now,
  readJson,
  readJsonl,
  readManifest,
  readText,
  run,
  tasteVersion,
  textFiles,
  uniqueSlug,
  writeManifest,
} from "./lab-lib.mjs";

const opts = args();
const parallel = Number(opts.parallel || 2);
const model = opts.model || MODELS.build;
const budgetUsd = Number(opts.budget || 4);
const maxTurns = Number(opts["max-turns"] || 90);
const BRIEFS_FILE = join(ROOT, "taste/briefs.json");
const dry = Boolean(opts.dry);

const votes = readJsonl(VOTES_FILE);
const notes = readJsonl(NOTES_FILE);
const buildSkill = readText(BUILD_SKILL);
const tasteSkill = readText(TASTE_SKILL);
const version = tasteVersion();

function ideasToBuild() {
  if (opts.idea) return [{ id: newId(), kind: "manual", source: "herb", title: String(opts.idea).slice(0, 80), summary: String(opts.idea), tags: ["manual"] }];
  if (opts.briefs) {
    const wanted = String(opts.briefs).split(",").map((b) => b.trim()).filter(Boolean);
    const briefs = readJson(BRIEFS_FILE, []).filter((b) => wanted.includes(b.id));
    if (!briefs.length) throw new Error(`no briefs matched: ${opts.briefs}`);
    return briefs.map((b) => ({ id: newId(), kind: "brief", source: "briefs", briefId: b.id, title: b.title, summary: b.summary, tags: b.tags || ["ui"] }));
  }
  if (opts.polish) {
    return String(opts.polish)
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((slug) => {
        const target = readManifest(slug);
        if (!target) throw new Error(`no such experiment: ${slug}`);
        return { id: newId(), kind: "polish", source: "herb", slug, title: target.title, summary: target.description, tags: target.tags || [] };
      });
  }
  if (opts.repair) {
    const target = readManifest(String(opts.repair));
    if (!target) throw new Error(`no such experiment: ${opts.repair}`);
    return [{ id: newId(), kind: "repair", source: "gate", slug: target.slug, title: target.title, summary: target.description, tags: target.tags || [] }];
  }
  if (opts.iterate) {
    const target = readManifest(String(opts.iterate));
    if (!target) throw new Error(`no such experiment: ${opts.iterate}`);
    return [{ id: newId(), kind: "iterate", source: "herb", slug: target.slug, title: target.title, summary: target.description, tags: target.tags || [] }];
  }
  if (opts.evolve) {
    const parent = readManifest(String(opts.evolve));
    if (!parent) throw new Error(`no such experiment: ${opts.evolve}`);
    return [{ id: newId(), kind: "evolve", source: "herb", parentSlug: parent.slug, title: `Evolve ${parent.title}`, summary: parent.description, tags: parent.tags || [] }];
  }
  const batch = readJson(opts.batch || BATCH_FILE, null);
  if (!batch?.ideas?.length) throw new Error("no batch; run npm run lab:supply first or pass --idea");
  return batch.ideas;
}

function parentContext(slug) {
  const dir = join(LAB_DIR, slug);
  const manifest = readManifest(slug);
  if (!manifest) return "";
  const files = textFiles(dir)
    .filter((f) => !f.endsWith("experiment.json"))
    .map((f) => `--- ${relative(ROOT, f)}\n${readFileSync(f, "utf-8").slice(0, 12000)}`)
    .join("\n\n")
    .slice(0, 40000);
  const own = votes.filter((v) => v.slug === slug && !v.undone);
  const verdictLines = own.filter((v) => v.kind === "verdict").map((v) => `- ${v.verdict}${v.reasons?.length ? " · " + v.reasons.join(", ") : ""}`);
  const pointLines = own
    .filter((v) => v.kind === "point")
    .map((v) => {
      const c = v.point?.computed || {};
      return `- ${v.verdict} <${v.point?.tag}> ${v.point?.selector} · text "${v.point?.text || ""}" · ${c.fontSize} ${c.fontWeight} ${c.color} on ${c.backgroundColor} · transition ${c.transition} · animation ${c.animation}${v.reasons?.length ? " · " + v.reasons.join(", ") : ""}${v.note ? " · " + v.note : ""}`;
    });
  const noteLines = notes.filter((n) => n.slug === slug).map((n) => `- ${n.text}${n.reply ? ` (agent: ${n.reply})` : ""}`);
  return [
    `Parent experiment: ${manifest.title} — ${manifest.description}`,
    `Parent files:\n${files}`,
    verdictLines.length ? `Herb's verdicts on the parent:\n${verdictLines.join("\n")}` : "",
    pointLines.length ? `Elements Herb pointed at on the parent (keep what he loves, replace what he hates):\n${pointLines.join("\n")}` : "",
    noteLines.length ? `Herb's notes on the parent:\n${noteLines.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function nextVersionSlug(parentSlug) {
  const match = parentSlug.match(/^(.*)-v(\d+)$/);
  return match ? `${match[1]}-v${Number(match[2]) + 1}` : `${parentSlug}-v2`;
}

const pascal = (slug) =>
  slug
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");

function feedbackFor(slug, since) {
  const own = votes.filter((v) => v.slug === slug && !v.undone);
  const stamp = (v) => (since && v.ts < since ? " (earlier round, already addressed once)" : "");
  const lines = [];
  let n = 0;
  for (const v of own.filter((v) => v.kind === "point")) {
    n += 1;
    const c = v.point?.computed || {};
    const comp = v.point?.components?.length ? ` in component ${v.point.components.join(" < ")}` : "";
    lines.push(
      `${n}. ${v.verdict === "love" ? "LOVE" : "HATE"} <${v.point?.tag}${v.point?.classes?.length ? "." + v.point.classes.slice(0, 3).join(".") : ""}>${comp} · selector ${v.point?.selector} · text "${v.point?.text || ""}" · ${c.fontSize} ${c.fontWeight} ${c.color} on ${c.backgroundColor} · transition ${c.transition} · animation ${c.animation}${v.point?.animations?.length ? ` · running ${v.point.animations.join(", ")}` : ""}${v.reasons?.length ? " · " + v.reasons.join(", ") : ""}${v.note ? ` · Herb: "${v.note}"` : ""}${stamp(v)}`,
    );
  }
  for (const v of own.filter((v) => v.kind === "verdict")) {
    n += 1;
    lines.push(`${n}. verdict ${v.verdict}${v.reasons?.length ? " · " + v.reasons.join(", ") : ""}${stamp(v)}`);
  }
  for (const note of notes.filter((x) => x.slug === slug)) {
    n += 1;
    lines.push(`${n}. note: "${note.text}"${note.reply ? ` (agent replied: ${note.reply})` : ""}${stamp(note)}`);
  }
  return lines.join("\n");
}

function iterateSetup(idea) {
  const slug = idea.slug;
  const dir = join(LAB_DIR, slug);
  const manifest = readManifest(slug);
  const iteration = (manifest.iteration || 0) + 1;
  const archive = join(ARCHIVE_DIR, slug, `iter-${String(iteration - 1).padStart(2, "0")}`);
  for (const file of textFiles(dir)) {
    const target = join(archive, relative(dir, file));
    mkdirSync(join(target, ".."), { recursive: true });
    copyFileSync(file, target);
  }
  writeManifest(slug, { ...manifest, building: true });
  return { slug, dir, componentName: pascal(slug), iteration, manifest };
}

function iteratePrompt({ slug, dir, manifest, iteration }) {
  const files = textFiles(dir)
    .filter((f) => !f.endsWith("experiment.json"))
    .map((f) => `--- ${relative(ROOT, f)}\n${readFileSync(f, "utf-8").slice(0, 14000)}`)
    .join("\n\n")
    .slice(0, 60000);
  return [
    `Rebuild the experiment at ${relative(ROOT, dir)}/ (route /lab/${slug}) in place. This is iteration ${iteration} of "${manifest.title}". Edit the existing files; only create new files inside that folder.`,
    "",
    "Load the reference skill that fits this piece with the Skill tool (polymarket-skill, grokbot-skill, agentation-showcase-animations, agentation-svg-animation, creative-shader) before changing anything; those are Herb's inspiration.",
    "",
    "Herb reviewed it and gave the feedback below. Address every numbered item explicitly and generously — when he says something feels basic, make it feel great, not merely different. Keep everything he did not mention. Pointed elements come with the selector, the React component, and the computed styles so you can find them exactly.",
    "",
    "Feedback:",
    feedbackFor(slug, manifest.iteratedAt) || "(none recorded — polish the weakest part)",
    "",
    "Current files:",
    files,
    "",
    "When done, run `node scripts/lab-gate.mjs " + slug + "` and fix every problem until it prints PASS. Update experiment.json description if the piece changed; never change its status. Reply with one line per feedback item saying what you changed, then a final line: DONE " + slug,
  ].join("\n");
}

function scaffold(idea) {
  const slug = uniqueSlug(idea.kind === "evolve" && idea.parentSlug ? nextVersionSlug(idea.parentSlug) : idea.title);
  const dir = join(LAB_DIR, slug);
  mkdirSync(dir, { recursive: true });
  const manifest = {
    title: idea.title.slice(0, 60),
    description: idea.summary.slice(0, 200),
    tags: (idea.tags || []).slice(0, 6),
    status: "candidate",
    createdAt: now(),
    ideaId: idea.id || null,
    parentSlug: idea.parentSlug || null,
    parents: idea.parents || null,
    tasteVersion: version,
    intent: idea.why || (idea.kind === "evolve" ? "Evolution of something Herb liked" : idea.kind === "cross" ? "Cross-breed of two liked experiments" : `From ${idea.source || idea.kind}`),
    source: idea.url ? { url: idea.url, license: idea.license || null, kind: idea.kind, media: idea.media || null } : { kind: idea.kind },
    generation: null,
    building: true,
  };
  writeManifest(slug, manifest);
  const componentName = slug
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
  writeFileSync(
    join(dir, "page.js"),
    `import ${componentName}Experience from "./${componentName}Experience";\nimport { notFound } from "next/navigation";\n\nimport { isProdView } from "@/lib/viewMode";\n\nimport manifest from "./experiment.json";\n\nexport const metadata = {\n  title: ${JSON.stringify(manifest.title)},\n  description: ${JSON.stringify(manifest.description)},\n};\n\nexport default function ${componentName}Page() {\n  if (isProdView() && manifest.status !== "shipped") notFound();\n  return <${componentName}Experience />;\n}\n`,
  );
  if (!existsSync(join(dir, `${componentName}Experience.jsx`))) {
    writeFileSync(
      join(dir, `${componentName}Experience.jsx`),
      `export default function ${componentName}Experience() {\n  return (\n    <main className="bg-surface text-ink-secondary text-body flex min-h-dvh items-center justify-center">Building ${manifest.title}…</main>\n  );\n}\n`,
    );
  }
  return { slug, dir, componentName };
}

function buildPrompt(idea, { slug, dir, componentName }) {
  const parts = [
    `Build a new experiment page at ${relative(ROOT, dir)}/ (route /lab/${slug}). The scaffold already has page.js importing ./${componentName}Experience and a placeholder ${componentName}Experience.jsx — replace the placeholder with the real piece and add everything it needs. Only create files inside that folder.`,
    "",
    `Idea: ${idea.title}`,
    `Mechanic: ${idea.summary}`,
    idea.why ? `Why it fits Herb: ${idea.why}` : "",
    idea.url ? `Inspiration URL: ${idea.url}${idea.license ? ` (license ${idea.license})` : ""}. Re-implement the mechanic from scratch; never copy assets, copy text, logos, or non-permissive code.` : "",
    idea.media ? `Reference media: ${idea.media}` : "",
    idea.tags?.length ? `Tags: ${idea.tags.join(", ")}` : "",
  ];
  if (idea.kind === "evolve" && idea.parentSlug) {
    parts.push("", "This is an evolution. Read the parent below, keep what Herb pointed at as loved, replace what he pointed at as hated, and push one dimension clearly further (motion, material, typography, or interaction). It must feel like a sibling, not a copy.", "", parentContext(idea.parentSlug));
  }
  if (idea.kind === "cross" && idea.parents?.length === 2) {
    parts.push("", "This is a cross-breed of two liked experiments. Take the single strongest mechanic from each and fuse them into one coherent piece.", "", parentContext(idea.parents[0]), "", parentContext(idea.parents[1]));
  }
  if (idea.kind === "frontend-for-repo") {
    parts.push("", "This repo has no front end. Fetch its README with WebFetch, understand what it does, and build a playground page that demonstrates it with realistic mocked data if the real thing needs a server. Credit the repo with a link in the page.");
  }
  parts.push(
    "",
    "Work in this order. First write a plan as your first message: (1) the one idea in a sentence, (2) the choreography — every animated moment (entrance, hover, press, drag, value change, exit) with its duration and easing, (3) every state (empty, loading, error, disabled, focus), (4) the real content you will use. Then build exactly that plan. Every state change animates; nothing swaps instantly; numbers roll; entrances are staggered; interruptions are handled. A piece with no motion is a failed piece.",
    "",
    "Before writing code, load the reference skill that fits this piece with the Skill tool (polymarket-skill for data and numbers, grokbot-skill for motion and morphing chrome, agentation-showcase-animations for a self-playing demo, agentation-svg-animation for icon motion, creative-shader only if a shader serves the UI) and follow its measured values. Say which one you used in your final reply.",
    "",
    "When the page works, run `node scripts/lab-gate.mjs " + slug + "` and fix every problem until it prints PASS. Then update experiment.json: a sharp title, a two-sentence description in the same voice as src/app/experiments/list.js, 2–4 tags, and `intent` explaining in one sentence which of Herb's preferences this serves.",
    "Reply with a single line when finished: DONE " + slug,
  );
  return parts.filter((p) => p !== "").join("\n");
}

function untrackedOutside(dir) {
  return run("git", ["status", "--porcelain", "--untracked-files=all"]).then(({ stdout }) =>
    stdout
      .split("\n")
      .filter((l) => l.startsWith("??"))
      .map((l) => l.slice(3).trim())
      .filter((p) => p && !join(ROOT, p).startsWith(dir)),
  );
}

function gateProblems(slug) {
  return run("node", ["scripts/lab-gate.mjs", slug, "--quiet"]).then(() => readManifest(slug)?.gate || []);
}

async function repairPass(slug, sessionId, allowed) {
  const problems = await gateProblems(slug);
  if (!problems.length) return { ok: true };
  log(`repair ${slug} · ${problems.length} problem(s)`);
  const prompt = [
    `The gate for src/app/lab/${slug}/ still fails. Fix every problem below in place, run \`node scripts/lab-gate.mjs ${slug}\` and repeat until it prints PASS, then reply DONE ${slug}.`,
    "Rules: no comments anywhere; no synchronous setState inside useEffect bodies; never mutate memoised values; vertical spacing on the 4px grid; fill title and description in experiment.json.",
    "",
    "Problems:",
    ...problems.map((p) => `- ${p.replace(/\u001b\[[0-9;]*m/g, "")}`),
  ].join("\n");
  const out = await claude({
    prompt,
    systemPrompt: sessionId ? undefined : [buildSkill, "", tasteSkill].join("\n"),
    model,
    maxTurns: 25,
    budgetUsd: 2,
    resume: sessionId || undefined,
    allowedTools: "Skill,Read,Glob,Grep,Edit,Write,MultiEdit,Bash(node scripts/lab-gate.mjs*),Bash(node scripts/check-type-system.mjs*),Bash(ls*),Bash(cat*)",
    permissionMode: "acceptEdits",
    settings: { hooks: { PreToolUse: [{ matcher: "Edit|Write|MultiEdit|NotebookEdit", hooks: [{ type: "command", command: "node scripts/lab-guard.mjs", timeout: 20 }] }] } },
    env: { LAB_ALLOWED_DIR: allowed },
    timeoutMs: 20 * 60 * 1000,
  });
  const remaining = await gateProblems(slug);
  log(`repair ${slug} · ${remaining.length ? remaining.length + " left" : "clean"} · ${fmtRun(out)}`);
  return { ok: remaining.length === 0, usage: out.usage };
}

async function polishPass(slug, sessionId, allowed) {
  log(`polish ${slug}${sessionId ? "" : " (fresh session)"}`);
  const prompt = [
    `Now review src/app/lab/${slug}/ the way Herb will: open every file, imagine the first frame, the hover, the press, the drag, the keyboard path. Compare it with the reference skill you loaded and the taste skill.`,
    "List the five things that feel unfinished, static, generic, or not thought through — then fix all five. Typical misses: no entrance choreography, instant state swaps, values that jump instead of roll, hover with no press feedback, layout shift on state change, placeholder-looking content, no empty or loading state, a single easing for everything.",
    `Run \`node scripts/lab-gate.mjs ${slug}\` until PASS. Reply with the five fixes, one line each, then DONE ${slug}.`,
  ].join("\n");
  const out = await claude({
    prompt,
    model,
    maxTurns: 40,
    budgetUsd: 3,
    effort: "high",
    resume: sessionId || undefined,
    systemPrompt: sessionId ? undefined : [buildSkill, "", tasteSkill].join("\n"),
    allowedTools: "Skill,Read,Glob,Grep,Edit,Write,MultiEdit,Bash(node scripts/lab-gate.mjs*),Bash(node scripts/check-type-system.mjs*),Bash(ls*),Bash(cat*)",
    permissionMode: "acceptEdits",
    settings: { hooks: { PreToolUse: [{ matcher: "Edit|Write|MultiEdit|NotebookEdit", hooks: [{ type: "command", command: "node scripts/lab-guard.mjs", timeout: 20 }] }] } },
    env: { LAB_ALLOWED_DIR: allowed },
    timeoutMs: 25 * 60 * 1000,
  });
  log(`polish ${slug} · ${fmtRun(out)}`);
  return { ok: out.ok, usage: out.usage, summary: String(out.result).slice(0, 1200) };
}

async function generateOne(idea) {
  if (idea.kind === "polish") {
    const manifest = readManifest(idea.slug);
    writeManifest(idea.slug, { ...manifest, building: true });
    const allowedDir = `src/app/lab/${idea.slug}`;
    const result = await polishPass(idea.slug, manifest.generation?.sessionId, allowedDir);
    let gate = await run("node", ["scripts/lab-gate.mjs", idea.slug, "--quiet"]);
    if (gate.code !== 0) {
      const repaired = await repairPass(idea.slug, null, allowedDir);
      if (repaired.ok) gate = { code: 0 };
    }
    const after = readManifest(idea.slug);
    writeManifest(idea.slug, {
      ...after,
      building: false,
      status: gate.code === 0 ? "candidate" : after.status,
      generation: { ...(after.generation || {}), polish: result.summary || null, polishUsage: result.usage || null, polishedAt: now() },
    });
    return { slug: idea.slug, ok: gate.code === 0, usage: result.usage };
  }
  if (idea.kind === "repair") {
    const manifest = readManifest(idea.slug);
    writeManifest(idea.slug, { ...manifest, building: true });
    const result = await repairPass(idea.slug, manifest.generation?.sessionId, `src/app/lab/${idea.slug}`);
    const after = readManifest(idea.slug);
    writeManifest(idea.slug, { ...after, building: false, status: result.ok ? "candidate" : after.status, gate: result.ok ? [] : after.gate });
    return { slug: idea.slug, ok: result.ok, usage: result.usage };
  }
  const iterating = idea.kind === "iterate";
  const scaffolded = iterating ? iterateSetup(idea) : scaffold(idea);
  const { slug, dir } = scaffolded;
  log(`start ${slug} (${idea.kind}${iterating ? ` · iteration ${scaffolded.iteration}` : ""})`);
  if (dry) return { slug, ok: true, dry: true };

  const before = new Set(await untrackedOutside(dir));
  const allowed = relative(ROOT, dir);
  const tools = [
    "Skill",
    "Read",
    "Glob",
    "Grep",
    "Edit",
    "Write",
    "MultiEdit",
    "Bash(node scripts/lab-gate.mjs*)",
    "Bash(node scripts/check-type-system.mjs*)",
    "Bash(node scripts/check-shaders.mjs*)",
    "Bash(ls*)",
    "Bash(cat*)",
    idea.kind === "frontend-for-repo" || idea.url ? "WebFetch" : null,
  ].filter(Boolean);

  const out = await claude({
    prompt: iterating ? iteratePrompt(scaffolded) : buildPrompt(idea, scaffolded),
    systemPrompt: [buildSkill, "", tasteSkill].join("\n"),
    model,
    maxTurns,
    budgetUsd,
    allowedTools: tools.join(","),
    permissionMode: "acceptEdits",
    effort: "high",
    settings: {
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit|Write|MultiEdit|NotebookEdit",
            hooks: [{ type: "command", command: "node scripts/lab-guard.mjs", timeout: 20 }],
          },
        ],
      },
    },
    env: { LAB_ALLOWED_DIR: allowed },
    timeoutMs: 45 * 60 * 1000,
  });

  const strays = (await untrackedOutside(dir)).filter((p) => !before.has(p) && !p.startsWith("taste/") && !p.startsWith(".claude/"));
  for (const stray of strays) log(`new file outside the lab folder during the run: ${stray}`);

  const manifest = readManifest(slug) || {};
  writeManifest(slug, {
    ...manifest,
    building: false,
    ...(iterating
      ? {
          status: "candidate",
          iteration: scaffolded.iteration,
          iteratedAt: now(),
          changelog: [...(manifest.changelog || []), { iteration: scaffolded.iteration, at: now(), usage: out.usage, durationMs: out.durationMs, turns: out.turns, summary: String(out.result).slice(0, 1200) }],
        }
      : {}),
    generation: { model, usage: out.usage, durationMs: out.durationMs, turns: out.turns, sessionId: out.sessionId, finishedAt: now(), ok: out.ok, polish: null },
  });

  let gate = await run("node", ["scripts/lab-gate.mjs", slug, "--quiet"]);
  if (gate.code !== 0 && (iterating || existsSync(join(dir, `${scaffolded.componentName}Experience.jsx`)))) {
    const repaired = await repairPass(slug, out.sessionId, allowed);
    if (repaired.ok) gate = { code: 0 };
  }
  let polish = null;
  if (gate.code === 0 && !iterating && !opts["no-polish"]) {
    polish = await polishPass(slug, out.sessionId, allowed);
    gate = await run("node", ["scripts/lab-gate.mjs", slug, "--quiet"]);
    if (gate.code !== 0) {
      const repaired = await repairPass(slug, out.sessionId, allowed);
      if (repaired.ok) gate = { code: 0 };
    }
  }
  if (polish) {
    const withPolish = readManifest(slug);
    writeManifest(slug, { ...withPolish, generation: { ...(withPolish.generation || {}), polish: polish.summary || null, polishUsage: polish.usage || null } });
  }
  const final = readManifest(slug);
  const ok = gate.code === 0 && (iterating || existsSync(join(dir, `${scaffolded.componentName}Experience.jsx`)));
  if (!ok && final && final.status !== "broken") writeManifest(slug, { ...final, status: "broken", gate: [...(final.gate || []), out.ok ? "gate failed" : `agent: ${(out.stderr || out.result).slice(0, 300)}`] });
  log(`${ok ? "built" : "broken"} ${slug} · ${fmtRun(out)}`);
  return { slug, ok, usage: out.usage, turns: out.turns, durationMs: out.durationMs };
}

const queue = ideasToBuild();
const results = [];
let cursor = 0;
async function worker() {
  while (cursor < queue.length) {
    const idea = queue[cursor];
    cursor += 1;
    try {
      results.push(await generateOne(idea));
    } catch (error) {
      results.push({ slug: null, ok: false, error: String(error.message || error) });
      log("failed", error.message || error);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(parallel, queue.length) }, worker));

await run("node", ["scripts/lab-registry.mjs"]);
const tokens = results.reduce((acc, r) => acc + (r.usage?.input || 0) + (r.usage?.output || 0), 0);
log(`done: ${results.filter((r) => r.ok).length}/${results.length} built · ${fmtTokens(tokens)} tokens`);
if (existsSync(LAB_DIR) && !readdirSync(LAB_DIR).length) log("lab is empty");
console.log(JSON.stringify(results));
process.exit(results.some((r) => r.ok) || dry ? 0 : 1);
