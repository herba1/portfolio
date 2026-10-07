"use client";

import { useEffect, useRef, useState } from "react";

import { createTaffyEngine } from "./taffyEngine";

const ARROWS = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

const PAGE_DPR_CAP = 2;
const EMBEDDED_DPR_CAP = 1.5;

const idle = (callback) => {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(callback, { timeout: 1600 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(callback, 400);
  return () => window.clearTimeout(handle);
};

export default function TaffyScene({
  titles,
  index,
  params,
  reducedMotion,
  embedded = false,
  revealed = false,
  onAdvance,
  onReady,
  onLayout,
  onSettled,
  onTitleShown,
  onUnsupported,
}) {
  const hostRef = useRef(null);
  const engineRef = useRef(null);
  const callbacksRef = useRef({});
  const [layout, setLayout] = useState(null);

  useEffect(() => {
    callbacksRef.current = { onAdvance, onReady, onLayout, onSettled, onTitleShown, onUnsupported };
  }, [onAdvance, onReady, onLayout, onSettled, onTitleShown, onUnsupported]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const canvas = document.createElement("canvas");
    canvas.className = "taffy-stage__canvas";
    canvas.setAttribute("aria-hidden", "true");
    host.prepend(canvas);
    let engine = null;
    try {
      engine = createTaffyEngine({
        host,
        canvas,
        family: getComputedStyle(host).fontFamily,
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        dprCap: embedded ? EMBEDDED_DPR_CAP : PAGE_DPR_CAP,
        onLayout: (summary) => {
          setLayout(summary);
          callbacksRef.current.onLayout?.(summary);
        },
        onReady: () => callbacksRef.current.onReady?.(),
        onSettled: () => callbacksRef.current.onSettled?.(),
        onTitleShown: (text) => callbacksRef.current.onTitleShown?.(text),
        onPaperTap: () => callbacksRef.current.onAdvance?.(1),
      });
    } catch (error) {
      console.error(error);
      engine = null;
    }
    if (!engine) {
      canvas.remove();
      Promise.resolve().then(() => callbacksRef.current.onUnsupported?.());
      return undefined;
    }
    engineRef.current = engine;
    return () => {
      engineRef.current = null;
      engine.dispose();
      canvas.remove();
    };
  }, [embedded]);

  useEffect(() => {
    engineRef.current?.setParams(params);
  }, [params]);

  useEffect(() => {
    engineRef.current?.setReducedMotion(reducedMotion);
  }, [reducedMotion]);

  useEffect(() => {
    if (revealed) engineRef.current?.playIntro();
  }, [revealed]);

  useEffect(() => {
    const engine = engineRef.current;
    const entry = titles[index];
    if (!engine || !entry) return undefined;
    engine.show(entry.title).catch((error) => console.error(error));
    const following = titles[(index + 1) % titles.length];
    const preceding = titles[(index - 1 + titles.length) % titles.length];
    let cancelPreceding = null;
    const cancelFollowing = idle(() => {
      if (following && following !== entry) engineRef.current?.prefetch(following.title);
      if (!preceding || preceding === entry || preceding === following) return;
      cancelPreceding = idle(() => engineRef.current?.prefetch(preceding.title));
    });
    return () => {
      cancelFollowing();
      cancelPreceding?.();
    };
  }, [titles, index]);

  const handlePointerDown = (event) => {
    const engine = engineRef.current;
    if (!engine || (event.pointerType === "mouse" && event.button !== 0)) return;
    const grabbed = engine.pointerDown(event.nativeEvent);
    if (grabbed) {
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      event.currentTarget.dataset.grabbing = "true";
    }
  };

  const handlePointerUp = (event, cancelled) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.pointerUp(event.nativeEvent, cancelled);
    if (!engine.hasGrab()) delete event.currentTarget.dataset.grabbing;
  };

  const handleGlyphKey = (event, glyphIndex) => {
    const engine = engineRef.current;
    if (!engine) return;
    const arrow = ARROWS[event.key];
    if (arrow) {
      event.preventDefault();
      event.stopPropagation();
      engine.keyPull(glyphIndex, arrow[0], arrow[1], event.repeat);
      return;
    }
    if (event.key === "Enter" || event.key === "Escape" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      engine.keyRelease(glyphIndex);
    }
  };

  return (
    <div
      ref={hostRef}
      className="taffy-stage font-sans"
      data-hover="paper"
      onPointerDown={handlePointerDown}
      onPointerMove={(event) => engineRef.current?.pointerMove(event.nativeEvent)}
      onPointerUp={(event) => handlePointerUp(event, false)}
      onPointerCancel={(event) => handlePointerUp(event, true)}
      onPointerLeave={() => engineRef.current?.pointerLeave()}
    >
      {layout ? (
        <div className="taffy-stage__letters" role="group" aria-label={`${layout.text}, letters you can pull`}>
          {layout.glyphs.map((glyph, glyphIndex) => (
            <button
              key={`${layout.text}-${glyphIndex}`}
              type="button"
              className="taffy-stage__letter"
              style={{ left: glyph.left, top: glyph.top, width: glyph.width, height: glyph.height }}
              aria-label={`Pull ${glyph.char}, letter ${glyphIndex + 1} of ${layout.glyphs.length}. Arrow keys pull, Enter lets go.`}
              onFocus={() => engineRef.current?.setFocus(glyphIndex)}
              onBlur={() => {
                engineRef.current?.keyRelease(glyphIndex);
                engineRef.current?.setFocus(-1);
              }}
              onKeyDown={(event) => handleGlyphKey(event, glyphIndex)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
