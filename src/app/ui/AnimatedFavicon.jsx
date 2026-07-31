"use client";

import { useEffect } from "react";

/* ═════════════════════════════════════════════════════════════════════
 * FAVICON — a face in the tab that watches the cursor.
 *
 * The favicon is not a shipped asset here. It is a 64×64 canvas redrawn
 * on the visitor's machine and pushed into <link rel="icon"> as a data
 * URI, so it can react to things a static .png never could.
 *
 * ── Looking at the mouse ──────────────────────────────────────────────
 * The face looks at where the pointer actually is, relative to where
 * the icon actually is. Both in screen coordinates, one vector, no
 * per-axis fudging.
 *
 * Finding the icon starts with `screenX - clientX` on any pointer
 * event: the screen position of the viewport's top-left corner, and the
 * one measurement that ties page space to screen space. Against the
 * window's own origin and outer size it gives true chrome thickness on
 * all four sides, so the tab strip is simply the thickest side — left,
 * right, top or bottom, no browser special-cased. Across the strip the
 * icon is at its midpoint, which is exact. Along the strip it depends
 * on tab count and which tab is ours, neither exposed to script, so
 * that one axis is an estimate.
 *
 * The gaze is then the unit vector from icon to cursor, with magnitude
 * scaled by distance. Direction is preserved exactly — normalising the
 * axes separately (dx against the room to the right, dy against the
 * room below) would rescale them by different factors and produce a
 * vector pointing somewhere the cursor isn't.
 *
 * A consequence worth stating: an icon in a strip at the screen's edge
 * really does have the cursor off to one side almost all the time, so
 * the eyes sit deflected that way rather than resting centred. That is
 * the honest answer, not a bug — the face is at the edge, not in the
 * middle of the screen.
 *
 * ── Leaving the window ────────────────────────────────────────────────
 * `pointermove` stops firing the instant the cursor crosses out of the
 * content area, which would otherwise freeze the gaze mid-glance. The
 * `pointerout` that fires on the way out still carries coordinates, so
 * we aim at those: the last position the cursor was genuinely known to
 * occupy. It has gone into the browser chrome, not away.
 *
 * ── Cost ──────────────────────────────────────────────────────────────
 * Re-encoding a PNG on every mousemove would be wasteful, so the loop
 * has the same shape as the hero's eye tracker: a damped spring, a rAF
 * that stops itself once everything settles, and a floor on how often a
 * new data URI may be minted. A still mouse costs nothing.
 * ═══════════════════════════════════════════════════════════════════ */

const SIZE = 64;
const INK = "#0b0b0c";
const SKIN = "#f1f5f9";
const WHITE = "#ffffff";
const TONGUE = "#e8657f";

/** Distance (screen px) at which the gaze reaches full deflection.
 *  Inside it the pupil eases back toward centre, so a cursor resting on
 *  the icon is looked at rather than looked past. */
const FALLOFF = 380;

/** Chrome thinner than this is a scrollbar or a window border, not a
 *  strip with icons in it. */
const MIN_STRIP = 24;

/** In a horizontal strip, how far in from the window's left edge the
 *  icon sits. Depends on tab count, so it is only ever an estimate. */
const STRIP_INSET = 58;

/** In a vertical strip, how far down. Same caveat. */
const STRIP_DOWN = 0.45;

