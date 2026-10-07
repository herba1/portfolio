export const meta = {
  name: 'lab-build-20',
  description: 'Build 20 lab experiments: build → adversarial critique → polish → recheck → second polish when needed, then rank the best batch of 10',
  phases: [
    { title: 'Build', detail: 'one engineer-agent per piece, checks until green' },
    { title: 'Critique', detail: 'fresh reviewer reads every file as Herb + senior engineer' },
    { title: 'Polish', detail: 'fix every blocker/major and close the wow gap' },
    { title: 'Recheck', detail: 'second review; second polish only when still short' },
    { title: 'Rank', detail: 'judge picks the batch of 10' },
  ],
}

const SP = args.sp
const ROOT = '/Users/herb/Documents/GitHub/portfolio'
const ASK = `Herb (owner of herb.art, a creative developer) asked for 20 new experiments: "Really wow me with cool, rememberability, fluidity, just coolness, shaders, whatever: some just really cool shit, really satisfying, clean, awesome, super performant, beautiful."`

const pascal = s => s.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('')

const CHECKS = slug => `Checks (run all three; every one must pass before you finish):
1. node scripts/lab-gate.mjs ${slug}   (lint, comments, type system, tokens — must print PASS)
2. node ${SP}/compile-check.mjs ${slug}   (esbuild bundle of every module in the folder: catches bad paths, missing files, missing named exports — must print PASS)
3. node ${SP}/glsl-check.mjs src/app/lab/${slug}   (GLSL syntax + undeclared identifiers for every template literal containing void main; skip if no shaders. Interpolated \${...} chunks are replaced by 1.0, so a function defined inside an interpolation shows as undeclared — prefer plain strings or inline the chunk so the check is meaningful.)`

const RULES = (slug, usesCovers) => `Hard rules:
- Write ONLY inside src/app/lab/${slug}/. Another session is editing other parts of this repo right now: ignore unrelated git changes, never run git commands that change state (no commit, stash, checkout, reset, add), never touch package.json, globals.css, LINKS.js, experiments/*, or other lab folders. No new dependencies.
- Never open a browser, Playwright, the browser pane, or start/stop a dev server. Verify by the checks below and by tracing the code carefully by hand.
- No comments of any kind anywhere: no //, no /* */, no JSX {/* */}, no /* glsl */ tag on shader strings, no // lines inside shader strings. Names carry meaning.
- Type: only the --text-* token classes (text-ui-sm, text-ui, text-ui-lg, text-body, text-heading, text-title-sm, text-title, text-title-lg, …; check globals.css) for any text; never bare letter-spacing or tracking-* utilities; font weights only via --font-weight-* tokens in CSS; tabular-nums for numbers; no all-caps; no low-opacity/faded text. Canvas/WebGL-drawn text is exempt from tokens but must follow the tracking law tracking_px = -0.043 × (size_px − 12) and the weight ladder.
- Vertical spacing (margins, paddings, row gaps, line-heights) multiples of 4px, in Tailwind and CSS. No p-1.5/py-2.5/mt-0.5.
- React 19 strict lint: no synchronous setState inside a useEffect body (subscribe, use callbacks, or derive); no Date.now()/Math.random()/performance.now() or DOM reads during render or in useRef/useState initialisers; never mutate refs during render; complete dependency arrays.
- Performance: no React state updated per frame — run loops in requestAnimationFrame with refs and write to the DOM/uniforms directly; no allocation in hot loops (reuse typed arrays/vectors); cap DPR (2 for DOM/canvas, 1.5 for heavy shaders, adaptive if it drops frames); pause the loop when document.hidden and when offscreen (IntersectionObserver); size with ResizeObserver; dispose every GPU resource, listener, AudioContext and observer on unmount; guard window on the server (mount WebGL via @/app/ui/ClientOnly or dynamic effects).
- Input: pointer events with setPointerCapture, touch-action: none only on the interactive surface, keyboard path for the main action, prefers-reduced-motion respected, works on a phone (below 900px the piece still reads; any panel collapses).
- Presentation: light page (bg-surface, ink text), the piece is the hero filling the viewport (min-h-dvh), one short title using a text token and at most one short hint line; quiet Swiss chrome; multi-stop eased gradients only. Page root sets font-synthesis: none, -webkit-font-smoothing: antialiased, -moz-osx-font-smoothing: grayscale, text-rendering: optimizeLegibility.
- Herb's recorded taste: numbers always animate (roll, masked top/bottom), never tween a value the user is dragging; pointer-reactive details (proximity, bend where you pull); round ends, never pointy; things scale/blur in when they appear, never just pop; no generic checkmarks or slop icons; no skeuomorphic fake glass/3D objects; one mechanic finished to the edge; the first frame is the vote.
- Content: ${usesCovers ? 'page.js already loads Herb\'s real recently-played covers server-side and passes covers={covers}: an array of {id, title, artist, image, durationMs}. image is a remote Spotify CDN URL (CORS-open: load with crossOrigin="anonymous") or a local /flyout/card-XX.jpg fallback. src/app/ui/useCovers.js loads them and extracts colour/palette/pattern — read it and use it or your own loader. Keep page.js\'s isProdView guard.' : 'page.js is scaffolded with the isProdView guard — keep it; you may change what it renders.'} Other real assets: /cast/john.webp paul.webp george.webp portraits; /audio/ask-me-why.m4a (+ .opus) The Beatles "Ask Me Why"; word-timed lyrics via /api/spotify/lyrics (see how src/app/ask-me-why/AskMeWhy.jsx fetches and reads them); GET /api/spotify/preview?artist=…&title=… returns JSON with a CORS-open 30s preview URL (read src/app/api/spotify/preview/route.js). Audio only starts on a user gesture.
- Finish experiment.json: title (1-3 words), description (two sentences in the voice of src/app/experiments/list.js), tags (2-4), intent (one sentence), set "building": false. Keep status "candidate".`

