"use client";

import { useSyncExternalStore } from "react";

// ---------------------------------------------------------------------------
// One audio engine for the whole covers world.
//
// A single <audio> element and a single Web Audio graph live at module scope.
// Two reasons: playback has to survive the player modal unmounting (the dock
// keeps the song going while you browse the grid), and createMediaElementSource
// may only ever be called once per element — a per-component element would
// throw the second time you opened a cover.
//
// The hot path deliberately avoids React. One rAF loop reads the analyser,
// folds the FFT bins into four bands, and writes them as CSS custom properties
// (--eq0…--eq3, --cv-progress) directly onto registered DOM nodes. The bars are
// nothing but a clip off those variables, so a playing waveform costs zero
// re-renders and zero layout. React hears about coarse state (status / playing
// / duration) and a ~10Hz clock, nothing more.
//
// ── on staying alive ───────────────────────────────────────────────────────
// A browser will take audio away from you for reasons you never get told about:
// the AudioContext is suspended when a tab backgrounds, Safari flips it to
// "interrupted" for a phone call or Siri, an object URL outlives its blob, a
// decode dies, a ramp gets cancelled and leaves the gain on the floor. None of
// those raise anything React can see, and a MediaElementSource routes ALL
// output through the graph — so a broken graph is not a fallback to plain
// playback, it is perfect silence with the clock still ticking.
//
// So intent and reality are kept apart. `wantPlaying` is what the user asked
// for; the element is what is actually happening. A watchdog reconciles the two
// once a second and escalates: nudge (resume the context, re-assert the
// envelope, play again) → reload (refetch the preview and drop back in at the
// same position) → give up and say so. Nothing in here is allowed to fail into
// a player that looks fine and makes no sound.
// ---------------------------------------------------------------------------

// Band edges in Hz. Four bars, four musically distinct jobs.
const BANDS = [
  [30, 140], // kick + bass
  [140, 520], // low-mid body
  [520, 2200], // vocal presence
  [2200, 9000], // hats + air
];
// Real music sheds energy as frequency climbs; lift the upper bands so all four
// sit in a comparable absolute range, which keeps SPAN_MIN below meaning the
// same thing for the air band as for the kick band.
const TILT = [1, 1.18, 1.65, 2.4];

const REST = 0.16; // resting bar height — a flat line, never a collapsed zero
const ATTACK = 0.55; // rise fast…
const RELEASE = 0.13; // …fall slow. That asymmetry is what reads as rhythm.

// ── per-band auto-gain ─────────────────────────────────────────────────────
// A modern master is compressed to within an inch of its life: every band sits
// slammed near the top of its range, so normalising against absolute level (or
// against a ceiling alone) leaves all four bars pinned at full height — painted
// on, not playing. What matters is where a band sits inside its OWN recent
// range, so each one keeps a short history and maps current energy across the
// min/max of that window. A quiet track and a loud one both swing full height;
// what you read is the music's shape, not its volume.
//
// A true windowed min/max, rather than a pair of chasing envelopes: an envelope
// that rises slowly always lags the real quiet baseline, and every frame it
// lags is a frame the bar can't reach the bottom.
const WIN = 96; // frames of history (~1.6s at 60fps)
const SPAN_MIN = 0.03; // narrowest usable window — keeps near-silence from self-amplifying
const GAMMA = 1.2; // expander: pushes the middle down so peaks read as peaks

// ── fades (seconds) ────────────────────────────────────────────────────────
const FADE_IN = 0.16; // start
const FADE_OUT = 0.22; // pause / stop / track switch — a touch longer than the start
const FADE_TAIL = 0.8; // the preview's own ending, which is a cut, not a finish

const SETTLE_MS = 300; // glide back to the flat resting line (matches --duration-300)
const PUBLISH_MS = 90; // React clock cadence (~11Hz) — plenty for a time readout

// ── recovery ───────────────────────────────────────────────────────────────
const WATCHDOG_MS = 1000; // how often intent is checked against reality
const STALL_MS = 3000; // currentTime frozen this long while playing = wedged
const HEAL_COOLDOWN = 1500; // one repair attempt per this window, never a tight loop
const NUDGE_TRIES = 2; // cheap in-place repairs before refetching the audio
const RELOAD_TRIES = 2; // refetches before admitting defeat to the user
const FETCH_TIMEOUT = 12000; // a request that never settles is the "stuck on …" bug
const FETCH_TRIES = 2; // one retry; iTunes' CDN drops the odd read

