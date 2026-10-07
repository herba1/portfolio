# Lab batch 2026-10-07 handoff

Twenty lab candidates in src/app/lab/<slug>/, built from the briefs in briefs/. The build workflow was stopped mid-review to switch machines.

Pipeline per piece: build, critique, polish, recheck, second polish when the recheck scores under 8 or still has blockers/majors, then a final ranking of all 20 into a batch of 10.

| Piece | Critique score | Polish | Recheck |
|---|---|---|---|
| marble | 7 | done | not started |
| counter | 7 | done | interrupted |
| chop | 7 | done | not started |
| taffy | 7 | done | not started |
| tape | 7 | done | interrupted |
| filings | 7 | done | interrupted |
| strum | 7 | done | done (7) |
| sand | 7 | done | interrupted |
| copier | 7 | done | not started |
| wet-ink | 7 | done | not started |
| develop | 7 | done | not started |
| quadtree | 7 | done | not started |
| mosh | 5 | done | interrupted |
| tear-off | 7 | done | not started |
| cover-mobile | 7 | interrupted | not started |
| one-line | 7 | interrupted | not started |
| scorch | 6 | not started | not started |
| loom | 4 | done | not started |
| stir | 7 | done | not started |
| thread | 6 | interrupted | not started |

state.json holds every stage result: the build summaries, the critique issues with fixes, and the polish change lists. A polish marked interrupted may have left files mid-edit, so run the checks on it first.

## Resume
1. Run the checks on all 20 (see Checks).
2. Polish anything whose polish is interrupted or not started, using its critique from state.json.
3. Recheck each piece. If it scores under 8 or still has blockers/majors, polish again.
4. Rank all 20 and pick the batch of 10 (the Rank stage in build-workflow.js).
5. Run npm run build once to confirm everything compiles.

build-workflow.js is the original workflow script. On a new machine, point its SP paths at this folder: briefs/ and study.md live here, and the check tools are now scripts/lab-compile-check.mjs and scripts/lab-glsl-check.mjs.

## Checks
- node scripts/lab-gate.mjs <slug>
- node scripts/lab-compile-check.mjs <slug>
- node scripts/lab-glsl-check.mjs src/app/lab/<slug>
