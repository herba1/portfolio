"use client";

import { useCallback, useRef } from "react";
import { addAnchor, setLook, spinBy } from "./stage";

const clamp = (v) => Math.max(-1, Math.min(1, v));

/**
 * A place for a splat: an empty, sized box the stage moves an actor into.
 *
 *   <SplatAnchor actor="cat" slot="card" weight={0} interactive className="…" />
 *
 * `actor` names the splat; anchors on different pages with the same actor are
 * how one live splat flies between routes. `slot` names this anchor so page
 * code can blend an actor between two of them every frame with
 * setWeight(actor, slot, w) — no re-render. `weight` is the starting weight.
 *
 * The anchor registers from its ref callback, which runs in the commit: on a
 * route change the old page's anchors drop and the new page's register in
 * the same commit, so the stage sees one jump and flies the actor — never a
 * frame with no anchor, which would read as an exit.
 *
 * `interactive` adds pointer look and drag-to-spin. A drag that travels more
 * than a few pixels swallows the click that follows, so spinning a card's
 * splat never opens its article. Give interactive anchors
 * `touch-action: pan-y` so vertical scrolling stays native on phones while a
 * sideways drag spins.
 */
export default function SplatAnchor({ actor, slot = "default", weight = 1, fit = 1, interactive = false, ...rest }) {
  const drag = useRef(null);
  const initialWeight = useRef(weight);

  const ref = useCallback(
    (el) => {
      if (!el) return undefined;
      const anchor = addAnchor(actor, el, { slot, weight: initialWeight.current, fit });
      return () => anchor.remove();
    },
    [actor, slot, fit],
  );

  if (!interactive) return <div ref={ref} {...rest} />;

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    drag.current = { x: event.clientX, t: event.timeStamp, travel: 0, id: event.pointerId };
  };

  const onPointerMove = (event) => {
    const d = drag.current;
    if (d && d.id === event.pointerId && event.buttons) {
      const dx = event.clientX - d.x;
      d.travel += Math.abs(dx);
      if (d.travel > 6 && !event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      spinBy(actor, dx, (event.timeStamp - d.t) / 1000);
      d.x = event.clientX;
      d.t = event.timeStamp;
    }
    if (event.pointerType !== "mouse") return;
    const rect = event.currentTarget.getBoundingClientRect();
    setLook(actor, {
      x: clamp(((event.clientX - rect.left) / rect.width) * 2 - 1),
      y: clamp(((event.clientY - rect.top) / rect.height) * 2 - 1),
    });
  };

  const onPointerUp = (event) => {
    if (drag.current?.travel > 6) {
      const swallow = (click) => {
        click.preventDefault();
        click.stopPropagation();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    }
    drag.current = null;
    if (event.pointerType !== "mouse") setLook(actor, null);
  };

  const release = () => {
    drag.current = null;
    setLook(actor, null);
  };

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={release}
      onPointerLeave={release}
      {...rest}
    />
  );
}