// ── module state ───────────────────────────────────────────────────────────
let el = null; // the one HTMLAudioElement
let ctx = null;
let srcNode = null; // the one MediaElementSource — creating a second one throws
let graphFailed = false; // graph is unbuildable; don't keep trying and don't fade
let gain = null; // every fade happens here
let fadeTimer = 0; // pending hard-pause at the end of a fade-out
let stopTimer = 0; // pending teardown at the end of a stop fade (its own timer:
//                    sharing one with the pause fade meant a play() during a
//                    stop cancelled the teardown and left a zombie source)
let analyser = null;
let freq = null; // Uint8Array of FFT magnitudes
let ranges = null; // [loBin, hiBin] per band, resolved once the ctx sample rate is known
let objectUrl = null;
let loadToken = 0;
let raf = 0;
let lastPublish = 0;
let scrubbing = false;
let resumeAfterScrub = false;
let reduced = false;
let livePrev = false;

// intent + repair bookkeeping
let wantPlaying = false; // what the user asked for, which is not what is happening
let pendingSeek = null; // position to restore once metadata lands (reload resume)
let watchdog = 0;
let healCount = 0;
let lastHeal = 0;
let lastTime = -1;
let lastTimeAt = 0;
let gestureHooked = false;

const levels = new Float32Array(4); // smoothed 0..1 per band
const hist = Array.from({ length: 4 }, () => new Float32Array(WIN)); // rolling raw energy
let histAt = 0; // shared write cursor
let histN = 0; // frames filled so far
const visuals = new Set(); // DOM nodes receiving the CSS vars
const subs = new Set();

let state = {
  key: null,
  cover: null,
  status: "idle", // idle | loading | ready | none | error
  playing: false,
  duration: 0,
  currentTime: 0,
  peaks: null,
};

function emit(patch) {
  state = { ...state, ...patch };
  for (const fn of subs) fn(state);
}

export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
export function getState() {
  return state;
}

/** Subscribe a component to coarse playback state. */
export function useAudio() {
  return useSyncExternalStore(subscribe, getState, getState);
}

export const keyOf = (cover) => (cover ? `${cover.sub || ""}::${cover.title || ""}` : null);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowMs = () => (typeof performance !== "undefined" ? performance.now() : 0);

// ── element + graph (both created lazily, both created once) ───────────────
function element() {
  if (el || typeof window === "undefined") return el;
  el = new Audio();
  el.preload = "auto";
  el.addEventListener("ended", () => {
    wantPlaying = false;
    stopWatchdog();
    emit({ playing: false, currentTime: 0 });
    if (el) el.currentTime = 0;
    hardPause(); // stops the loop and settles the bars
  });
  el.addEventListener("loadedmetadata", () => {
    if (!el || !Number.isFinite(el.duration)) return;
    emit({ duration: el.duration });
    // A reload mid-song puts us back where we were rather than at the top —
    // self-repair the user can hear is a repair that draws attention to itself.
    if (pendingSeek != null) {
      const t = Math.max(0, Math.min(el.duration - 0.25, pendingSeek));
      pendingSeek = null;
      try {
        el.currentTime = t;
      } catch {
        /* seeking before the buffer is ready — the clock just starts at zero */
      }
      emit({ currentTime: t });
    }
    // playback can start before the duration is known, and the tail fade needs it
    if (state.playing || wantPlaying) scheduleEnvelope();
  });
  // MEDIA_ERR_NETWORK / _DECODE / _SRC_NOT_SUPPORTED. This is the event that
  // used to go nowhere: the element died, `playing` stayed true, the pause icon
  // stayed on screen, and every click after that hit a dead src.
  el.addEventListener("error", () => {
    if (!state.key || state.status === "loading") return;
    heal({ hard: true });
  });
  return el;
}

