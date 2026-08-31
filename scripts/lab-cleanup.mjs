import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { join, relative } from "node:path";

import { ARCHIVE_DIR, LAB_DIR, VOTES_FILE, args, effectiveVerdicts, listManifests, log, readJsonl, run, textFiles } from "./lab-lib.mjs";

const opts = args();
const dry = Boolean(opts.dry);
const REJECTED_AFTER_DAYS = Number(opts.rejected || 3);
const BROKEN_AFTER_DAYS = Number(opts.broken || 1);
const UNVOTED_AFTER_DAYS = Number(opts.unvoted || 14);

const manifests = listManifests();
const verdicts = effectiveVerdicts(readJsonl(VOTES_FILE));
const daysOld = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 86400000 : 0);

const removals = [];
for (const m of manifests) {
  const age = daysOld(m.createdAt);
  const voted = verdicts.get(m.slug);
  if (m.status === "rejected" && daysOld(voted?.ts || m.createdAt) >= REJECTED_AFTER_DAYS) removals.push([m, "rejected"]);
  else if (m.status === "broken" && age >= BROKEN_AFTER_DAYS) removals.push([m, "broken"]);
  else if (m.status === "candidate" && !voted && age >= UNVOTED_AFTER_DAYS) removals.push([m, "unvoted"]);
}

for (const [m, why] of removals) {
  const dir = join(LAB_DIR, m.slug);
  log(`${dry ? "would remove" : "removing"} ${m.slug} (${why})`);
  if (dry) continue;
  const archive = join(ARCHIVE_DIR, m.slug);
  mkdirSync(archive, { recursive: true });
  for (const file of textFiles(dir)) {
    const target = join(archive, relative(dir, file));
    mkdirSync(join(target, ".."), { recursive: true });
    copyFileSync(file, target);
  }
  rmSync(dir, { recursive: true, force: true });
}

if (!dry) await run("node", ["scripts/lab-registry.mjs"]);
log(`${removals.length} removed, ${manifests.length - removals.length} kept`);
