"use client";

// Every tile's piece passes through here twice: once to fetch its chunk
// (warm), once to mount it (a component tree commits, a WebGL context comes
// up, a shader compiles). Both run well ahead of the scroll, so a tile is
// already live — and takes a finger — by the time it arrives on screen.
//
// Warming starts a few screens out and runs nearest first, a couple of
// fetches at a time, so the next tiles' code lands before the far ones'.
// Mounting starts about a screen and a half out, one tile per slot, nearest
// first and the way the page is moving before the way it came. A mount ahead
// of the scroll waits for a quiet moment, but never long: a busy page (every
// piece on screen animating) has no idle time to give, and a queue that only
// ran in idle slots would never reach the bottom of it. A tile on screen, or
// one a visitor reaches for, does not wait at all.
//
// Mounted pieces stay (each pauses itself offscreen) until more than BUDGET
// are alive; then the one farthest behind is unmounted. A tile is only
// mounted ahead when it would not be the first one evicted, so the queue
// never mounts and tears down the same piece in turn.

const SCROLL_QUIET_MS = 100;
// How long a ready mount ahead of the scroll waits for an idle slot.
const IDLE_WAIT_MS = 120;
// How long it waits while the page is still moving. A long flick on a phone
// scrolls for a second or more; the tile it lands on cannot wait that out.
const SCROLL_WAIT_MS = 320;
// A tile behind the scroll counts as this much farther than one ahead.
const BEHIND = 2;

const jobs = new Set();
const alive = new Set();
// Jobs set aside because the budget is full of nearer tiles. They come back
// into the queue whenever the page moves, since what is near changes.
const parked = new Set();
let scheduled = false;
let lastScroll = -Infinity;
let lastY = 0;
let direction = 1;

const isBrowser = typeof window !== "undefined";

const idle =
  isBrowser && "requestIdleCallback" in window
    ? (fn) => window.requestIdleCallback(fn, { timeout: IDLE_WAIT_MS })
    : (fn) => setTimeout(fn, 16);

if (isBrowser) {
  lastY = window.scrollY;
  window.addEventListener(
    "scroll",
    () => {
      lastScroll = performance.now();
      const y = window.scrollY;
      if (y !== lastY) direction = y > lastY ? 1 : -1;
      lastY = y;
      if (!parked.size) return;
      for (const job of parked) {
        job.parked = false;
        jobs.add(job);
      }
      parked.clear();
      schedule();
    },
    { passive: true, capture: true },
  );
}

function budget() {
  // Coarse pointers are phones and tablets: smaller GPU, a stricter context
  // cap (Chrome on Android keeps eight), and a stacked layout where few tiles
  // share the screen.
  return window.matchMedia("(pointer: coarse)").matches ? 6 : 12;
}

function onScreen(rect) {
  return rect.bottom > 0 && rect.top < window.innerHeight;
}

// How far a tile is from being seen, in pixels; a tile on screen ranks by how
// much of it shows. A tile behind the scroll counts double.
function distance(element) {
  const rect = element.getBoundingClientRect();
  const height = window.innerHeight;
  if (onScreen(rect)) return -(Math.min(rect.bottom, height) - Math.max(rect.top, 0));
  const below = rect.top >= height;
  const gap = below ? rect.top - height : -rect.bottom;
  return (below ? 1 : -1) === direction ? gap : gap * BEHIND;
}

function farthestAlive() {
  let worst = null;
  let worstDistance = -Infinity;
  for (const entry of alive) {
    const d = distance(entry.element);
    // Never a tile on screen.
    if (d <= 0) continue;
    if (d > worstDistance) {
      worst = entry;
      worstDistance = d;
    }
  }
  return worst ? { entry: worst, distance: worstDistance } : null;
}

function nextMount() {
  let best = null;
  let bestDistance = Infinity;
  for (const job of jobs) {
    if (!job.ready || !job.mount) continue;
    const d = job.urgent ? -Infinity : distance(job.element);
    if (d < bestDistance) {
      best = job;
      bestDistance = d;
    }
  }
  return best ? { job: best, distance: bestDistance } : null;
}

function run(job) {
  jobs.delete(job);
  job.run();
}

function evict(entry) {
  alive.delete(entry);
  entry.evict();
}