// Built on the first play — a gesture-scoped context is the only kind that is
// guaranteed to be running, and a suspended context on a MediaElementSource
// means silence rather than a fallback.
function ensureGraph() {
  if (analyser || graphFailed || typeof window === "undefined") return;
  const AC = window.AudioContext || window.webkitAudioContext;
  const a = element();
  if (!AC || !a) return;
  try {
    if (!ctx) ctx = new AC();
    // Guarded because the second call on the same element throws, and this
    // function is now reachable from the repair path as well as from play().
    if (!srcNode) srcNode = ctx.createMediaElementSource(a);
    // gain sits BEFORE the analyser on purpose: a fade-out then pulls the four
    // lines down with the sound instead of freezing them mid-swing.
    gain = ctx.createGain();
    gain.gain.value = 0;
    analyser = ctx.createAnalyser();
    // 1024 bins ≈ 21.5Hz each. 512 would put the whole bass band in two bins and
    // drop the kick fundamental into the skipped DC bin; ~1k byte reads a frame
    // is nothing next to getting the low end right.
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.6;
    // The defaults (-100…-30dB) clip anything above -30dB to a flat 255, and a
    // loud master lives well above that — so the bytes arrive already pinned and
    // no amount of downstream normalising can recover the motion. Open the
    // window up top and lift the bottom off the noise floor.
    analyser.minDecibels = -78;
    analyser.maxDecibels = -10;
    srcNode.disconnect();
    srcNode.connect(gain);
    gain.connect(analyser);
    analyser.connect(ctx.destination);
    freq = new Uint8Array(analyser.frequencyBinCount);
    const nyquist = ctx.sampleRate / 2;
    ranges = BANDS.map(([lo, hi]) => [
      Math.max(1, Math.round((lo / nyquist) * freq.length)),
      Math.min(freq.length - 1, Math.round((hi / nyquist) * freq.length)),
    ]);
    // Suspension is not something you get told about at the point it hurts —
    // you find out because the song went quiet. Watch the context itself.
    ctx.onstatechange = () => {
      if (wantPlaying && ctx && ctx.state !== "running") resumeCtx();
    };
  } catch {
    // Half a graph is worse than none. Once createMediaElementSource has run,
    // the element's output reaches the speakers ONLY through the nodes we wired,
    // so a throw partway through used to leave the audio routed into a dangling
    // node with no path to the destination — silent for the life of the page,
    // and unfixable because the retry throws too. Put the source straight on the
    // destination instead: no bars and no fades, but sound.
    analyser = null;
    gain = null;
    graphFailed = true;
    try {
      srcNode?.disconnect();
      srcNode?.connect(ctx.destination);
    } catch {
      /* nothing left to salvage */
    }
  }
}

// ── fades ──────────────────────────────────────────────────────────────────
// Every start, stop and clip-end is ramped. Scheduled on the AudioParam rather
// than stepped per frame: a per-frame `.value =` write is a staircase of ~8%
// jumps at 60fps, which is audible as zipper noise on a sustained note.
function rampTo(value, seconds) {
  if (!gain || !ctx) return;
  const g = gain.gain;
  const t = ctx.currentTime;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(value, t + seconds);
}

// The whole playing envelope — in from wherever the gain currently sits, hold,
// then out before the clip's last sample (a 30s preview is a slice out of the
// middle of a song, so it would otherwise stop dead).
//
// It always clears the timeline first and re-asserts from now. Appending would
// leave stale events behind: seek backwards with an old ramp-to-zero still
// scheduled and the track goes silent mid-playback, then stays silent until the
// new schedule's hold kicks in.
function scheduleEnvelope() {
  if (!gain || !ctx || !el || !state.duration) return;
  const g = gain.gain;
  const t = ctx.currentTime;
  const remain = state.duration - el.currentTime;

  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  // Past the end of what we think the clip is — which happens whenever the two
  // duration sources disagree. Bailing here used to leave the gain frozen at
  // whatever it was, and if that was zero the track played on in silence, so
  // open it back up rather than walking away from a muted graph.
  if (remain <= 0) {
    g.linearRampToValueAtTime(1, t + FADE_IN);
    return;
  }

  // Scaling the fade-in against what's left keeps every event monotonic in
  // time, including a seek into the final moments of the clip.
  const up = Math.min(FADE_IN, remain * 0.3);
  g.linearRampToValueAtTime(1, t + up);
  if (remain > up + FADE_TAIL) g.setValueAtTime(1, t + remain - FADE_TAIL);
  g.linearRampToValueAtTime(0, t + remain);
}

