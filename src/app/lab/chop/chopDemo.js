const STEPS = 16;
const BARS = 4;
const CYCLE = STEPS * BARS;
const BAR_LEVELS = [3, 2, 1, 1];
const FIGURE = [0, 0, 6, 0, 4, 4, 6, 7, 8, 8, 2, 8, 12, 13, 6, 15];
const MOVES = [
  [2, 9],
  [7, 3],
  [12, 5],
];
const MOVE_AT = STEPS * 2;
const SHARPEN = 4;
const MIN_STEP = 0.12;

export function createChopDemo({ tiles, arts, rings, keys, ticks, stepSeconds, onMove }) {
  const count = tiles.length;
  const level = new Int8Array(count).fill(-1);
  let frame = 0;
  let origin = 0;
  let cursor = -1;
  let lit = -1;
  let scrambled = false;
  let alive = true;

  function show(index, next) {
    if (level[index] === next) return;
    level[index] = next;
    arts[index].dataset.res = String(next);
  }

  function light(index, on) {
    if (index < 0) return;
    if (on) {
      tiles[index].setAttribute("data-live", "");
      keys[index]?.setAttribute("data-live", "");
      ticks?.[index]?.setAttribute("data-live", "");
      return;
    }
    tiles[index].removeAttribute("data-live");
    keys[index]?.removeAttribute("data-live");
    ticks?.[index]?.removeAttribute("data-live");
  }

  function trace(index, progress) {
    if (index < 0) return;
    const value = progress.toFixed(4);
    rings[index].style.strokeDasharray = `${value} 2`;
    ticks?.[index]?.style.setProperty("--chop-fill", value);
  }

  function scramble(apply) {
    scrambled = apply;
    MOVES.forEach(([step, slice]) => onMove(step, apply ? slice : step, slice));
  }

  function loop() {
    if (!alive) return;
    const span = Math.max(MIN_STEP, stepSeconds());
    const elapsed = (performance.now() - origin) / 1000 / span;
    const absolute = Math.floor(elapsed);
    const within = elapsed - absolute;
    const cycle = absolute % CYCLE;
    const bar = Math.floor(cycle / STEPS);
    if (absolute !== cursor) {
      cursor = absolute;
      if (cycle === MOVE_AT && !scrambled) scramble(true);
      if (cycle === 0 && scrambled) scramble(false);
      light(lit, false);
      trace(lit, 0);
      lit = bar === 0 ? cycle : FIGURE[cycle % STEPS];
      light(lit, true);
    }
    const rest = BAR_LEVELS[bar];
    const decay = Math.min(rest, Math.floor(within * SHARPEN));
    for (let index = 0; index < count; index += 1) show(index, index === lit ? decay : rest);
    trace(lit, within);
    frame = requestAnimationFrame(loop);
  }

  function start() {
    if (frame || !alive) return;
    origin = performance.now();
    cursor = -1;
    lit = -1;
    level.fill(-1);
    frame = requestAnimationFrame(loop);
  }

  function stop() {
    if (!frame) return;
    cancelAnimationFrame(frame);
    frame = 0;
    light(lit, false);
    trace(lit, 0);
    lit = -1;
  }

  function destroy() {
    alive = false;
    stop();
  }

  return {
    start,
    stop,
    destroy,
    get live() {
      return frame !== 0;
    },
  };
}