const BUILD_SCHEMA = {
  type: 'object',
  properties: {
    slug: { type: 'string' },
    checksPass: { type: 'boolean' },
    summary: { type: 'string', description: 'What it is and how it works, 3-5 sentences' },
    wowMoment: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    knownIssues: { type: 'string' },
  },
  required: ['slug', 'checksPass', 'summary', 'wowMoment', 'files', 'knownIssues'],
}

const CRITIQUE_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'number', description: '1-10, would Herb keep it' },
    firstFrame: { type: 'string', description: 'What the first frame actually shows, judged honestly' },
    checks: { type: 'string', description: 'Output summary of the three checks' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          category: { type: 'string', description: 'runtime-bug | shader | perf | feel | taste-rule | mobile | a11y | content' },
          file: { type: 'string' },
          line: { type: 'number' },
          problem: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['severity', 'category', 'file', 'problem', 'fix'],
      },
    },
    wowGap: { type: 'string', description: 'The single change that would most raise the wow, concrete' },
  },
  required: ['score', 'firstFrame', 'checks', 'issues', 'wowGap'],
}

const POLISH_SCHEMA = {
  type: 'object',
  properties: {
    checksPass: { type: 'boolean' },
    changes: { type: 'array', items: { type: 'string' } },
    remaining: { type: 'string' },
  },
  required: ['checksPass', 'changes', 'remaining'],
}