// Sound running through a gain that never came back up. The causes are all
// invisible: an envelope scheduled before the duration was known, a ramp
// cancelled by a seek, a context that resumed with a stale timeline. The
// symptom is the one being fixed here — a player that says it is playing, has a
// moving clock, and makes no noise.
function ensureAudible() {
  if (!gain || !ctx || !el || fadeTimer || stopTimer || !state.duration) return;
  const remain = state.duration - el.currentTime;
  if (remain <= FADE_TAIL + 0.15) return; // the tail fade is supposed to be quiet
  if (gain.gain.value > 0.02) return;
  scheduleEnvelope();
}

// Every path out of playback lands here. Settling the bars from inside it (not
// from the click) is what lets them ride the fade-out down with the sound —
// the loop keeps reading the analyser, which sits after the gain, until the
// element genuinely stops.
function hardPause() {
  clearTimeout(fadeTimer);
  fadeTimer = 0;
  if (el) el.pause();
  stopLoop();
  settle();
}

function teardownSource() {
  if (el) {
    el.removeAttribute("src");
    el.load(); // actually release the decoder, not just forget the attribute
  }
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}

// ── the four bands ─────────────────────────────────────────────────────────
function readLevels() {
  analyser.getByteFrequencyData(freq);
  histAt = (histAt + 1) % WIN;
  if (histN < WIN) histN++;

  for (let b = 0; b < 4; b++) {
    const [lo, hi] = ranges[b];
    let sum = 0;
    for (let i = lo; i <= hi; i++) sum += freq[i];
    const raw = Math.min(1, (sum / ((hi - lo + 1) * 255)) * TILT[b]);

    // where does this frame sit inside the band's last ~1.6 seconds?
    const h = hist[b];
    h[histAt] = raw;
    let min = 1;
    let max = 0;
    for (let i = 0; i < histN; i++) {
      const v = h[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }

    const span = Math.max(SPAN_MIN, max - min);
    const target = Math.pow(Math.min(1, Math.max(0, (raw - min) / span)), GAMMA);
    levels[b] += (target - levels[b]) * (target > levels[b] ? ATTACK : RELEASE);
  }
}

// New track, fresh ears: the previous song's dynamic range says nothing about
// this one's.
function resetAgc() {
  levels.fill(0);
  histN = 0;
  histAt = 0;
  for (const h of hist) h.fill(0);
}

function write(node, progress, withLevels) {
  node.style.setProperty("--cv-progress", progress.toFixed(4));
  if (!withLevels) return;
  for (let b = 0; b < 4; b++) {
    node.style.setProperty(`--eq${b}`, (REST + (1 - REST) * levels[b]).toFixed(3));
  }
}

// The bars' transition duration is owned here, not by a React class: live
// values land every frame and must not be eased (that would only add lag),
// while the drop back to the flat resting line should glide. Flipping the var
// in the same write as the values keeps the two in lockstep — no frame where a
// settle is applied with easing still switched off.
function setEasing(live) {
  livePrev = live;
  for (const node of visuals) node.style.setProperty("--eq-t", live ? "0s" : `${SETTLE_MS}ms`);
}

function frame(now) {
  raf = requestAnimationFrame(frame);
  const a = el;
  if (!a) return;

  const live = analyser && !reduced && !a.paused;
  if (live !== livePrev) setEasing(live);
  if (live) readLevels();

  const p = state.duration ? Math.min(1, a.currentTime / state.duration) : 0;
  for (const node of visuals) write(node, p, live);

  if (now - lastPublish >= PUBLISH_MS) {
    lastPublish = now;
    if (!scrubbing && Math.abs(a.currentTime - state.currentTime) > 0.03) {
      emit({ currentTime: a.currentTime });
    }
  }
}

function startLoop() {
  if (raf || typeof window === "undefined") return;
  if (document.hidden) return; // nothing to draw — restarted on visibilitychange
  raf = requestAnimationFrame(frame);
}
function stopLoop() {
  cancelAnimationFrame(raf);
  raf = 0;
}
// Drop every bar back to the flat resting line; CSS eases the settle.
function settle() {
  levels.fill(0);
  setEasing(false);
  for (const node of visuals) {
    for (let b = 0; b < 4; b++) node.style.setProperty(`--eq${b}`, String(REST));
  }
}

// ── the watchdog ───────────────────────────────────────────────────────────
// Runs only while the user wants sound, on a timer rather than inside the rAF
// loop: rAF is throttled to nothing in a background tab, and a track that dies
// while you are in another tab is precisely the one that needs reviving when
// you come back.
function startWatchdog() {
  if (watchdog || typeof window === "undefined") return;
  lastTime = -1;
  lastTimeAt = nowMs();
  watchdog = setInterval(checkHealth, WATCHDOG_MS);
}
function stopWatchdog() {
  clearInterval(watchdog);
  watchdog = 0;
  healCount = 0;
  lastTime = -1;
}

function checkHealth() {
  const a = el;
  if (!wantPlaying || !a) {
    stopWatchdog();
    return;
  }
  // A scrub pauses on purpose, and a load has nothing to play yet.
  if (scrubbing || state.status === "loading") return;

  if (ctx && ctx.state !== "running") resumeCtx();

  // Something paused the element that wasn't us: an OS interruption, another
  // media element claiming the audio session, a Media Session key.
  if (a.paused) {
    heal();
    return;
  }

  const t = a.currentTime;
  const now = nowMs();
  if (t !== lastTime) {
    // Real progress. Whatever went wrong before is over.
    lastTime = t;
    lastTimeAt = now;
    healCount = 0;
  } else if (now - lastTimeAt > STALL_MS) {
    heal();
    return;
  }

  ensureAudible();
}

// Escalating repair. Cheap and invisible first; the expensive, audible options
// only once the cheap ones have demonstrably failed.
function heal({ hard = false } = {}) {
  const now = nowMs();
  if (now - lastHeal < HEAL_COOLDOWN) return;
  lastHeal = now;
  const a = el;
  if (!a) return;

  // A media error is not something a re-play fixes — skip straight to refetch.
  if (hard) healCount = Math.max(healCount, NUDGE_TRIES);
  healCount++;

  if (healCount <= NUDGE_TRIES) {
    // The context went to sleep, or a cancelled ramp left the gain on the floor.
    // Neither needs the track downloaded again.
    wantPlaying = true;
    startWatchdog();
    resumeCtx();
    if (state.duration) scheduleEnvelope();
    else rampTo(1, FADE_IN);
    a.play()
      .then(() => {
        emit({ playing: true, status: state.status === "error" ? "ready" : state.status });
        startLoop();
      })
      .catch(() => {
        /* next tick escalates */
      });
    return;
  }

  if (healCount <= NUDGE_TRIES + RELOAD_TRIES && state.cover) {
    // The media itself is gone: a revoked object URL, a decode that died, a read
    // that never finished. Fetch it again and drop back in where we were.
    load(state.cover, { autoplay: true, force: true, resumeAt: a.currentTime });
    return;
  }

  // Out of ideas. The one thing worse than a broken player is a broken player
  // that looks fine, so stop pretending and hand back a button worth pressing.
  wantPlaying = false;
  stopWatchdog();
  hardPause();
  emit({ status: "error", playing: false });
}

if (typeof document !== "undefined") {
  reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopLoop();
      return;
    }
    // Coming back from a background tab, the context may have been suspended out
    // from under us — the element keeps its clock either way, so nothing about
    // the UI would have shown it. Revive both, then check we're actually playing.
    if (ctx && ctx.state !== "running") resumeCtx();
    if (wantPlaying) {
      startLoop();
      startWatchdog();
      checkHealth();
    } else if (state.playing) {
      startLoop();
    }
  });
  // Safari's back-forward cache restores the page with a dead audio graph.
  window.addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    if (ctx && ctx.state !== "running") resumeCtx();
    if (wantPlaying) {
      startWatchdog();
      checkHealth();
    }
  });
}

