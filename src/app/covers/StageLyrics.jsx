"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  STAGE,
  SpringValue,
  characterReveal,
  clamp,
  falloff,
  holdEmphasis,
  holdShimmer,
  makeSpec,
} from "./lib/stageMotion";

const SEEK_MS = 240;
const SCROLL_DAMPING = 0.88;

function spokenWords(line) {
  if (line.start == null) {
    return line.text
      .split(/\s+/)
      .filter(Boolean)
      .map((text) => ({ text, start: -1, end: -1 }));
  }
  if (line.words?.length) {
    return line.words.filter((word) => word.text.trim()).map((word) => ({ ...word, text: word.text.trim() }));
  }
  const tokens = line.text.split(/\s+/).filter(Boolean);
  const weight = tokens.reduce((sum, token) => sum + token.length, 0) || 1;
  let cursor = line.start;
  return tokens.map((text) => {
    const start = cursor;
    cursor += ((line.end - line.start) * text.length) / weight;
    return { text, start, end: cursor };
  });
}

function setChar(char, reveal, shimmer, lift, scale) {
  char.style.setProperty("--c", reveal);
  char.style.setProperty("--s", shimmer);
  char.style.setProperty("--hold-lift", lift);
  char.style.setProperty("--hold-scale", scale);
}

function animateChars(chars, ms, reduced) {
  for (const char of chars) {
    const start = +char.dataset.s;
    if (reduced) {
      setChar(char, ms >= start ? "1" : "0", "0", "0em", "1");
      continue;
    }
    const end = +char.dataset.e;
    const at = +char.dataset.i;
    const count = +char.dataset.n;
    const elapsed = ms - start;
    const span = Math.max(1, end - start);
    const rise = characterReveal(elapsed, span, at, count);
    const hold = holdShimmer(elapsed, span, at, count) * rise;
    const emphasis = holdEmphasis(elapsed, span, at, count) * rise;
    setChar(
      char,
      rise.toFixed(3),
      (hold * STAGE.shimmer).toFixed(3),
      `${(emphasis * STAGE.holdLift).toFixed(4)}em`,
      (1 + emphasis * STAGE.shimmerScale).toFixed(4),
    );
  }
}

function settleLine(node, ms) {
  if (!node) return;
  for (const char of node.querySelectorAll(".cv-live-char")) {
    setChar(char, ms >= +char.dataset.e ? "1" : "0", "0", "0em", "1");
  }
}

function settleChars(nodes, ms, active) {
  for (const [index, node] of nodes) {
    if (index !== active) settleLine(node, ms);
  }
}

function writeStyle(node, cache, name, value) {
  if (cache[name] === value) return;
  cache[name] = value;
  node.style[name] = value;
}

function activeLineAt(lines, ms) {
  let found = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].start == null) continue;
    if (lines[i].start <= ms) found = i;
    else break;
  }
  return found;
}

const LiveLine = memo(function LiveLine({ index, words, tappable, register, onTap }) {
  return (
    <p
      ref={(el) => register(index, el)}
      className={`cv-live-line${tappable ? " is-tappable" : ""}`}
      data-active="false"
      onClick={tappable ? () => onTap(index) : undefined}
    >
      {words.map((word, w) => {
        const glyphs = [...word.text];
        return (
          <span key={w} className="cv-live-word">
            {glyphs.map((glyph, at) => (
              <span
                key={at}
                className="cv-live-char"
                data-s={word.start}
                data-e={word.end}
                data-i={at}
                data-n={glyphs.length}
                style={{ "--spin-dir": (index * 7 + w * 3 + at) % 2 ? 1 : -1 }}
              >
                {glyph}
              </span>
            ))}
          </span>
        );
      })}
    </p>
  );
});

const HIDE_BEYOND = 6;