const critiquePrompt = (item, round, prior) => `${ASK}

You are the toughest reviewer of the lab experiment at src/app/lab/${item.slug}/ (route /lab/${item.slug}), round ${round}, before Herb sees it. You are READ-ONLY: do not edit any file. You cannot open a browser (forbidden); instead read EVERY file in the folder in full and simulate the experience frame by frame: the server render, mount, first frame, the first five seconds of touching it, drag/release, keyboard, resize, phone, tab hidden, unmount.

The brief it was built from: ${SP}/briefs/${item.slug}.md (read it). Herb's taste: .claude/skills/taste/SKILL.md.
${prior ? `Previous round's findings, to verify they were really fixed:\n${prior}\n` : ''}
Hunt, in order of importance:
A. Runtime bugs that would break or blank it: wrong three.js 0.183 / R3F 9 / drei 10 / motion 14 APIs (check node_modules when unsure), shader compile/link errors (GLSL ES version mismatches, missing precision, varyings not matching, uniforms never set, sampler limits, float render-target support without fallback), tainted canvas from remote images without crossOrigin, effects without cleanup, SSR window access, NaN from zero sizes, pointer capture bugs, stale closures, audio context never resumed.
B. Performance: per-frame React state, allocations in loops, full-resolution sims on phones, no offscreen/hidden pause, no DPR cap, readPixels/getImageData per frame, layout reads in loops.
C. Feel gaps against the brief's wow moment: instant state swaps, numbers that jump, no press feedback, no entrance choreography, no pointer reactivity, weak or empty first frame, generic slop details, the mechanic not as satisfying as described.
D. Rule violations: tokens, 4px grid, caps, faded text, comments, chrome that is not quiet Swiss light.

${CHECKS(item.slug)}

Score honestly (most first drafts are 5-7). Give every issue a concrete fix. Name the one wowGap change that would most lift it.`

const polishPrompt = (item, critique, round) => `${ASK}

You are finishing the lab experiment at src/app/lab/${item.slug}/ (route /lab/${item.slug}), polish round ${round}. Read every file in the folder first, then the brief at ${SP}/briefs/${item.slug}.md.

A reviewer scored it ${critique.score}/10. First frame as judged: ${critique.firstFrame}

Fix EVERY blocker and major issue below, implement the wowGap generously (when it says something feels basic, make it feel great, not merely different), and fix the minor ones where cheap. Keep the one mechanic; do not add feature sprawl. Keep everything that works.

Issues (JSON):
${JSON.stringify(critique.issues)}

wowGap: ${critique.wowGap}

${RULES(item.slug, item.usesCovers)}

${CHECKS(item.slug)}

Return what you changed, one line each, and whether all checks pass.`

phase('Build')
const results = await pipeline(
  args.order,
  item => agent(
    `${ASK}

You are building ONE experiment for herb.art's lab at src/app/lab/${item.slug}/ (route /lab/${item.slug}). It will be judged by Herb in a dashboard next to his best shipped work; it must be the kind of thing a design engineer screenshots and sends to a friend.

Read these first, in order:
1. The full build brief: ${SP}/briefs/${item.slug}.md — includes two skeptic reviews; apply their upgrades where they make the one mechanic stronger, and avoid every pitfall they name.
2. Craft notes distilled from the best shipped pieces (architecture, perf, motion constants, tokens, gate traps): ${SP}/study.md
3. .claude/skills/lab-build/SKILL.md and .claude/skills/taste/SKILL.md
4. The scaffold in src/app/lab/${item.slug}/ (page.js, experiment.json, placeholder ${pascal(item.slug)}Experience.jsx).
5. The closest shipped exemplar for structure and finish (src/app/ink for a tunable shader, src/app/blobs for a heavy shader field, src/app/deck or src/app/cover-ring for physical DOM motion, src/app/ascii-cover for Canvas2D on covers, src/app/tuner for instrument-like UI, src/app/ask-me-why for audio + lyrics).
Then load the 1-2 most relevant skills with the Skill tool (e.g. creative-shader, r3f-shaders, gesture-ui, web-animation-design, polymarket-motion, grokbot-motion, agentation-svg-animation) and follow their measured values.

Work order: get a first working version on screen in code fast, run the checks immediately, then build out the full brief: every interaction, the full choreography, every state, the perf plan, mobile. Then do a ruthless self-review pass as Herb would: imagine the first frame, the hover, press, drag, release, keyboard, phone — fix what feels static, generic or unfinished. Run the checks again until all pass.