/** Register a DOM node to receive --eq0…--eq3 and --cv-progress. */
export function registerVisual(node) {
  if (!node) return () => {};
  visuals.add(node);
  write(node, state.duration ? state.currentTime / state.duration : 0, false);
  node.style.setProperty("--eq-t", livePrev ? "0s" : `${SETTLE_MS}ms`);
  if (!livePrev) for (let b = 0; b < 4; b++) node.style.setProperty(`--eq${b}`, String(REST));
  return () => visuals.delete(node);
}

// ── loading ────────────────────────────────────────────────────────────────
// A request with no ceiling is the whole "stuck on the ellipsis" failure: the
// status never leaves "loading", so the play button never leaves `disabled`,
// and there is nothing on screen that says why. Every attempt gets a hard
// timeout and one retry, and every outcome is a definite status.
async function fetchPreview(cover, token) {
  const url = `/api/spotify/preview?artist=${encodeURIComponent(cover.sub || "")}&title=${encodeURIComponent(cover.title)}`;

  for (let attempt = 0; attempt < FETCH_TRIES; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT);
    try {
      const res = await fetch(url, { signal: ac.signal });
      if (token !== loadToken) return { cancelled: true };
      // 404 is the server saying it looked and there is no confident match.
      // Retrying that is just a slower way to show the same answer.
      if (res.status === 404) return { missing: true };
      if (!res.ok) throw new Error(String(res.status));
      const buf = await res.arrayBuffer();
      if (token !== loadToken) return { cancelled: true };
      if (!buf.byteLength) throw new Error("empty body");
      return { buf };
    } catch {
      if (token !== loadToken) return { cancelled: true };
      if (attempt === FETCH_TRIES - 1) return { failed: true };
      await sleep(400 * (attempt + 1));
      if (token !== loadToken) return { cancelled: true };
    } finally {
      clearTimeout(timer);
    }
  }
  return { failed: true };
}

