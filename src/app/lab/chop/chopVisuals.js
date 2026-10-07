const CHUNKY = 3;
const WAVE_STEP_MS = 90;
const WAVE_RING_MS = 48;
const RING_EPSILON = 0.002;

function levelFor(progress) {
  if (progress < 0.25) return 3;
  if (progress < 0.5) return 2;
  if (progress < 0.75) return 1;
  return 0;
}

export function createChopVisuals({ tiles, arts, rings, keys, clock }) {
  const count = tiles.length;
  const active = new Array(count).fill(null);
  const shown = new Int8Array(count).fill(-1);
  const rest = new Int8Array(count).fill(CHUNKY);
  const waveFrom = new Int8Array(count);
  const waveDelay = new Float32Array(count);
  const ringShown = new Float32Array(count).fill(-1);
  const beat = new Uint8Array(count);
  const queue = [];
  let waveStart = -1;
  let frame = 0;
  let alive = true;

  function show(index, level) {
    if (shown[index] === level) return;
    shown[index] = level;
    arts[index].dataset.res = String(level);
  }

  function ring(index, progress) {
    if (Math.abs(ringShown[index] - progress) < RING_EPSILON) return;
    ringShown[index] = progress;
    rings[index].style.strokeDasharray = `${progress.toFixed(4)} 2`;
  }

  function begin(voice) {
    const index = voice.position;
    active[index] = voice;
    rest[index] = 0;
    if (voice.retrigger) {
      beat[index] ^= 1;
      arts[index].dataset.beat = beat[index] ? "a" : "b";
    }
    ringShown[index] = -1;
    ring(index, 0);
    tiles[index].setAttribute("data-live", "");
    keys[index]?.setAttribute("data-live", "");
  }

  function finish(index) {
    active[index] = null;
    tiles[index].removeAttribute("data-live");
    keys[index]?.removeAttribute("data-live");
  }

  function loop() {
    frame = 0;
    if (!alive) return;
    const now = clock();
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      const voice = queue[index];
      if (!voice.cancelled && voice.when > now) continue;
      queue[index] = queue[queue.length - 1];
      queue.pop();
      if (!voice.cancelled) begin(voice);
    }

    let busy = queue.length > 0;
    let waving = false;
    const wallClock = waveStart >= 0 ? performance.now() - waveStart : 0;
    for (let index = 0; index < count; index += 1) {
      const voice = active[index];
      if (voice) {
        const progress = (now - voice.when) / voice.natural;
        if (voice.cancelled || now >= voice.end || progress >= 1) {
          finish(index);
        } else {
          show(index, levelFor(progress));
          ring(index, Math.max(0, progress));
          busy = true;
          continue;
        }
      }
      if (waveStart >= 0 && rest[index] > 0) {
        const elapsed = wallClock - waveDelay[index];
        const target = elapsed < 0 ? waveFrom[index] : Math.max(0, waveFrom[index] - 1 - Math.floor(elapsed / WAVE_STEP_MS));
        if (target < rest[index]) rest[index] = target;
        if (rest[index] > 0) waving = true;
      }
      show(index, rest[index]);
    }
    if (!waving) waveStart = -1;
    if (busy || waving) frame = requestAnimationFrame(loop);
  }

  function kick() {
    if (!frame && alive) frame = requestAnimationFrame(loop);
  }

  function add(voice) {
    queue.push(voice);
    kick();
  }

  function chunk() {
    for (let index = 0; index < count; index += 1) {
      rest[index] = CHUNKY;
      if (!active[index]) show(index, CHUNKY);
    }
    waveStart = -1;
  }

  function wave(origin, reduced) {
    let any = false;
    for (let index = 0; index < count; index += 1) {
      const distance = Math.hypot((index % 4) - origin.col, Math.floor(index / 4) - origin.row);
      waveFrom[index] = rest[index];
      waveDelay[index] = reduced ? 0 : distance * WAVE_RING_MS;
      if (rest[index] > 0) any = true;
    }
    if (!any) return;
    waveStart = performance.now();
    kick();
  }

  function clear() {
    queue.length = 0;
    for (let index = 0; index < count; index += 1) if (active[index]) finish(index);
  }

  function destroy() {
    alive = false;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  }

  return { add, chunk, wave, clear, destroy, kick };
}
