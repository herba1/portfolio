import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

const K = 0.043;
const PIVOT = 12;
const EM_THRESHOLD = 20;
const TOLERANCE = 0.035;

const WEIGHT_LADDER = new Set([
  300, 400, 430, 440, 450, 460, 490, 500, 520, 540, 550, 560, 590, 600, 620, 700,
]);

const ENFORCED = ["src/app/tierlist", "src/app/blog", "src/app/(blog)", "src/app/song-search", "src/app/bio"];

const EXEMPT = [{ path: "src/app/song-search", rules: ["leading-grid"] }];

const isExempt = (file, rule) =>
  EXEMPT.some((e) => file.startsWith(e.path) && e.rules.includes(rule));

const UNIT = 4;
const SPACE_CSS = /\b(padding|margin|padding-block|margin-block|gap|padding-top|padding-bottom|margin-top|margin-bottom|row-gap):\s*([^;}]+)/g;
const SHORTHAND = new Set(["padding", "margin", "gap"]);
const SPACE_TW = /(?<![-\w])(p|py|pt|pb|m|my|mt|mb|gap-y|space-y)-(\d+\.5)\b/g;
const SPACE_TW_ARBITRARY = /(?<![-\w])(p|py|pt|pb|m|my|mt|mb|gap-y)-\[(-?[\d.]+)(px|rem)\]/g;

const verticalParts = (prop, value) => {
  const parts = value.trim().split(/\s+/);
  if (!SHORTHAND.has(prop)) return parts.slice(0, 1);
  if (prop === "gap") return parts.slice(0, 1);
  if (parts.length === 1) return parts;
  if (parts.length === 2) return [parts[0]];
  if (parts.length === 3) return [parts[0], parts[2]];
  return [parts[0], parts[2]];
};

const offGrid = (value, unit) => {
  const px = unit === "rem" ? value * 16 : value;
  return Math.abs(px % UNIT) > 0.01 && Math.abs((Math.abs(px) % UNIT) - UNIT) > 0.01;
};

const BANNED_TRACKING = /(?<![-\w])tracking-(tighter|tight|normal|wide|wider|widest)\b(?!\s*:)/g;
const ARBITRARY_TRACKING = /\btracking-\[([^\]]+)\]/g;

const EXTS = new Set([".css", ".js", ".jsx", ".mjs", ".mdx", ".ts", ".tsx"]);
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "public"]);

const lawPx = (size) => -K * (size - PIVOT);

const toPx = (value, unit, fontSize) => {
  if (unit === "px") return value;
  if (unit === "rem") return value * 16;
  if (unit === "em") return fontSize == null ? null : value * fontSize;
  return null;
};

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (EXTS.has(extname(entry))) out.push(full);
  }
  return out;
}

const lineOf = (source, index) => source.slice(0, index).split("\n").length;

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + m.slice(p1.length).replace(/./g, " "));
}

