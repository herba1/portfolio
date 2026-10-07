import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const ROOT = process.cwd();
const require = createRequire(join(ROOT, "package.json"));
const esbuild = require("esbuild");

const slug = process.argv[2];
if (!slug) {
  console.log("usage: node scripts/lab-compile-check.mjs <slug>");
  process.exit(2);
}
const dir = join(ROOT, "src/app/lab", slug);
const entries = readdirSync(dir)
  .filter((f) => /\.(jsx?|mjs)$/.test(f))
  .map((f) => join(dir, f));

const alias = {
  name: "alias",
  setup(build) {
    build.onResolve({ filter: /^@\// }, async (args) => {
      const base = join(ROOT, "src", args.path.slice(2));
      for (const candidate of [base, `${base}.js`, `${base}.jsx`, `${base}.mjs`, join(base, "index.js"), join(base, "index.jsx")]) {
        if (existsSync(candidate) && !candidate.endsWith("/")) {
          try {
            if (readdirSync(candidate)) continue;
          } catch {
            return { path: candidate };
          }
        }
      }
      return { errors: [{ text: `cannot resolve ${args.path}` }] };
    });
    build.onResolve({ filter: /^(next|react|react-dom)(\/|$)/ }, (args) => ({ path: args.path, external: true }));
  },
};

try {
  const result = await esbuild.build({
    entryPoints: entries,
    bundle: true,
    write: false,
    outdir: join(ROOT, ".next/lab-compile-check"),
    platform: "browser",
    format: "esm",
    jsx: "automatic",
    logLevel: "silent",
    loader: { ".js": "jsx", ".css": "empty", ".png": "empty", ".jpg": "empty", ".webp": "empty", ".svg": "empty", ".json": "json" },
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [alias],
  });
  for (const warning of result.warnings) console.log(`warn  ${warning.text}${warning.location ? ` (${warning.location.file}:${warning.location.line})` : ""}`);
  console.log(`PASS  compile ${slug} (${entries.length} modules)`);
} catch (error) {
  for (const e of error.errors || [error]) console.log(`FAIL  ${e.text || e.message}${e.location ? ` (${e.location.file}:${e.location.line})` : ""}`);
  process.exit(1);
}
