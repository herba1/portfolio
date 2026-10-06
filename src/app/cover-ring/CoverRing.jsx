"use client";

import { useEffect, useMemo, useRef } from "react";

import useCovers from "@/app/ui/useCovers";
import "./cover-ring.css";

const COUNT = 6;
const CARD_RATIO = 0.21;
const GAP_RATIO = 2.1;
const TILT_REST_DEG = -22;
const TILT_RANGE_DEG = 8;
const DRIFT_DEG = 0.1;
const FRICTION = 0.94;
const DRAG_DEG_PER_PX = 0.5;
const FACE_CAMERA = 0.8;
const TURN_FREE_DEG = 105;
const TURN_END_DEG = 180;
const GRID = 8;
const WIDE_ASPECT = 1.3;

function smoothstep(from, to, value) {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

function meshFor(cover) {
  const cell = (column, row) => cover.pattern[row * GRID + column]?.colour ?? "rgb(60 60 66)";
  const corners = [
    [cell(1, 1), "18% 18%"],
    [cell(6, 1), "82% 18%"],
    [cell(1, 6), "18% 82%"],
    [cell(6, 6), "82% 82%"],
    [cell(3, 4), "50% 55%"],
  ];
  const layers = corners.map(([colour, at]) => `radial-gradient(circle at ${at}, ${colour} 0%, transparent 72%)`);
  return `${layers.join(", ")}, ${cell(4, 4)}`;
}

export default function CoverRing({ covers = [], embedded = false }) {
  const stageRef = useRef(null);
  const worldRef = useRef(null);
  const nodes = useRef([]);
  const items = useCovers(covers).slice(0, COUNT);
  const step = items.length ? 360 / items.length : 60;
  const meshes = useMemo(() => items.map(meshFor), [items]);

  useEffect(() => {
    if (!items.length) return undefined;
    const stage = stageRef.current;
    const world = worldRef.current;
    const state = { angle: 0, velocity: DRIFT_DEG, dragging: false, lastX: 0, tilt: TILT_REST_DEG, tiltTarget: TILT_REST_DEG, visible: false, frame: 0, radius: 0 };

    const measure = () => {
      const basis = Math.min(stage.clientWidth, stage.clientHeight * WIDE_ASPECT);
      const card = basis * CARD_RATIO;
      state.radius = (card * GAP_RATIO) / (2 * Math.sin(Math.PI / items.length));
      stage.style.setProperty("--cr-card", `${card}px`);
    };

    const apply = () => {
      world.style.transform = `translateZ(${-state.radius}px) rotateX(${state.tilt.toFixed(2)}deg)`;
      nodes.current.forEach((node, index) => {
        if (!node) return;
        const total = index * step + state.angle;
        const wrapped = ((((total + 180) % 360) + 360) % 360) - 180;
        const hold = 1 - smoothstep(TURN_FREE_DEG, TURN_END_DEG, Math.abs(wrapped));
        node.style.transform = `rotateY(${total.toFixed(2)}deg) translateZ(${state.radius.toFixed(2)}px) rotateY(${(-wrapped * FACE_CAMERA * hold).toFixed(2)}deg)`;
      });
    };

    const loop = () => {
      if (!state.dragging) {
        state.angle += state.velocity;
        state.velocity *= FRICTION;
        if (Math.abs(state.velocity) < DRIFT_DEG) state.velocity = DRIFT_DEG * Math.sign(state.velocity || 1);
      }
      state.tilt += (state.tiltTarget - state.tilt) * 0.1;
      apply();
      state.frame = state.visible ? requestAnimationFrame(loop) : 0;
    };

    const onDown = (event) => {
      state.dragging = true;
      state.lastX = event.clientX;
      state.velocity = 0;
      stage.setPointerCapture(event.pointerId);
    };
    const onMove = (event) => {
      const rect = stage.getBoundingClientRect();
      state.tiltTarget = TILT_REST_DEG + (0.5 - (event.clientY - rect.top) / rect.height) * TILT_RANGE_DEG * 2;
      if (!state.dragging) return;
      const delta = event.clientX - state.lastX;
      state.lastX = event.clientX;
      state.angle += delta * DRAG_DEG_PER_PX;
      state.velocity = delta * DRAG_DEG_PER_PX;
    };
    const onUp = () => {
      state.dragging = false;
    };
    const onLeave = () => {
      state.tiltTarget = TILT_REST_DEG;
    };

    measure();
    apply();
    const resizeObserver = new ResizeObserver(() => {
      measure();
      apply();
    });
    resizeObserver.observe(stage);
    const visibility = new IntersectionObserver(([entry]) => {
      state.visible = entry.isIntersecting;
      if (state.visible && !state.frame) state.frame = requestAnimationFrame(loop);
    });
    visibility.observe(stage);
    stage.addEventListener("pointerdown", onDown);
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerup", onUp);
    stage.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(state.frame);
      visibility.disconnect();
      resizeObserver.disconnect();
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointerleave", onLeave);
    };
  }, [items, step]);

  const Root = embedded ? "div" : "main";

  return (
    <Root ref={stageRef} className="cr" data-embedded={embedded || undefined}>
      <div ref={worldRef} className="cr__world">
        {items.map((cover, index) => (
          <div
            key={cover.id}
            ref={(node) => {
              nodes.current[index] = node;
            }}
            className="cr__card"
            style={{ "--cr-edge": cover.edge || undefined }}
          >
            <img className="cr__art" src={cover.image} alt={`${cover.title} by ${cover.artist}`} draggable={false} />
            <span className="cr__back" style={{ background: meshes[index] }} />
          </div>
        ))}
      </div>
    </Root>
  );
}