function checkFile(file) {
  const raw = readFileSync(file, "utf8");
  const source = stripComments(raw);
  const rel = relative(ROOT, file);
  const found = [];
  const add = (line, rule, message) => found.push({ file: rel, line, rule, message });

  for (const match of source.matchAll(BANNED_TRACKING)) {
    add(
      lineOf(source, match.index),
      "tracking-utility",
      `"${match[0]}" pins tracking to one value. Tracking is a function of size — use a text-* scale token.`,
    );
  }

  for (const match of source.matchAll(ARBITRARY_TRACKING)) {
    if (/var\(--text-[a-z0-9-]*-?-letter-spacing\)/.test(match[1])) continue;
    add(
      lineOf(source, match.index),
      "tracking-arbitrary",
      `"${match[0]}" is a magic tracking value. Reference var(--text-…--letter-spacing) instead.`,
    );
  }

  for (const match of source.matchAll(SPACE_TW)) {
    add(
      lineOf(source, match.index),
      "spacing-grid",
      `"${match[0]}" is ${Number(match[2]) * 4}px, off the ${UNIT}px grid. Use a whole step.`,
    );
  }

  for (const match of source.matchAll(SPACE_TW_ARBITRARY)) {
    if (!offGrid(Number(match[2]), match[3])) continue;
    add(
      lineOf(source, match.index),
      "spacing-grid",
      `"${match[0]}" is off the ${UNIT}px grid.`,
    );
  }

  if (extname(file) === ".css") {
    for (const match of source.matchAll(SPACE_CSS)) {
      for (const part of verticalParts(match[1], match[2])) {
        const m = part.match(/^(-?[\d.]+)(px|rem)$/);
        if (!m || !offGrid(Number(m[1]), m[2])) continue;
        add(
          lineOf(source, match.index),
          "spacing-grid",
          `${match[1]}: ${part} is ${m[2] === "rem" ? Number(m[1]) * 16 : Number(m[1])}px vertical, off the ${UNIT}px grid.`,
        );
      }
    }
  }

  if (extname(file) === ".css") {
    for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const body = match[2];
      const at = lineOf(source, match.index);

      const upper = body.match(/text-transform:\s*uppercase/);
      if (upper) add(at, "uppercase", "All-caps UI text is banned. Use size and weight to signal a label tier.");

      for (const weightMatch of body.matchAll(/font-weight:\s*(\d{3})\b/g)) {
        const weight = Number(weightMatch[1]);
        if (!WEIGHT_LADDER.has(weight)) {
          add(at, "weight-ladder", `font-weight ${weight} is off the ladder. Use a --font-weight-* token.`);
        }
      }

      const sizeMatch = body.match(/font-size:\s*(-?[\d.]+)(px|rem)\b/);
      const trackMatch = body.match(/letter-spacing:\s*(-?[\d.]+)(px|rem|em)\b/);

      const leadMatch = body.match(/line-height:\s*([\d.]+)(px|rem)?\b/);
      if (leadMatch) {
        const size = sizeMatch ? toPx(Number(sizeMatch[1]), sizeMatch[2]) : null;
        const lead = leadMatch[2]
          ? toPx(Number(leadMatch[1]), leadMatch[2])
          : size == null
            ? null
            : Number(leadMatch[1]) * size;
        if (lead != null && offGrid(lead, "px")) {
          add(
            at,
            "leading-grid",
            `line-height resolves to ${lead.toFixed(2)}px, off the ${UNIT}px grid.`,
          );
        }
      }

      if (trackMatch && !sizeMatch && trackMatch[2] === "em") {
        add(
          at,
          "tracking-unverifiable",
          `letter-spacing: ${trackMatch[1]}em with no font-size here — tracking must come from a --text-*--letter-spacing token.`,
        );
      }

      if (!sizeMatch || !trackMatch) continue;

      const size = toPx(Number(sizeMatch[1]), sizeMatch[2]);
      const actual = toPx(Number(trackMatch[1]), trackMatch[2], size);
      if (size == null || actual == null) continue;

      if (size < EM_THRESHOLD && trackMatch[2] === "em") {
        add(at, "tracking-unit", `${size}px uses em tracking. Below ${EM_THRESHOLD}px tracking must be absolute px.`);
      }

      const expected = lawPx(size);
      if (Math.abs(actual - expected) > TOLERANCE) {
        add(
          at,
          "tracking-law",
          `${size}px has ${trackMatch[1]}${trackMatch[2]} (${actual.toFixed(3)}px); the law wants ${expected.toFixed(2)}px.`,
        );
      }
    }
  }

  return found;
}

const files = walk(SRC);
const all = files.flatMap(checkFile);
const isEnforced = (f) => ENFORCED.some((dir) => f.startsWith(dir));

const scoped = all.filter((v) => !isExempt(v.file, v.rule));
const errors = scoped.filter((v) => isEnforced(v.file));
const warnings = scoped.filter((v) => !isEnforced(v.file));

const render = (list, label) => {
  if (!list.length) return;
  console.log(`\n${label}`);
  const byFile = new Map();
  for (const v of list) {
    if (!byFile.has(v.file)) byFile.set(v.file, []);
    byFile.get(v.file).push(v);
  }
  for (const [file, items] of [...byFile].sort()) {
    console.log(`\n  ${file}`);
    for (const v of items.sort((a, b) => a.line - b.line)) {
      console.log(`    ${String(v.line).padStart(4)}  [${v.rule}] ${v.message}`);
    }
  }
};

console.log(`Type system check — law: tracking_px = -${K} x (size - ${PIVOT})`);
console.log(`Scanned ${files.length} files under src/`);

render(errors, `FAIL  ${errors.length} violation(s) in enforced paths:`);
render(warnings, `WARN  ${warnings.length} violation(s) elsewhere:`);

if (!all.length) console.log("\nClean.");
else console.log("");

process.exit(errors.length ? 1 : 0);