/**
 * Fetch + decode the 30s preview for a cover. No-ops when that cover is already
 * loaded, so reopening the same song from the dock never re-downloads it —
 * except when it previously failed, where the second ask is a retry.
 */
export async function load(cover, { autoplay = false, force = false, resumeAt = null } = {}) {
  const key = keyOf(cover);
  if (!key || !cover?.title) {
    wantPlaying = false;
    stopWatchdog();
    emit({ key: null, cover, status: "none", playing: false, peaks: null });
    return;
  }

  if (!force && key === state.key) {
    // Already playable — play() handles the case where the src went away.
    if (state.status === "ready") {
      if (autoplay && !state.playing) play();
      return;
    }
    // Already in flight. Record that this click wanted sound so the load that
    // is running finishes into playback instead of silently landing paused.
    if (state.status === "loading") {
      if (autoplay) wantPlaying = true;
      return;
    }
    // "none" / "error" fall through: asking again is how you retry.
  }

  const token = ++loadToken;
  const a = element();
  if (!a) return;
  // Opening a new cover within the dock's closing fade would otherwise leave
  // that teardown armed, and it fires 220ms later onto the track that has since
  // taken its place — a song that starts, plays for a fifth of a second, and
  // stops for no visible reason. Retire it here, on the old source.
  if (stopTimer) {
    clearTimeout(stopTimer);
    stopTimer = 0;
    teardownSource();
  }
  wantPlaying = !!autoplay;
  // Switching tracks shouldn't guillotine the outgoing one. Ramp it down and
  // hard-pause after; the fetch below takes longer than the fade either way, so
  // the new track never waits on it.
  if (!a.paused && gain) {
    rampTo(0, FADE_OUT);
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(hardPause, FADE_OUT * 1000);
  } else {
    hardPause();
  }
  emit({ key, cover, status: "loading", playing: false, peaks: null, duration: 0, currentTime: 0 });

  const got = await fetchPreview(cover, token);
  if (token !== loadToken || got.cancelled) return;

  // Both failure paths drop the old source. Leaving the previous track's blob
  // on the element means `src` is still truthy, and every "is there anything to
  // play" check downstream reads that as yes — a retry would resume the wrong
  // song rather than fetching this one.
  if (got.missing) {
    teardownSource();
    wantPlaying = false;
    stopWatchdog();
    emit({ status: "none", playing: false });
    return;
  }
  if (got.failed || !got.buf) {
    teardownSource();
    // Distinct from "none" on purpose: nothing about this song says there is no
    // preview, only that this attempt didn't get one. The button stays live and
    // the readout says so, instead of a disabled control and no explanation.
    wantPlaying = false;
    stopWatchdog();
    emit({ status: "error", playing: false });
    return;
  }

  const buf = got.buf;
  // outgoing fade is done (or was never needed) by now; the new track takes
  // over here, so this is the moment to forget the old one's dynamic range
  hardPause();
  resetAgc();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(new Blob([buf]));
  pendingSeek = Number.isFinite(resumeAt) && resumeAt > 0.25 ? resumeAt : null;
  lastTime = -1;
  lastTimeAt = nowMs();
  a.src = objectUrl;
  a.load();

  emit({ status: "ready" });
  if (autoplay || wantPlaying) play();

  // Peaks are for the seek bar only — decode after playback is already moving
  // so the waveform filling in never delays the first note.
  //
  // In its own try block, and that matters more than it looks: sharing one with
  // the fetch meant a preview the browser couldn't decode (an m4a Safari
  // dislikes, a slightly truncated body) threw AFTER the track was already
  // playing, and the catch flipped status to "none" — a disabled play button
  // and "no preview" written under a song that was, at that moment, audible.
  try {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) return;
    const decoded = await new OAC(1, 1024, 44100).decodeAudioData(buf.slice(0));
    if (token !== loadToken) return;
    const patch = { peaks: computePeaks(decoded, 40) };
    // The element's own duration is the transport's truth — the envelope is
    // scheduled against it. Only borrow the decoded number when the element
    // hasn't produced a usable one, otherwise the two disagree by a few
    // hundred milliseconds and the tail ramp lands in the wrong place.
    if (!(state.duration > 0)) patch.duration = decoded.duration;
    emit(patch);
  } catch {
    /* cosmetic only: the seek bar stays flat, the song plays */
  }
}