function clamp1(v) {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/** Spring — matched to the hero eyes so the two read as one character. */
const STIFFNESS = 170;
const DAMPING = 22;
const EPSILON = 0.002;
const MAX_DT = 1 / 30;

/** Never mint a new data URI more often than this. */
const MIN_FRAME_MS = 55;

/** No pointer input for this long and the face falls asleep. */
const SLEEP_AFTER = 15000;

/* Expressions. `weight` is relative frequency — mostly blinks, rarely a
 * tongue, so the tab stays calm in peripheral vision. */
const STIMS = [
  { name: "blink", ms: 200, weight: 46 },
  { name: "double-blink", ms: 420, weight: 12 },
  { name: "wink", ms: 520, weight: 14 },
  { name: "laugh", ms: 1500, weight: 13 },
  { name: "tongue", ms: 1400, weight: 12 },
  { name: "wide", ms: 700, weight: 8 },
];
const STIM_TOTAL = STIMS.reduce((n, s) => n + s.weight, 0);

function pickStim() {
  let r = Math.random() * STIM_TOTAL;
  for (const s of STIMS) {
    r -= s.weight;
    if (r <= 0) return s;
  }
  return STIMS[0];
}

/* ── Drawing ─────────────────────────────────────────────────────────
 * Authored at 64×64 but has to survive resampling to 16×16 in a tab
 * strip: few shapes, fat strokes, high contrast. Anything thinner than
 * ~3px here dissolves into grey at display size. */

function drawEye(ctx, x, y, gx, gy, open, happy) {
  // A closed eye is a stroke, not a squashed ellipse — below about a
  // pixel of height a fill and its outline alias into a grey smear.
  if (open < 0.14) {
    ctx.beginPath();
    ctx.lineWidth = 3.4;
    ctx.strokeStyle = INK;
    ctx.lineCap = "round";
    // Sleeping curves down, laughing curves up. Same arc, flipped.
    if (happy) ctx.arc(x, y + 3, 7, Math.PI * 1.15, Math.PI * 1.85);
    else ctx.arc(x, y - 3, 7, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
    return;
  }

  const ry = 9 * open;

  ctx.beginPath();
  ctx.ellipse(x, y, 7.6, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = WHITE;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = INK;
  ctx.stroke();

  // Clip to the socket so a hard-over pupil is occluded by the lid
  // rather than sliding out through the outline.
  ctx.save();
  ctx.clip();
  ctx.beginPath();
  ctx.arc(x + gx * 3.4, y + gy * Math.min(3.4, ry * 0.55), 4.1, 0, Math.PI * 2);
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.restore();
}

function drawMouth(ctx, cx, cy, mouth, gx) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;

  if (mouth === "laugh") {
    ctx.beginPath();
    ctx.arc(cx, cy + 4, 11, 0.12 * Math.PI, 0.88 * Math.PI);
    ctx.closePath();
    ctx.fill();
    return;
  }

  if (mouth === "tongue") {
    ctx.beginPath();
    ctx.arc(cx, cy + 2, 10, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.lineWidth = 3.4;
    ctx.stroke();
    // The tongue lolls toward whatever the eyes are tracking.
    ctx.beginPath();
    ctx.ellipse(cx + gx * 3, cy + 13, 5.2, 4.4, 0, 0, Math.PI * 2);
    ctx.fillStyle = TONGUE;
    ctx.fill();
    ctx.lineWidth = 2.4;
    ctx.stroke();
    return;
  }

  if (mouth === "sleep") {
    ctx.beginPath();
    ctx.arc(cx, cy + 6, 3.6, 0, Math.PI * 2);
    ctx.lineWidth = 2.8;
    ctx.stroke();
    return;
  }

  if (mouth === "o") {
    ctx.beginPath();
    ctx.ellipse(cx, cy + 5, 5, 6, 0, 0, Math.PI * 2);
    ctx.lineWidth = 3.2;
    ctx.stroke();
    return;
  }

  ctx.beginPath();
  ctx.arc(cx, cy + 1, 10, 0.17 * Math.PI, 0.83 * Math.PI);
  ctx.lineWidth = 3.4;
  ctx.stroke();
}

function drawFace(ctx, s) {
  const c = SIZE / 2;
  ctx.clearRect(0, 0, SIZE, SIZE);

  ctx.beginPath();
  ctx.arc(c, c, 28.5, 0, Math.PI * 2);
  ctx.fillStyle = SKIN;
  ctx.fill();
  ctx.lineWidth = 4.2;
  ctx.strokeStyle = INK;
  ctx.stroke();

  const eyeY = c - 6;
  drawEye(ctx, c - 12, eyeY, s.gx, s.gy, s.openL, s.happyEyes);
  drawEye(ctx, c + 12, eyeY, s.gx, s.gy, s.openR, s.happyEyes);
  drawMouth(ctx, c, c + 8, s.mouth, s.gx);
}

const NEUTRAL = {
  gx: 0, gy: 0, openL: 1, openR: 1, mouth: "smile", happyEyes: false,
};

export default function AnimatedFavicon() {
  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/png";

    // favicon.ico lives in public/, not app/, precisely so Next emits
    // no icon <link> of its own — a static .ico link outranks a data
    // PNG, and deleting React-owned head tags to get rid of it corrupts
    // React 19's head bookkeeping and crashes the next soft navigation
    // (removeChild on a node React thinks is still there → dead router
    // until a hard refresh). Linkless browsers fall back to requesting
    // /favicon.ico by convention, so no-JS visitors and crawlers still
    // get an icon. Ours only has to exist and stay last; never touch
    // foreign links. Converges immediately — re-appending our own node
    // triggers the observer once, finds ours already last, and stops.
    function claim() {
      const icons = document.querySelectorAll('link[rel~="icon"]');
      if (icons[icons.length - 1] !== link) document.head.appendChild(link);
    }

    claim();
    const headObserver = new MutationObserver(claim);
    headObserver.observe(document.head, { childList: true });

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    /* ── State ── */
    const spring = { x: 0, y: 0, vx: 0, vy: 0 };
    let targetX = 0;
    let targetY = 0;
    let pointerLive = false;
    let lastMove = performance.now();

    let stim = null;
    let stimUntil = 0;
    let stimTimer = 0;

    let rafId = 0;
    let lastTime = 0;
    let lastPaint = 0;
    let painted = { gx: NaN, gy: NaN, key: "" };

    function paint(s) {
      drawFace(ctx, s);
      link.href = canvas.toDataURL("image/png");
    }

    /**
     * Locate the icon on screen, whichever edge the browser keeps its
     * tabs on.
     *
     * `screenX - clientX` is the screen position of the viewport's
     * top-left corner — the one measurement that ties page coordinates
     * to screen coordinates. Against the window's own origin and outer
     * size it yields the true chrome thickness on all four sides, so
     * there is nothing to hard-code and nothing to assume about which
     * browser this is. The thickest side is the tab strip.
     */
    function locate(screenX, screenY, clientX, clientY) {
      const vpX = screenX - clientX;
      const vpY = screenY - clientY;
      const winX = window.screenX;
      const winY = window.screenY;
      const iw = window.innerWidth;
      const ih = window.innerHeight;

      const pad = {
        left: vpX - winX,
        top: vpY - winY,
        right: winX + window.outerWidth - (vpX + iw),
        bottom: winY + window.outerHeight - (vpY + ih),
      };

      let side = null;
      let thickest = MIN_STRIP;
      for (const k of ["left", "right", "top", "bottom"]) {
        if (pad[k] > thickest) {
          thickest = pad[k];
          side = k;
        }
      }

      if (!side) return null;

      // Position within the strip. The across-the-strip axis is exact —
      // it is the strip's own midpoint. The along-the-strip axis
      // depends on tab count and which tab is ours, neither of which is
      // exposed, so it stays an estimate.
      if (side === "left") return { x: winX + pad.left / 2, y: vpY + ih * STRIP_DOWN, vpX, vpY, iw, ih };
      if (side === "right") return { x: vpX + iw + pad.right / 2, y: vpY + ih * STRIP_DOWN, vpX, vpY, iw, ih };
      if (side === "top") return { x: winX + STRIP_INSET, y: winY + pad.top / 2, vpX, vpY, iw, ih };
      return { x: winX + STRIP_INSET, y: vpY + ih + pad.bottom / 2, vpX, vpY, iw, ih };
    }

    /**
     * Point the gaze at the cursor's real position, relative to the
     * icon's real position. One vector, both axes, direction intact.
     */
    function aim(screenX, screenY, clientX, clientY) {
      const a = locate(screenX, screenY, clientX, clientY);

      // Nowhere to measure from — fullscreen, kiosk, a chromeless PWA.
      // The viewport centre is the only reference point left.
      if (!a) {
        const w = window.innerWidth || 1;
        const h = window.innerHeight || 1;
        targetX = clamp1((clientX / w) * 2 - 1);
        targetY = clamp1((clientY / h) * 2 - 1);
        return;
      }

      const dx = screenX - a.x;
      const dy = screenY - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.5) return;

      // Unit direction, scaled by how far away the cursor is. Both
      // components share one divisor, so the angle survives.
      const reach = Math.min(1, dist / FALLOFF);
      targetX = (dx / dist) * reach;
      targetY = (dy / dist) * reach;
    }

    function onPointerMove(ev) {
      // A finger is not a cursor. Let the face idle rather than freeze
      // it staring at wherever the last tap happened to land.
      if (ev.pointerType === "touch") {
        pointerLive = false;
        return;
      }

      aim(ev.screenX, ev.screenY, ev.clientX, ev.clientY);

      pointerLive = true;
      lastMove = performance.now();
      kick();
    }

    function onPointerOut(ev) {
      // relatedTarget is null only when the pointer leaves the window
      // entirely, not when it crosses between elements inside it.
      if (ev.relatedTarget !== null) return;

      // The event carrying the cursor out still reports where it went,
      // so keep aiming there — that is the last position the cursor was
      // genuinely known to occupy. It has moved into the browser
      // chrome, not away.
      aim(ev.screenX, ev.screenY, ev.clientX, ev.clientY);

      pointerLive = true;
      lastMove = performance.now();
      kick();
    }

    /* ── Expression scheduling ── */
    function scheduleStim() {
      clearTimeout(stimTimer);
      const delay = 2200 + Math.random() * 4200;
      stimTimer = setTimeout(() => {
        const asleep = performance.now() - lastMove > SLEEP_AFTER;
        if (!asleep && !document.hidden) {
          stim = pickStim();
          stimUntil = performance.now() + stim.ms;
        }
        // Kick either way. This timer is also what notices the face has
        // gone idle long enough to sleep — gate the kick on being awake
        // and the sleeping frame never gets painted at all.
        kick();
        scheduleStim();
      }, delay);
    }

    /* ── Per-frame expression resolution ── */
    function resolve(now) {
      const asleep = now - lastMove > SLEEP_AFTER;

      const s = { ...NEUTRAL, gx: spring.x, gy: spring.y };

      if (asleep) {
        // Deliberately a still frame. A breathing cycle would have to
        // move ~0.15px at tab size to stay subtle, which is invisible,
        // and it would keep the encoder running forever on an idle tab.
        s.openL = 0;
        s.openR = 0;
        s.gx = 0;
        s.gy = 0;
        s.mouth = "sleep";
        return s;
      }

      if (!stim || now > stimUntil) {
        stim = null;
        return s;
      }

      const t = 1 - (stimUntil - now) / stim.ms;

      switch (stim.name) {
        case "blink":
          s.openL = s.openR = Math.abs(Math.cos(t * Math.PI));
          break;
        case "double-blink":
          s.openL = s.openR = Math.abs(Math.cos(t * Math.PI * 2));
          break;
        case "wink":
          s.openL = Math.abs(Math.cos(t * Math.PI));
          break;
        case "laugh":
          s.openL = s.openR = 0;
          s.happyEyes = true;
          s.mouth = "laugh";
          break;
        case "tongue":
          s.mouth = "tongue";
          s.openL = s.openR = 0.55;
          break;
        case "wide":
          s.openL = s.openR = 1.25;
          s.mouth = "o";
          break;
      }

      return s;
    }

    /* ── Loop ── */
    function frame(now) {
      rafId = 0;

      const dt = lastTime ? Math.min((now - lastTime) / 1000, MAX_DT) : 1 / 60;
      lastTime = now;

      const tx = pointerLive ? targetX : 0;
      const ty = pointerLive ? targetY : 0;

      // Semi-implicit Euler: velocity first, then position.
      const ax = (tx - spring.x) * STIFFNESS - spring.vx * DAMPING;
      const ay = (ty - spring.y) * STIFFNESS - spring.vy * DAMPING;
      spring.vx += ax * dt;
      spring.vy += ay * dt;
      spring.x += spring.vx * dt;
      spring.y += spring.vy * dt;

      const settled =
        Math.abs(tx - spring.x) < EPSILON &&
        Math.abs(ty - spring.y) < EPSILON &&
        Math.abs(spring.vx) < EPSILON * 60 &&
        Math.abs(spring.vy) < EPSILON * 60;

      if (settled) {
        spring.x = tx;
        spring.y = ty;
        spring.vx = 0;
        spring.vy = 0;
      }

      const s = resolve(now);
      const key = `${stim?.name ?? ""}|${s.openL.toFixed(2)}|${s.openR.toFixed(2)}|${s.mouth}`;
      const moved =
        Math.abs(s.gx - painted.gx) > 0.012 ||
        Math.abs(s.gy - painted.gy) > 0.012;

      // toDataURL is the expensive call, not the canvas drawing — so
      // gate on both "did anything change" and a hard rate floor.
      if ((moved || key !== painted.key) && now - lastPaint >= MIN_FRAME_MS) {
        paint(s);
        painted = { gx: s.gx, gy: s.gy, key };
        lastPaint = now;
      }

      // Stop as soon as the spring settles and no stim is playing. The
      // sleeping face is a static frame, so it needs no frames of its
      // own once painted — the stim timer re-kicks us to notice it.
      if (!settled || stim) {
        rafId = requestAnimationFrame(frame);
      }
    }

    function kick() {
      if (rafId || document.hidden) return;
      lastTime = 0;
      rafId = requestAnimationFrame(frame);
    }

    function onVisibility() {
      if (document.hidden) {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
      } else {
        lastMove = performance.now();
        kick();
      }
    }

    /* ── Wire up ── */
    paint(NEUTRAL);

    if (!reduced) {
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      window.addEventListener("pointerdown", onPointerMove, { passive: true });
      document.addEventListener("pointerout", onPointerOut, { passive: true });
      document.addEventListener("visibilitychange", onVisibility);
      scheduleStim();
      kick();
    }

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerMove);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimeout(stimTimer);
      if (rafId) cancelAnimationFrame(rafId);
      headObserver.disconnect();
      link.remove();
    };
  }, []);

  return null;
}
