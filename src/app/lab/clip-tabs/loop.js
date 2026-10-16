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