// ── transport ──────────────────────────────────────────────────────────────
// A MediaElementSource routes ALL output through the graph, so a context stuck
// in "suspended" — or in Safari's "interrupted", which is what a phone call or
// Siri leaves behind — means the element advances in perfect silence.
function resumeCtx() {
  if (!ctx || ctx.state === "running") return;
  ctx.resume().catch(() => {});
  hookGesture();
}

// One listener, not one per attempt, and it lives until the context is actually
// running rather than expiring after a single unrelated click.
function hookGesture() {
  if (gestureHooked || typeof document === "undefined") return;
  gestureHooked = true;
  const onGesture = () => {
    if (!ctx || ctx.state === "running") {
      document.removeEventListener("pointerdown", onGesture, true);
      gestureHooked = false;
      return;
    }
    ctx.resume().catch(() => {});
  };
  document.addEventListener("pointerdown", onGesture, true);
}

export function play() {
  const a = element();
  if (!a) return;
  wantPlaying = true;
  // Hitting play mid fade-out cancels the pending stop and ramps straight back
  // up from wherever the gain happens to be — no gap, no restart.
  clearTimeout(fadeTimer);
  fadeTimer = 0;
  clearTimeout(stopTimer);
  stopTimer = 0;

  // Nothing to play. This used to be a bare `return` — a click that produced no
  // sound, no state change and no explanation, which is exactly what a torn-down
  // src or a load that never finished leaves behind. Go and get the track.
  if (!a.src) {
    if (state.cover) load(state.cover, { autoplay: true, force: true });
    else emit({ playing: false, status: state.key ? "error" : state.status });
    return;
  }

  ensureGraph();
  resumeCtx();
  startWatchdog();
  a.play()
    .then(() => {
      // The envelope needs a duration. When metadata hasn't landed yet it used
      // to skip silently and leave the gain at zero until loadedmetadata fired —
      // open the gate now and let the real envelope refine it a moment later.
      if (state.duration) scheduleEnvelope();
      else rampTo(1, FADE_IN);
      emit({ playing: true, status: state.status === "error" ? "ready" : state.status });
      startLoop();
    })
    .catch((err) => {
      // A blocked autoplay is not a fault to repair — it is the browser asking
      // for a gesture, and retrying on a timer would never satisfy it.
      if (err?.name === "NotAllowedError") {
        wantPlaying = false;
        stopWatchdog();
        emit({ playing: false });
        return;
      }
      // Anything else (decode, aborted load, src pulled) is the watchdog's.
      emit({ playing: false });
    });
}

export function pause() {
  const a = el;
  if (!a) return;
  wantPlaying = false;
  stopWatchdog();
  // The UI flips now — the sound catches up over the ramp. Waiting on the fade
  // would make the button feel broken.
  emit({ playing: false });
  if (!gain) {
    hardPause();
    return;
  }
  rampTo(0, FADE_OUT);
  clearTimeout(fadeTimer);
  fadeTimer = setTimeout(hardPause, FADE_OUT * 1000);
}

