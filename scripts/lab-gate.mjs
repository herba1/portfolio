import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { LAB_DIR, ROOT, SLUG_RE, args, log, readManifest, run, textFiles, writeManifest } from "./lab-lib.mjs";

const opts = args();
const slugs = opts._.filter((s) => SLUG_RE.test(s));
const withBuild = Boolean(opts.build);
const quiet = Boolean(opts.quiet);

const LINE_COMMENT = /(^|[^:'"`\\])\/\/(?!\/)/;
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//;
const BANNED = [
  { re: /(?<![-\w])tracking-(tighter|tight|normal|wide|wider|widest)\b/, why: "fixed tracking utility" },
  { re: /\buppercase\b/, why: "all-caps text" },
  { re: /text-transform:\s*uppercase/, why: "all-caps text" },
  { re: /\bfrom ["']playwright/, why: "playwright import" },
  { re: /\bopacity-[0-6]0\b[^"]*text-|text-[a-z-]*\s+opacity-[0-6]0\b/, why: "faded text" },
];

function checkFile(file) {
  const problems = [];
  const source = readFileSync(file, "utf-8");
  const rel = relative(ROOT, file);
  if (/\.(jsx?|mjs|css|glsl)$/.test(file)) {
    const inShader = /Shader\.js$|\.glsl$/.test(file);
    source.split("\n").forEach((line, i) => {
      const trimmed = line.trim();
      if (!inShader && LINE_COMMENT.test(line) && !/https?:\/\//.test(line)) problems.push(`${rel}:${i + 1} comment`);
      if (inShader && /^\s*\/\//.test(trimmed)) problems.push(`${rel}:${i + 1} comment in shader`);
      for (const { re, why } of BANNED) if (re.test(line)) problems.push(`${rel}:${i + 1} ${why}`);
    });
    if (BLOCK_COMMENT.test(source)) problems.push(`${rel} block comment`);
  }
  return problems;
}

async function gateOne(slug) {
  const dir = join(LAB_DIR, slug);
  const problems = [];
  const manifest = readManifest(slug);
  if (!manifest) return { slug, ok: false, problems: ["missing experiment.json"] };
  if (!existsSync(join(dir, "page.js"))) problems.push("missing page.js");
  if (!manifest.title || !manifest.description) problems.push("manifest needs title and description");
  if (!Array.isArray(manifest.tags) || !manifest.tags.length) problems.push("manifest needs tags");
  for (const file of textFiles(dir)) problems.push(...checkFile(file));

  const type = await run("node", ["scripts/check-type-system.mjs"]);
  const typeLines = type.stdout.split("\n");
  typeLines.forEach((line, i) => {
    if (line.trim() === `src/app/lab/${slug}` || line.trim().startsWith(`src/app/lab/${slug}/`)) {
      for (let j = i + 1; j < typeLines.length && /^\s{6}\d/.test(typeLines[j]); j += 1) problems.push(`type-system ${typeLines[j].trim()}`);
    }
  });

  const shaders = await run("node", ["scripts/check-shaders.mjs"]);
  if (shaders.code !== 0) {
    const mine = (shaders.stdout + shaders.stderr).split("\n").filter((l) => l.includes(`lab/${slug}`));
    problems.push(...mine.map((l) => `shader ${l.trim()}`));
  }

  if (existsSync(join(ROOT, "node_modules/.bin/eslint"))) {
    const eslint = await run("node", ["node_modules/eslint/bin/eslint.js", `src/app/lab/${slug}`]);
    if (eslint.code !== 0) problems.push(...eslint.stdout.split("\n").filter((l) => /error|warning/.test(l)).map((l) => `eslint ${l.trim()}`));
  }

  return { slug, ok: problems.length === 0, problems };
}

const results = [];
for (const slug of slugs) results.push(await gateOne(slug));

let buildOk = true;
let buildTail = "";
if (withBuild && results.some((r) => r.ok)) {
  log("next build…");
  const build = await run("npm", ["run", "build"], { env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }, timeoutMs: 25 * 60 * 1000 });
  buildOk = build.code === 0;
  buildTail = (build.stdout + build.stderr).split("\n").slice(-30).join("\n");
  if (!buildOk) {
    for (const r of results) {
      if (!r.ok) continue;
      const mentioned = buildTail.includes(`lab/${r.slug}`);
      if (mentioned || results.filter((x) => x.ok).length === 1) {
        r.ok = false;
        r.problems.push("next build failed");
      }
    }
  }
}

for (const r of results) {
  const manifest = readManifest(r.slug);
  if (!manifest) continue;
  if (!r.ok && manifest.status === "candidate") writeManifest(r.slug, { ...manifest, status: "broken", gate: r.problems.slice(0, 20) });
  else if (r.ok && manifest.status === "broken") writeManifest(r.slug, { ...manifest, status: "candidate", gate: [] });
  else if (r.ok && manifest.gate?.length) writeManifest(r.slug, { ...manifest, gate: [] });
}

if (!quiet) {
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.slug}`);
    for (const p of r.problems) console.log(`      ${p}`);
  }
  if (withBuild) console.log(buildOk ? "BUILD ok" : `BUILD failed\n${buildTail}`);
}

process.exit(results.every((r) => r.ok) && buildOk ? 0 : 1);