${RULES(item.slug, item.usesCovers)}

${CHECKS(item.slug)}`,
    { label: `build:${item.slug}`, phase: 'Build', schema: BUILD_SCHEMA, effort: 'high' },
  ).then(build => ({ build })),
  (state, item) => agent(critiquePrompt(item, 1, null), { label: `critique:${item.slug}`, phase: 'Critique', schema: CRITIQUE_SCHEMA, effort: 'high' })
    .then(critique => ({ ...state, critique })),
  (state, item) => {
    if (!state.critique) return state
    return agent(polishPrompt(item, state.critique, 1), { label: `polish:${item.slug}`, phase: 'Polish', schema: POLISH_SCHEMA, effort: 'high' })
      .then(polish => ({ ...state, polish }))
  },
  (state, item) => {
    const prior = state.critique ? JSON.stringify({ issues: state.critique.issues.filter(i => i.severity !== 'minor'), wowGap: state.critique.wowGap }) : null
    return agent(critiquePrompt(item, 2, prior), { label: `recheck:${item.slug}`, phase: 'Recheck', schema: CRITIQUE_SCHEMA, effort: 'high' })
      .then(recheck => ({ ...state, recheck }))
  },
  (state, item) => {
    const r = state.recheck
    if (!r) return state
    const blockers = r.issues.filter(i => i.severity !== 'minor').length
    if (r.score >= 8 && blockers === 0) return state
    return agent(polishPrompt(item, r, 2), { label: `polish2:${item.slug}`, phase: 'Recheck', schema: POLISH_SCHEMA, effort: 'high' })
      .then(polish2 => ({ ...state, polish2 }))
  },
)

const done = args.order.map((item, i) => ({ slug: item.slug, title: item.title, lens: item.lens, ...(results[i] || {}) }))
log(`${done.filter(d => d.build).length}/${done.length} built`)

phase('Rank')
const digest = done.map(d => ({
  slug: d.slug,
  lens: d.lens,
  summary: d.build && d.build.summary,
  wowMoment: d.build && d.build.wowMoment,
  firstScore: d.critique && d.critique.score,
  finalScore: d.recheck && d.recheck.score,
  finalFirstFrame: d.recheck && d.recheck.firstFrame,
  openIssues: d.recheck && d.recheck.issues.filter(x => x.severity !== 'minor').map(x => x.problem),
  secondPolish: Boolean(d.polish2),
}))

const RANK_SCHEMA = {
  type: 'object',
  properties: {
    ranking: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          slug: { type: 'string' },
          rank: { type: 'number' },
          verdict: { type: 'string', description: 'One sentence: why it is or is not in the batch of 10' },
          tryFirst: { type: 'string', description: 'The exact first gesture Herb should try, under 15 words' },
          risk: { type: 'string', description: 'Anything that may still be broken at runtime, or empty' },
        },
        required: ['slug', 'rank', 'verdict', 'tryFirst', 'risk'],
      },
    },
  },
  required: ['ranking'],
}
const ranking = await agent(
  `${ASK}

Twenty lab experiments were just built in src/app/lab/<slug>/. Rank all of them, best first; the top 10 become "the batch" Herb opens first. Judge by: would Herb screenshot it and send it to a friend; memorability in one sentence; satisfaction in the first five seconds; first-frame beauty; fidelity of the build to its idea; runtime risk. Read each folder's experiment.json and skim its main component to confirm the digest below is honest; do not edit anything.

Digest (JSON):
${JSON.stringify(digest)}`,
  { label: 'rank', phase: 'Rank', schema: RANK_SCHEMA, effort: 'high' },
)

return { digest, ranking: ranking && ranking.ranking, polish: done.map(d => ({ slug: d.slug, polish1: d.polish && d.polish.checksPass, polish2: d.polish2 ? d.polish2.checksPass : null, remaining: (d.polish2 || d.polish || {}).remaining })) }
