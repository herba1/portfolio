"use client";

import { useEffect, useRef } from "react";

const COUNT = 6;
const CARD_RATIO = 0.15;
const GAP_RATIO = 2.1;
const TILT_REST_DEG = -22;
const TILT_RANGE_DEG = 8;
const DRIFT_DEG = 0.1;
const FRICTION = 0.94;
const DRAG_DEG_PER_PX = 0.5;
const FACE_CAMERA = 0.8;
const GRID = 8;
const TURN_FREE_DEG = 105;
const TURN_END_DEG = 180;

function smoothstep(from, to, value) {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

export default function CoverRing({ items }) {
  const stageRef = useRef(null);
  const worldRef = useRef(null);
  const nodes = useRef([]);
  const covers = items.slice(0, COUNT);
  const step = 360 / covers.length;

  useEffect(() => {
    const stage = stageRef.current;
    const world = worldRef.current;
    const state = { angle: 0, velocity: DRIFT_DEG, dragging: false, lastX: 0, tilt: TILT_REST_DEG, tiltTarget: TILT_REST_DEG, visible: false, frame: 0, radius: 0 };

    const measure = () => {
      const card = stage.clientWidth * CARD_RATIO;
      state.radius = (card * GAP_RATIO) / (2 * Math.sin(Math.PI / covers.length));
      stage.style.setProperty("--cs-card", `${card}px`);
      stage.style.setProperty("--cs-radius", `${state.radius}px`);
    };

    const apply = () => {
      world.style.transform = `translateZ(${-state.radius}px) rotateX(${state.tilt.toFixed(2)}deg)`;
      nodes.current.forEach((node, index) => {
        if (!node) return;
        const total = index * step + state.angle;
        const wrapped = ((((total + 180) % 360) + 360) % 360) - 180;
        const away = Math.abs(wrapped);
        const hold = 1 - smoothstep(TURN_FREE_DEG, TURN_END_DEG, away);
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
      const ratio = (event.clientY - rect.top) / rect.height;
      state.tiltTarget = TILT_REST_DEG + (0.5 - ratio) * TILT_RANGE_DEG * 2;
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
  }, [covers.length]);

  return (
    <div ref={stageRef} className="cs-ring">
      <div ref={worldRef} className="cs-ring__world">
        {covers.map((cover, index) => (
          <div
            key={cover.id}
            ref={(node) => {
              nodes.current[index] = node;
            }}
            className="cs-board cs-ring__card"
            style={{ "--cs-edge": cover.edge || undefined }}
          >
            <img className="cs-board__art" src={cover.image} alt={`${cover.title} by ${cover.artist}`} draggable={false} />
            <span className="cs-board__back cs-ring__back" style={{ background: cover.palette[2] ?? "rgb(40 40 44)" }}>
              <svg viewBox={`0 0 ${GRID} ${GRID}`} preserveAspectRatio="none" aria-hidden="true">
                {cover.pattern.map((cell, at) => (
                  <circle key={at} cx={(at % GRID) + 0.5} cy={Math.floor(at / GRID) + 0.5} r={0.14 + 0.36 * (1 - cell.light)} fill={cell.colour} />
                ))}
              </svg>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