function StageLyrics({ lines, clock, onCalibrate }) {
  const [ready, setReady] = useState(false);
  const rows = useMemo(() => lines.map((line) => ({ line, words: spokenWords(line) })), [lines]);
  const startsRef = useRef([]);
  const firstTimedRef = useRef(0);
  const onCalibrateRef = useRef(onCalibrate);
  const lastCentreRef = useRef(Number.NaN);
  const lastKeyRef = useRef("");
  const layoutDirtyRef = useRef(true);

  const nodesRef = useRef(new Map());
  const layoutRef = useRef([]);
  const frameRef = useRef(null);
  const lastLineRef = useRef(-2);
  const lastMsRef = useRef(clock.current.ms);
  const lastAnimatedRef = useRef(Number.NaN);
  const lastTimeRef = useRef(0);
  const activeCharsRef = useRef([]);
  const reducedRef = useRef(false);
  const rootRef = useRef(null);
  const styleCacheRef = useRef(new WeakMap());
  const [position] = useState(() => new SpringValue(makeSpec(STAGE.stiffness, SCROLL_DAMPING), 0));

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      reducedRef.current = query.matches;
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    onCalibrateRef.current = onCalibrate;
  }, [onCalibrate]);

  const register = useCallback((index, el) => {
    if (el) nodesRef.current.set(index, el);
    else nodesRef.current.delete(index);
  }, []);

  const onTap = useCallback((index) => onCalibrateRef.current?.(index), []);

  const measure = useCallback(() => {
    layoutDirtyRef.current = true;
    layoutRef.current = rows.map((_, i) => {
      const node = nodesRef.current.get(i);
      if (!node) return null;
      return { height: node.offsetHeight, fontSize: parseFloat(getComputedStyle(node).fontSize) };
    });
  }, [rows]);

  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    for (const node of nodesRef.current.values()) if (node) observer.observe(node);
    return () => observer.disconnect();
  }, [measure]);

  useEffect(() => {
    let alive = true;
    (document.fonts?.ready ?? Promise.resolve()).then(() => {
      if (!alive) return;
      measure();
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [measure]);

  const collectActive = useCallback((index) => {
    const node = nodesRef.current.get(index);
    activeCharsRef.current = node ? Array.from(node.querySelectorAll(".cv-live-char")) : [];
  }, []);

  const frame = useCallback(() => {
    const reduced = reducedRef.current;
    const now = performance.now();
    const delta = lastTimeRef.current ? Math.min(0.1, (now - lastTimeRef.current) / 1000) : 0.016;
    lastTimeRef.current = now;

    const { ms: clockMs, at, playing } = clock.current;
    const ms = playing ? clockMs + (now - at) : clockMs;
    const seeked = Math.abs(ms - lastMsRef.current) > SEEK_MS;
    lastMsRef.current = ms;

    const lineIndex = activeLineAt(startsRef.current, ms);
    if (lineIndex !== lastLineRef.current) {
      const previous = lastLineRef.current;
      lastLineRef.current = lineIndex;
      const previousNode = nodesRef.current.get(previous);
      const nextNode = nodesRef.current.get(lineIndex);
      if (previousNode) previousNode.dataset.active = "false";
      if (nextNode) nextNode.dataset.active = "true";
      for (const [index, node] of nodesRef.current) {
        node.dataset.state = index < lineIndex ? "past" : index === lineIndex ? "current" : "upcoming";
      }
      const next = lineIndex < 0 ? Math.max(0, firstTimedRef.current) : lineIndex;
      const leap = previous < 0 ? Infinity : Math.abs(next - previous);
      if (reduced || leap > 4) position.jump(next);
      else position.retarget(next);
      collectActive(lineIndex);
      if (seeked || leap > 1) settleChars(nodesRef.current, ms, lineIndex);
      else settleLine(previousNode, ms);
    } else if (seeked) {
      settleChars(nodesRef.current, ms, lineIndex);
    }

    if (ms !== lastAnimatedRef.current) {
      lastAnimatedRef.current = ms;
      animateChars(activeCharsRef.current, ms, reduced);
    }

    const centre = position.advance(delta);
    const layout = layoutRef.current;
    if (!layout.length) return;

    const key = `${STAGE.revealTilt}|${STAGE.revealDepth}|${STAGE.revealSpin}|${STAGE.revealPop}|${STAGE.lineGap}|${STAGE.focusWidth}|${STAGE.restScale}|${STAGE.restOpacity}|${STAGE.blur}|${STAGE.riseEm}|${STAGE.tracking}|${STAGE.lineDepth}|${reduced}`;
    if (!layoutDirtyRef.current && centre === lastCentreRef.current && key === lastKeyRef.current) return;
    layoutDirtyRef.current = false;
    lastCentreRef.current = centre;
    lastKeyRef.current = key;

    const scales = layout.map((entry, i) =>
      entry ? 1 - STAGE.restScale * (1 - falloff(i - centre, STAGE.focusWidth)) : 1,
    );
    const mids = [];
    let cursor = 0;
    layout.forEach((entry, i) => {
      if (!entry) {
        mids.push(cursor);
        return;
      }
      const height = entry.height * scales[i];
      mids.push(cursor + height / 2);
      const nextScale = scales[i + 1] ?? scales[i];
      cursor += height + entry.fontSize * STAGE.lineGap * ((scales[i] + nextScale) / 2);
    });

    const clamped = clamp(centre, 0, layout.length - 1);
    const low = Math.min(layout.length - 2, Math.floor(clamped));
    const lowMid = mids[Math.max(0, low)];
    const highMid = mids[Math.max(0, low) + 1] ?? lowMid;
    const anchorMid = lowMid + (highMid - lowMid) * clamp(clamped - Math.max(0, low), 0, 1);

    const root = rootRef.current;
    const staticKey = `${STAGE.riseEm}|${STAGE.tracking}|${STAGE.revealTilt}|${STAGE.revealDepth}|${STAGE.revealSpin}|${STAGE.revealPop}|${reduced}`;
    if (root && root.dataset.staticKey !== staticKey) {
      root.dataset.staticKey = staticKey;
      root.style.setProperty("--rise", `${STAGE.riseEm}em`);
      root.style.setProperty("--live-tracking", `${STAGE.tracking}em`);
      root.style.setProperty("--char-tilt", `${reduced ? 0 : STAGE.revealTilt}deg`);
      root.style.setProperty("--char-depth", `${reduced ? 0 : STAGE.revealDepth}px`);
      root.style.setProperty("--char-spin", `${reduced ? 0 : STAGE.revealSpin}deg`);
      root.style.setProperty("--char-pop", `${reduced ? 0 : STAGE.revealPop}px`);
    }

    for (const [index, node] of nodesRef.current) {
      if (!layout[index]) continue;
      const cache = styleCacheRef.current.get(node) || {};
      styleCacheRef.current.set(node, cache);
      const distance = index - centre;
      const hidden = Math.abs(distance) > HIDE_BEYOND;
      writeStyle(node, cache, "visibility", hidden ? "hidden" : "visible");
      if (hidden) continue;
      const weight = falloff(distance, STAGE.focusWidth);
      const y = (mids[index] - anchorMid).toFixed(1);
      const depth = reduced ? 0 : (-(1 - weight) * STAGE.lineDepth).toFixed(1);
      const tilt = reduced ? 0 : (clamp(distance, -1, 1) * (1 - weight) * 4).toFixed(2);
      const blur = (1 - weight) * STAGE.blur;
      writeStyle(
        node,
        cache,
        "transform",
        `perspective(1200px) translate3d(0, ${y}px, ${depth}px) rotateX(${tilt}deg) scale(${scales[index].toFixed(4)})`,
      );
      writeStyle(node, cache, "filter", reduced || blur < 0.05 ? "none" : `blur(${blur.toFixed(2)}px)`);
      writeStyle(node, cache, "opacity", clamp(STAGE.restOpacity + (1 - STAGE.restOpacity) * weight, 0, 1).toFixed(3));
    }
  }, [position, collectActive, clock]);

  useLayoutEffect(() => {
    frameRef.current = frame;
    startsRef.current = rows.map((row) => row.line);
    firstTimedRef.current = rows.findIndex((row) => row.line.start != null);
  }, [frame, rows]);

  useEffect(() => {
    lastLineRef.current = -2;
    frameRef.current();
  }, [rows, ready]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      frameRef.current();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      ref={rootRef}
      className="cv-live"
      style={{ "--shimmer-brightness": STAGE.shimmerBrightness }}
    >
      <div className="cv-live-track" data-ready={ready ? "true" : "false"}>
        {rows.map(({ words }, i) => (
          <LiveLine
            key={i}
            index={i}
            words={words}
            tappable={!!onCalibrate}
            register={register}
            onTap={onTap}
          />
        ))}
      </div>
    </div>
  );
}

export default memo(StageLyrics);
