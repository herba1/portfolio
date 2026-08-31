import { join } from "node:path";

import { RUNS_DIR, args, listManifests, log, run, writeJson } from "./lab-lib.mjs";

const opts = args();
const count = String(opts.count || 3);
const parallel = String(opts.parallel || 2);
const started = new Date().toISOString();
const steps = [];

async function step(name, cmd, cmdArgs, { allowFail = false } = {}) {
  log(`▶ ${name}`);
  const t0 = Date.now();
  const out = await run(cmd, cmdArgs, { timeoutMs: 60 * 60 * 1000, stream: true });
  steps.push({ name, code: out.code, ms: Date.now() - t0 });
  if (out.code !== 0 && !allowFail) {
    log(`✖ ${name} failed`);
    finish(false);
  }
  return out;
}

function finish(ok) {
  const manifests = listManifests();
  const summary = {
    started,
    finished: new Date().toISOString(),
    ok,
    steps,
    lab: manifests.reduce((acc, m) => ({ ...acc, [m.status]: (acc[m.status] || 0) + 1 }), {}),
  };
  writeJson(join(RUNS_DIR, `${started.replace(/[:.]/g, "-")}.json`), summary);
  log(ok ? "run complete" : "run stopped");
  console.log(JSON.stringify(summary.lab));
  process.exit(ok ? 0 : 1);
}

await step("registry", "node", ["scripts/lab-registry.mjs"]);
await step("supply", "node", ["scripts/lab-supply.mjs", "--count", count, ...(opts["no-scout"] ? ["--no-scout"] : []), ...(opts["no-harvest"] ? ["--no-harvest"] : [])]);
const gen = await step("generate", "node", ["scripts/lab-generate.mjs", "--parallel", parallel, ...(opts.budget ? ["--budget", String(opts.budget)] : [])], { allowFail: true });
const built = (() => {
  try {
    const line = gen.stdout.trim().split("\n").pop();
    return JSON.parse(line).filter((r) => r.ok).map((r) => r.slug);
  } catch {
    return [];
  }
})();
if (built.length) await step("gate", "node", ["scripts/lab-gate.mjs", ...built, ...(opts["no-build"] ? [] : ["--build"])], { allowFail: true });
await step("learn", "node", ["scripts/lab-learn.mjs"], { allowFail: true });
await step("cleanup", "node", ["scripts/lab-cleanup.mjs"], { allowFail: true });
await step("registry", "node", ["scripts/lab-registry.mjs"]);
finish(true);
