const active = new Set();
let raf = 0;
let last = 0;

function frame(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  for (const item of active) {
    if (!item.step(dt)) active.delete(item);
  }
  if (active.size) {
    raf = requestAnimationFrame(frame);
  } else {
    raf = 0;
    last = 0;
  }
}

export function wake(item) {
  active.add(item);
  if (!raf) {
    last = 0;
    raf = requestAnimationFrame(frame);
  }
}

export function sleep(item) {
  active.delete(item);
}

export function springFor(response, damping) {
  return { k: (2 * Math.PI / response) ** 2, c: (4 * Math.PI * damping) / response };
}

const PERMS = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

function lineCost(from, to, flip) {
  const ax = flip ? to[2] : to[0];
  const ay = flip ? to[3] : to[1];
  const bx = flip ? to[0] : to[2];
  const by = flip ? to[1] : to[3];
  return (from[0] - ax) ** 2 + (from[1] - ay) ** 2 + (from[2] - bx) ** 2 + (from[3] - by) ** 2;
}

export function assign(current, target) {
  let best = null;
  let bestCost = Infinity;
  for (const perm of PERMS) {
    let cost = 0;
    const flips = [];
    for (let i = 0; i < 3; i += 1) {
      const from = current[i];
      const to = target[perm[i]];
      const straight = lineCost(from, to, false);
      const flipped = lineCost(from, to, true);
      const flip = flipped + 0.001 < straight;
      flips.push(flip);
      cost += flip ? flipped : straight;
    }
    if (cost < bestCost - 0.001) {
      bestCost = cost;
      best = perm.map((j, i) => {
        const to = target[j];
        return flips[i] ? [to[2], to[3], to[0], to[1], to[4]] : to;
      });
    }
  }
  return best;
}