function pump(deadline) {
  scheduled = false;
  const now = performance.now();
  const next = nextMount();
  const over = alive.size - budget();

  if (next) {
    const { job, distance: d } = next;
    // On screen, or reached for: now.
    if (d <= 0) {
      run(job);
      if (over >= 0) {
        const far = farthestAlive();
        if (far) evict(far.entry);
      }
      return reschedule();
    }
    const scrolling = now - lastScroll < SCROLL_QUIET_MS;
    // Counted from when it came within reach with its code here, not from
    // when its code arrived: a tile warmed long ago is not overdue.
    const waited = now - Math.max(job.readyAt, job.wantedAt);
    const roomy = !deadline || deadline.didTimeout || deadline.timeRemaining() >= 8;
    const due = scrolling ? waited > SCROLL_WAIT_MS : roomy || waited > IDLE_WAIT_MS;
    if (due) {
      if (over < 0) {
        run(job);
        return reschedule();
      }
      // Full: only for a tile nearer than the farthest one alive, which
      // makes room for it.
      const far = farthestAlive();
      if (far && far.distance > d) {
        evict(far.entry);
        run(job);
        return reschedule();
      }
      // Nothing to gain; leave it until the page moves.
      jobs.delete(job);
      job.parked = true;
      parked.add(job);
    }
    return reschedule();
  }

  if (over > 0) {
    if (now - lastScroll < SCROLL_QUIET_MS) return schedule();
    const far = farthestAlive();
    // Over budget with every piece on screen: nothing to do until it moves.
    if (!far) return reschedule(false);
    evict(far.entry);
  }
  return reschedule();
}

function pending(evictions) {
  if (evictions && alive.size > budget()) return true;
  for (const job of jobs) if (job.ready && job.mount) return true;
  return false;
}

function reschedule(evictions = true) {
  if (pending(evictions)) schedule();
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  // A tile on screen with its code here is mounted on the next frame; the
  // rest wait for an idle slot, or their turn to come due.
  requestAnimationFrame(() => {
    for (const job of jobs) {
      if (job.ready && job.mount && (job.urgent || onScreen(job.element.getBoundingClientRect()))) {
        pump(null);
        return;
      }
    }
    idle(pump);
  });
}

// Chunk fetches go out nearest tile first, a few at a time. Started all at
// once, the tiles far below split the connection with the ones about to
// arrive and everything lands late together.
let loading = 0;
const maxLoading = () => (isBrowser && window.matchMedia("(pointer: coarse)").matches ? 2 : 3);

function start(job) {
  job.started = true;
  loading += 1;
  Promise.resolve(job.load()).finally(() => {
    loading -= 1;
    job.ready = true;
    job.readyAt = performance.now();
    if (jobs.has(job) && job.mount) schedule();
    pumpLoads();
  });
}

function pumpLoads() {
  while (loading < maxLoading()) {
    let next = null;
    let nextDistance = Infinity;
    for (const job of jobs) {
      if (job.started) continue;
      const d = job.urgent ? -Infinity : distance(job.element);
      if (d < nextDistance) {
        next = job;
        nextDistance = d;
      }
    }
    if (!next) return;
    start(next);
  }
}

// A tile's place in the queue. `load` fetches its chunk, `run` mounts it.
// The tile calls `warm()` as it comes within a few screens, `mount()` as it
// comes within reach, `urgent()` when it is on screen and a visitor reaches
// for it, and `cancel()` when it drifts out of range again — a flick past
// twenty tiles mounts none of them, and fetches only the ones it slowed near.
export function enqueueTile(element, load, run) {
  const job = {
    element,
    load,
    run() {
      job.mount = false;
      job.urgent = false;
      job.alive = true;
      run();
    },
    ready: false,
    readyAt: 0,
    wantedAt: 0,
    started: false,
    mount: false,
    urgent: false,
    parked: false,
    alive: false,
  };
  const ensure = () => {
    if (!jobs.has(job) && !job.parked) jobs.add(job);
  };
  return {
    warm() {
      if (job.alive) return;
      ensure();
      pumpLoads();
    },
    mount() {
      if (job.alive) return;
      ensure();
      if (!job.mount) job.wantedAt = performance.now();
      job.mount = true;
      pumpLoads();
      if (job.ready) schedule();
    },
    unmount() {
      job.mount = false;
      job.urgent = false;
    },
    urgent() {
      if (job.alive) return;
      ensure();
      job.mount = true;
      job.urgent = true;
      if (job.parked) {
        parked.delete(job);
        job.parked = false;
        jobs.add(job);
      }
      // A visitor's hand skips the line for the network too.
      if (!job.started) start(job);
      else if (job.ready) schedule();
    },
    // The piece was unmounted (evicted); it may be queued again.
    released() {
      job.alive = false;
    },
    cancel() {
      jobs.delete(job);
      parked.delete(job);
      job.parked = false;
      job.mount = false;
      job.urgent = false;
    },
  };
}

// Register a mounted piece; `evict` unmounts it. Returns a release for when
// the tile itself goes away.
export function retain(element, evictTile) {
  const entry = { element, evict: evictTile };
  alive.add(entry);
  if (alive.size > budget()) schedule();
  return () => alive.delete(entry);
}