export function toggle() {
  // On a track that failed, the transport button IS the retry — the alternative
  // is a dead control and a reload of the page.
  if (state.status === "error" || (state.status !== "loading" && state.cover && !el?.src)) {
    if (state.cover) load(state.cover, { autoplay: true, force: true });
    return;
  }
  if (state.playing) pause();
  else play();
}

export function seek(t) {
  const a = el;
  if (!a || !state.duration) return;
  const target = Math.max(0, Math.min(state.duration, t));
  a.currentTime = target;
  emit({ currentTime: target });
  lastTime = -1;
  lastTimeAt = nowMs();
  if (state.playing) scheduleEnvelope(); // the old tail ramp is at the wrong time now
  // Keep the progress line honest even while the transport loop is stopped.
  const p = target / state.duration;
  for (const node of visuals) write(node, p, false);
}

// A paused element re-seeks as fast as a finger can move with no audible
// artifacts, so a scrub pauses for its duration and resumes where it landed.
export function scrubStart() {
  scrubbing = true;
  // what the UI thinks, not what the element is doing — mid fade-out the
  // element is still running while the player already reads as paused.
  resumeAfterScrub = wantPlaying || state.playing;
  hardPause();
}
export function scrubEnd() {
  scrubbing = false;
  lastTime = -1;
  lastTimeAt = nowMs();
  if (resumeAfterScrub) play();
  resumeAfterScrub = false;
}

/** Stop and forget the current track (the dock's close button). */
export function stop() {
  loadToken++;
  wantPlaying = false;
  stopWatchdog();
  const a = el;
  // Ramp out, then tear down — the dock exits over roughly the same beat.
  if (a && !a.paused && gain) {
    rampTo(0, FADE_OUT);
    clearTimeout(stopTimer);
    stopTimer = setTimeout(() => {
      stopTimer = 0;
      hardPause();
      teardownSource();
    }, FADE_OUT * 1000);
  } else {
    hardPause();
    teardownSource();
  }
  emit({ key: null, cover: null, status: "idle", playing: false, duration: 0, currentTime: 0, peaks: null });
}

// ---------------------------------------------------------------------------
// Seek-bar peaks — the same problem as the four bars, and the same answer.
//
// Block-peak over global-max renders a modern master as a solid wall: every
// block clips near the same value, so all 40 bars come out the same height and
// the waveform carries no information. Three changes fix it:
//
//   RMS, not peak   — peak is pinned by the limiter on basically every block;
//                     RMS still tracks how dense the block actually is.
//   dB, not linear  — loudness is logarithmic, and so is the eye.
//   p5…p95, not 0…max — normalise across the range the track actually occupies.
//
// The percentile window is what does the real work, and it's also the risky
// part: on a track with genuinely no dynamics it would stretch noise into
// invented structure. MIN_SPAN_DB is the guard — below that the window stops
// expanding and a flat track is allowed to look flat.
// ---------------------------------------------------------------------------
const MIN_SPAN_DB = 7; // narrowest window worth stretching across
const BAR_FLOOR = 0.1; // quietest block still reads as a stub, never a gap

function computePeaks(buf, n) {
  const chans = Math.min(2, buf.numberOfChannels);
  const left = buf.getChannelData(0);
  const right = chans > 1 ? buf.getChannelData(1) : null;
  const block = Math.max(1, Math.floor(left.length / n));

  const db = new Array(n);
  for (let i = 0; i < n; i++) {
    const start = i * block;
    let sum = 0;
    for (let j = 0; j < block; j++) {
      const k = start + j;
      const v = right ? ((left[k] || 0) + (right[k] || 0)) / 2 : left[k] || 0;
      sum += v * v;
    }
    db[i] = 20 * Math.log10(Math.max(Math.sqrt(sum / block), 1e-5));
  }

  const sorted = [...db].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(n - 1, Math.max(0, Math.round(q * (n - 1))))];
  let lo = at(0.05);
  let hi = at(0.95);
  if (hi - lo < MIN_SPAN_DB) {
    const mid = (hi + lo) / 2;
    lo = mid - MIN_SPAN_DB / 2;
    hi = mid + MIN_SPAN_DB / 2;
  }

  return db.map((v) => BAR_FLOOR + (1 - BAR_FLOOR) * Math.min(1, Math.max(0, (v - lo) / (hi - lo))));
}
