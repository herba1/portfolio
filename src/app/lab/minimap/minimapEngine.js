import { createSpring, settleSpring, springAtRest, stepSpring, tuneSpring } from "./minimapSpring";

const LINE_SPAN = 52;
const SCROLL_MAX_VELOCITY = 7200;
const READ_GAP = 24;

export function mountMinimap({ root, scroller, article, track, label, labelNumber, labelTitle, ticks, stem, lines, blocks, blockEls, inset }) {
  const count = blocks.length;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const st = {
    pitch: 8,
    lineOffset: 3,
    offsets: new Array(count + 1).fill(0),
    viewH: 0,
    maxScroll: 0,
    hover: false,
    dragging: false,
    moved: false,
    downY: 0,
    focused: false,
    pointerY: 0,
    rectTop: 0,
    keyIndex: -1,
    nearIndex: -1,
    from: -2,
    to: -2,
    current: -1,
    lastWritten: -1,
    scrollActive: false,
    linesAtRest: false,
    raf: 0,
    last: 0,
  };
  const presence = createSpring(0, 0.3, 1);
  const dock = createSpring(0, 0.12, 1);
  const tag = createSpring(0, 0.22, 0.92);
  const scroll = createSpring(0, 0.6, 1);
  const lineState = new Array(count).fill("");
  const lineScale = new Array(count).fill(-1);

  const lineCenter = (i) => i * st.pitch + st.lineOffset + 0.5;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  function measure() {
    const boxH = root.clientHeight;
    const avail = boxH - inset - 16 - 32;
    st.pitch = clamp(Math.floor(avail / count), 3, 8);
    st.lineOffset = Math.floor((st.pitch - 1) / 2);
    root.style.setProperty("--mm-pitch", `${st.pitch}px`);
    root.style.setProperty("--mm-line-offset", `${st.lineOffset}px`);
    for (let i = 0; i < count; i += 1) st.offsets[i] = blockEls[i].offsetTop;
    const lastEl = blockEls[count - 1];
    st.offsets[count] = lastEl.offsetTop + lastEl.offsetHeight;
    st.viewH = scroller.clientHeight;
    st.maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    st.from = -2;
    st.linesAtRest = false;
    lineScale.fill(-1);
  }

  function toRail(y) {
    const o = st.offsets;
    if (y <= o[0]) return 0;
    if (y >= o[count]) return count;
    let lo = 0;
    let hi = count;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (o[mid] <= y) lo = mid;
      else hi = mid;
    }
    return lo + (y - o[lo]) / (o[lo + 1] - o[lo]);
  }

  function fromRail(pos) {
    const p = clamp(pos, 0, count);
    const i = Math.min(count - 1, Math.floor(p));
    return st.offsets[i] + (p - i) * (st.offsets[i + 1] - st.offsets[i]);
  }

  function scrollTopFor(index) {
    return clamp(st.offsets[index] - inset - READ_GAP, 0, st.maxScroll);
  }

  function readIndex(top) {
    return clamp(Math.floor(toRail(top + inset + READ_GAP + 4)), 0, count - 1);
  }

  function frame(now) {
    st.raf = 0;
    const dt = Math.min(0.034, Math.max(0.001, (now - st.last) / 1000));
    st.last = now;
    let moving = false;
    if (st.scrollActive) {
      stepSpring(scroll, dt, SCROLL_MAX_VELOCITY);
      if (springAtRest(scroll, 0.5)) {
        settleSpring(scroll);
        st.scrollActive = false;
      } else moving = true;
      st.lastWritten = Math.round(scroll.x);
      scroller.scrollTop = scroll.x;
    }
    for (const s of [presence, dock, tag]) {
      stepSpring(s, dt);
      if (springAtRest(s, 0.002 + (s === presence ? 0 : 0.05))) settleSpring(s);
      else moving = true;
    }
    render(st.scrollActive ? scroll.x : scroller.scrollTop);
    if (moving) schedule();
  }

  function schedule() {
    if (st.raf) return;
    st.raf = requestAnimationFrame(frame);
  }

  function kick() {
    if (st.raf) return;
    st.last = performance.now() - 16;
    schedule();
  }

  function render(top) {
    const pitch = st.pitch;
    const railTop = toRail(top + inset);
    const railBottom = toRail(top + st.viewH);
    const y0 = Math.round(railTop * pitch);
    const y1 = Math.max(y0 + 4, Math.round(railBottom * pitch));
    ticks[0].style.transform = `translate3d(0, ${y0}px, 0)`;
    ticks[1].style.transform = `translate3d(0, ${y1 - 1}px, 0)`;
    stem.style.transform = `translate3d(0, ${y0}px, 0) scaleY(${(y1 - y0) / 100})`;

    const from = clamp(Math.floor(railTop + 0.15), 0, count - 1);
    const to = clamp(Math.ceil(railBottom - 0.15) - 1, from, count - 1);
    if (from !== st.from || to !== st.to) {
      st.from = from;
      st.to = to;
      for (let i = 0; i < count; i += 1) {
        const next = i < from ? "read" : i <= to ? "view" : "";
        if (next !== lineState[i]) {
          lineState[i] = next;
          lines[i].dataset.state = next;
        }
      }
    }

    const current = readIndex(top);
    if (current !== st.current) {
      st.current = current;
      track.setAttribute("aria-valuenow", String(current + 1));
      track.setAttribute("aria-valuetext", blocks[current].kind === "heading" ? blocks[current].sectionTitle : `Paragraph ${blocks[current].number}, ${blocks[current].sectionTitle}`);
    }

    const amount = presence.x;
    const motion = !reduced.matches;
    if (amount > 0.001 && motion) {
      const sigma = Math.max(18, pitch * 3.4);
      for (let i = 0; i < count; i += 1) {
        const d = (lineCenter(i) - dock.x) / sigma;
        const g = amount * Math.exp(-d * d);
        const base = (blocks[i].width * 40) / LINE_SPAN;
        const sx = Math.round(Math.min(1, base * (1 + 0.42 * g) + (12 / LINE_SPAN) * g) * 1000) / 1000;
        const near = d * 2.2;
        const sy = Math.round((0.5 + 0.5 * amount * Math.exp(-near * near)) * 1000) / 1000;
        const key = sx * 10 + sy;
        if (key !== lineScale[i]) {
          lineScale[i] = key;
          lines[i].style.transform = `scale(${sx}, ${sy})`;
        }
      }
      st.linesAtRest = false;
    } else if (!st.linesAtRest) {
      for (let i = 0; i < count; i += 1) {
        lines[i].style.transform = "";
        lineScale[i] = -1;
      }
      st.linesAtRest = true;
    }

    label.style.opacity = String(Math.round(amount * 1000) / 1000);
    const shift = motion ? (1 - amount) * 6 : 0;
    label.style.transform = `translate3d(${shift}px, ${Math.round(tag.x * 2) / 2 - 12}px, 0)`;
  }

  function setNear(index) {
    if (index === st.nearIndex) return;
    if (st.nearIndex >= 0) delete lines[st.nearIndex].dataset.near;
    st.nearIndex = index;
    if (index < 0) return;
    lines[index].dataset.near = "";
    const block = blocks[index];
    if (block.kind === "heading") {
      labelNumber.textContent = "§";
      labelTitle.textContent = block.sectionTitle;
    } else {
      labelNumber.textContent = String(block.number).padStart(2, "0");
      labelTitle.textContent = block.sectionTitle;
    }
    tag.target = lineCenter(index);
    if (presence.x < 0.05 || reduced.matches) settleSpring(tag);
  }

  function indexAt(y) {
    return clamp(Math.round((y - st.lineOffset - 0.5) / st.pitch), 0, count - 1);
  }

  function scrollTo(target, response) {
    const goal = clamp(target, 0, st.maxScroll);
    if (reduced.matches) {
      st.scrollActive = false;
      scroller.scrollTop = goal;
      kick();
      return;
    }
    if (!st.scrollActive) {
      scroll.x = scroller.scrollTop;
      scroll.v = 0;
    }
    tuneSpring(scroll, response, 1);
    scroll.target = goal;
    st.scrollActive = true;
    kick();
  }

  function cancelScroll() {
    if (!st.scrollActive) return;
    st.scrollActive = false;
    scroll.v = 0;
  }

  function show(y, snap) {
    if (snap || presence.x < 0.05) {
      dock.x = y;
      dock.v = 0;
    }
    dock.target = y;
    presence.target = 1;
  }

  function hideIfIdle() {
    if (st.hover || st.dragging || st.focused) return;
    presence.target = 0;
    setNear(-1);
  }

  function readPointer(e) {
    st.pointerY = e.clientY - st.rectTop;
  }

  function onEnter(e) {
    if (e.pointerType !== "mouse") return;
    st.rectTop = track.getBoundingClientRect().top;
    readPointer(e);
    st.hover = true;
    st.keyIndex = -1;
    show(st.pointerY, true);
    setNear(indexAt(st.pointerY));
    kick();
  }

  function onMove(e) {
    if (!st.hover && !st.dragging) {
      if (e.pointerType === "mouse") onEnter(e);
      return;
    }
    readPointer(e);
    dock.target = st.pointerY;
    setNear(indexAt(st.pointerY));
    if (st.dragging) {
      if (!st.moved && Math.abs(st.pointerY - st.downY) > 3) st.moved = true;
      if (st.moved) {
        const center = fromRail(st.pointerY / st.pitch);
        scrollTo(center - (inset + st.viewH) / 2, 0.2);
      }
    }
    kick();
  }

  function onLeave(e) {
    if (e.pointerType !== "mouse") return;
    st.hover = false;
    hideIfIdle();
    kick();
  }

  function onDown(e) {
    if (e.button !== 0) return;
    st.rectTop = track.getBoundingClientRect().top;
    readPointer(e);
    st.dragging = true;
    st.moved = false;
    st.downY = st.pointerY;
    st.keyIndex = -1;
    track.setPointerCapture(e.pointerId);
    track.dataset.pressed = "";
    show(st.pointerY, e.pointerType !== "mouse");
    setNear(indexAt(st.pointerY));
    kick();
  }

  function onUp(e) {
    if (!st.dragging) return;
    st.dragging = false;
    delete track.dataset.pressed;
    if (!st.moved) scrollTo(scrollTopFor(indexAt(st.pointerY)), 0.62);
    if (e.pointerType !== "mouse") st.hover = false;
    hideIfIdle();
    kick();
  }

  function onLost() {
    if (!st.dragging) return;
    st.dragging = false;
    delete track.dataset.pressed;
    hideIfIdle();
    kick();
  }

  function goTo(index) {
    const i = clamp(index, 0, count - 1);
    st.keyIndex = i;
    show(lineCenter(i), false);
    setNear(i);
    scrollTo(scrollTopFor(i), 0.5);
  }

  function onKey(e) {
    const base = st.scrollActive && st.keyIndex >= 0 ? st.keyIndex : st.current;
    let next = -1;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") next = base + 1;
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = base - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = count - 1;
    else if (e.key === "PageDown") {
      next = count - 1;
      for (let i = base + 1; i < count; i += 1) if (blocks[i].kind === "heading") { next = i; break; }
    } else if (e.key === "PageUp") {
      next = 0;
      for (let i = base - 1; i >= 0; i -= 1) if (blocks[i].kind === "heading") { next = i; break; }
    } else if (e.key === "Enter" || e.key === " ") {
      next = base;
    }
    if (next < 0) return;
    e.preventDefault();
    goTo(next);
  }

  function onFocus() {
    st.focused = true;
    if (!track.matches(":focus-visible")) return;
    const i = st.current < 0 ? 0 : st.current;
    show(lineCenter(i), true);
    setNear(i);
    kick();
  }

  function onBlur() {
    st.focused = false;
    st.keyIndex = -1;
    hideIfIdle();
    kick();
  }

  function onScroll() {
    if (st.scrollActive && Math.abs(scroller.scrollTop - st.lastWritten) > 2) cancelScroll();
    kick();
  }

  function onUserIntent(e) {
    if (track.contains(e.target)) return;
    cancelScroll();
  }

  function onScrollerKey(e) {
    if (track.contains(e.target)) return;
    if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(e.key)) cancelScroll();
  }

  measure();
  render(scroller.scrollTop);

  const resize = new ResizeObserver(() => {
    measure();
    if (st.nearIndex >= 0) {
      tag.target = lineCenter(st.nearIndex);
      settleSpring(tag);
    }
    render(st.scrollActive ? scroll.x : scroller.scrollTop);
  });
  resize.observe(root);
  resize.observe(article);
  let alive = true;
  document.fonts?.ready.then(() => {
    if (!alive) return;
    measure();
    render(scroller.scrollTop);
  });

  const passive = { passive: true };
  track.addEventListener("pointerenter", onEnter, passive);
  track.addEventListener("pointermove", onMove, passive);
  track.addEventListener("pointerleave", onLeave, passive);
  track.addEventListener("pointerdown", onDown, passive);
  track.addEventListener("pointerup", onUp, passive);
  track.addEventListener("pointercancel", onUp, passive);
  track.addEventListener("lostpointercapture", onLost, passive);
  track.addEventListener("keydown", onKey);
  track.addEventListener("focus", onFocus);
  track.addEventListener("blur", onBlur);
  scroller.addEventListener("scroll", onScroll, passive);
  scroller.addEventListener("wheel", onUserIntent, passive);
  scroller.addEventListener("touchstart", onUserIntent, passive);
  scroller.addEventListener("pointerdown", onUserIntent, passive);
  scroller.addEventListener("keydown", onScrollerKey, passive);

  return () => {
    alive = false;
    if (st.raf) cancelAnimationFrame(st.raf);
    resize.disconnect();
    track.removeEventListener("pointerenter", onEnter);
    track.removeEventListener("pointermove", onMove);
    track.removeEventListener("pointerleave", onLeave);
    track.removeEventListener("pointerdown", onDown);
    track.removeEventListener("pointerup", onUp);
    track.removeEventListener("pointercancel", onUp);
    track.removeEventListener("lostpointercapture", onLost);
    track.removeEventListener("keydown", onKey);
    track.removeEventListener("focus", onFocus);
    track.removeEventListener("blur", onBlur);
    scroller.removeEventListener("scroll", onScroll);
    scroller.removeEventListener("wheel", onUserIntent);
    scroller.removeEventListener("touchstart", onUserIntent);
    scroller.removeEventListener("pointerdown", onUserIntent);
    scroller.removeEventListener("keydown", onScrollerKey);
  };
}
