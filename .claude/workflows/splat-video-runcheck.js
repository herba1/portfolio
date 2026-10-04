export const meta = {
  name: 'splat-video-runcheck',
  description: 'Verify every splat-video clip is served intact by the dev server and the lab code passes its checks',
  whenToUse: 'After exporting or rebuilding splat-video clips, or before showing the lab. Pass clip names as args to check others.',
  phases: [
    { title: 'Clips', detail: 'one agent per clip validates served files against meta.json and the loader' },
    { title: 'Code', detail: 'type-system lint and lab gate on the splat-video lab' },
  ],
}

const CLIPS = Array.isArray(args) && args.length ? args : ['herb-30s', 'herb-depth-30s', 'herb-flip', 'drummer-30s', 'stroller-v3', 'lucia-v3']

const CLIP_SCHEMA = {
  type: 'object',
  properties: {
    clip: { type: 'string' },
    format: { type: 'string' },
    ok: { type: 'boolean' },
    filesChecked: { type: 'number' },
    totalBytes: { type: 'number' },
    problems: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['clip', 'format', 'ok', 'filesChecked', 'problems'],
}

const CODE_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    commands: { type: 'array', items: { type: 'object', properties: { command: { type: 'string' }, exitCode: { type: 'number' }, summary: { type: 'string' } }, required: ['command', 'exitCode', 'summary'] } },
    problems: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'commands', 'problems'],
}

const clipPrompt = clip => `Repo: /Users/herb/Documents/GitHub/portfolio. A Next.js dev server is running on http://localhost:3000 (it may still be compiling; retry a request a few times over ~60s before calling it down). Do NOT start, stop or restart any server. Do NOT edit any files. Read-only verification.

Verify the splat-video clip "${clip}" is served intact and would pass the player's loader.

1. Read src/app/lab/splat-video/loadSplat4d.js (and splatStream.js / RgbdScene.jsx if relevant to this clip's format) to learn exactly which files the player fetches for each format (v1, v2 flipbook, v2 rgbd, v3 stream) and what validation it applies (sizes, counts, offsets, meta keys).
2. Read public/splats/4d/${clip}/meta.json. Identify the format.
3. For every file the player would fetch for this clip (meta.json, base/points/velocity bins, every chunk file, audio.m4a, rgbd.mp4, plate.png, etc.), request it from http://localhost:3000/splats/4d/${clip}/<file> with curl (use -I or -o /dev/null -w '%{http_code} %{size_download}'), and confirm HTTP 200 and that the served byte count equals the on-disk size. For mp4/m4a also confirm a Range request (curl -r 0-99) returns 206.
4. Reproduce the loader's validation in a quick node or python script against the on-disk files: e.g. splat counts implied by meta vs file byte sizes (base 16 B/splat, points 8 B/splat, velocity 6 B/splat float16x3), frameOffsets monotonic and within bounds, chunk staticCount/shared rows within range, times length matching moment count, cameras length, audio flag vs audio file presence. Report any mismatch precisely.
5. Also confirm the clip appears in whatever list the page uses for clip pills (listClips in loadSplat4d.js, or the API/route it reads) — check by fetching the relevant endpoint or reading the code path.

Return ok=true only if everything checks out. List every concrete problem with file and numbers.`

phase('Clips')
const clipChecks = pipeline(CLIPS, clip => agent(clipPrompt(clip), { label: `clip:${clip}`, phase: 'Clips', schema: CLIP_SCHEMA }))

phase('Code')
const codeCheck = agent(`Repo: /Users/herb/Documents/GitHub/portfolio. Do NOT edit files, do NOT start or stop servers (a dev server is already on port 3000; leave it alone). Read-only checks for the splat-video lab at src/app/lab/splat-video:
1. Run \`npm run lint:type\` and report whether it passes and any violations under src/app/lab/splat-video.
2. Run \`npx eslint src/app/lab/splat-video\` and report errors (warnings separately, briefly).
3. Look at package.json scripts and .claude/skills/lab-build/SKILL.md for the lab gate command (the lab gate checks experiment.json manifests); run the gate for the splat-video experiment if a command exists that does not spawn model runs or long builds, and report PASS/FAIL.
4. Confirm src/app/lab/registry.js includes splat-video (run \`node scripts/lab-registry.mjs\` only if it is idempotent and safe; otherwise just read registry.js).
5. Grep src/app/lab/splat-video for any code comments (// or /* or {/* */}) since the repo owner forbids comments; list file:line for any found.
Return ok=true only if lint and gate pass with no errors.`, { label: 'code-checks', phase: 'Code', schema: CODE_SCHEMA })

const [clips, code] = await Promise.all([clipChecks, codeCheck])
return { clips: clips.filter(Boolean), code }
