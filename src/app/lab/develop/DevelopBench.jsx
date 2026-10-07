"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";

import { warmSource } from "./developSources";

const PROXIMITY_RANGE_PX = 96;

function useProximity(listRef) {
  useEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    let raf = 0;
    let pointerX = 0;
    let pointerY = 0;
    let inside = false;

    const paint = () => {
      raf = 0;
      const items = list.querySelectorAll("[data-near-item]");
      const rects = [];
      for (const item of items) rects.push(item.getBoundingClientRect());
      items.forEach((item, index) => {
        const rect = rects[index];
        const distance = Math.hypot(rect.left + rect.width / 2 - pointerX, rect.top + rect.height / 2 - pointerY);
        const near = inside ? Math.max(0, 1 - distance / PROXIMITY_RANGE_PX) : 0;
        item.style.setProperty("--near", (near * near * (3 - 2 * near)).toFixed(3));
      });
    };

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };

    const handleMove = (event) => {
      if (!fine.matches) return;
      pointerX = event.clientX;
      pointerY = event.clientY;
      inside = true;
      schedule();
    };

    const handleLeave = () => {
      inside = false;
      schedule();
    };

    list.addEventListener("pointermove", handleMove);
    list.addEventListener("pointerleave", handleLeave);
    list.addEventListener("scroll", schedule, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      list.removeEventListener("pointermove", handleMove);
      list.removeEventListener("pointerleave", handleLeave);
      list.removeEventListener("scroll", schedule);
    };
  }, [listRef]);
}

export function NegativeStrip({ sources, activeId, onPick }) {
  const listRef = useRef(null);
  useProximity(listRef);

  return (
    <ul ref={listRef} className="develop-negatives" aria-label="Negatives">
      {sources.map((source) => (
        <li key={source.id} className="develop-negatives__item">
          <button
            type="button"
            className="develop-negative"
            data-near-item=""
            data-active={source.id === activeId ? "true" : undefined}
            aria-pressed={source.id === activeId}
            aria-label={`Print ${source.label}`}
            title={source.label}
            onPointerEnter={() => warmSource(source)}
            onFocus={() => warmSource(source)}
            onClick={() => onPick(source.id)}
          >
            <Image
              src={source.src}
              alt=""
              fill
              sizes="40px"
              loading="lazy"
              draggable={false}
              className="develop-negative__image"
              style={{ objectPosition: `50% ${Math.round((source.focusY ?? 0.5) * 100)}%` }}
            />
          </button>
        </li>
      ))}
    </ul>
  );
}

function lineStep(list, across) {
  const first = list.firstElementChild;
  const second = first?.nextElementSibling;
  if (!first || !second) return 0;
  return across ? second.offsetLeft - first.offsetLeft : second.offsetTop - first.offsetTop;
}

export function PrintLine({ prints, onSave }) {
  const listRef = useRef(null);
  const countRef = useRef(prints.length);
  const [liftedId, setLiftedId] = useState(null);
  useProximity(listRef);

  useLayoutEffect(() => {
    const list = listRef.current;
    const previous = countRef.current;
    countRef.current = prints.length;
    if (!list || prints.length <= previous || previous === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const across = window.getComputedStyle(list).flexDirection === "row";
    const step = lineStep(list, across);
    if (!step) return;
    const shift = across ? `translateX(${-step}px)` : `translateY(${-step}px)`;
    list.animate([{ transform: shift }, { transform: "none" }], {
      duration: 420,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
    });
  }, [prints.length]);

  const handleKeyDown = (event) => {
    if (event.key === "Escape") setLiftedId(null);
  };

  return (
    <ol ref={listRef} className="develop-line" aria-label="Prints from this session" onKeyDown={handleKeyDown}>
      {prints.map((print) => {
        const lifted = print.id === liftedId;
        return (
          <li key={print.id} className="develop-line__item">
            <button
              type="button"
              className="develop-print"
              data-near-item=""
              data-lifted={lifted ? "true" : undefined}
              aria-pressed={lifted}
              aria-label={lifted ? `Save print of ${print.label}` : `Lift print of ${print.label}, developed ${print.time}`}
              title={lifted ? `Save ${print.label}` : `${print.label}, ${print.time}`}
              onClick={() => (lifted ? onSave(print) : setLiftedId(print.id))}
              onBlur={(event) => {
                if (!listRef.current?.contains(event.relatedTarget)) setLiftedId(null);
              }}
              style={{ "--print-image": `url("${print.thumb}")` }}
            />
          </li>
        );
      })}
    </ol>
  );
}
