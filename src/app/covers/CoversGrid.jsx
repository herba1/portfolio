"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useGridInput } from "./useGridInput";
import {
  getCoverTexture,
  warmCoverTextures,
  drainCoverUploads,
  disposeCoverTextures,
  coversReady,
  coverLoaded,
} from "./lib/makeCovers";
import { GRID_COLS, GRID_ROWS, COUNT, TEX_RESOLUTION } from "./lib/config";
import {
  clamp,
  lerp,
  mod,
  smoothstep,
  hash01,
  stepSpring,
} from "./lib/springs";

const MARGIN = 3; // extra rings of tiles kept just outside the viewport (grace)

// Which unique cover lives at an absolute lattice cell. The unique 6×5 set is
// tiled infinitely, so content repeats — the "duplicate the quadrant" trick.
const contentIdx = (col, row) =>
  (mod(row, GRID_ROWS) * GRID_COLS + mod(col, GRID_COLS)) % COUNT;

function CoversGrid({ config, configRef, apiRef, covers, onFocusChange, onOpen, onReady }) {
  const { size, gl } = useThree();
  const input = useGridInput(configRef);

  // a specific tile to hide (leaves a gap) + freeze, while the player is open
  const hiddenRef = useRef(null);
  const pausedRef = useRef(false);
  const scrollTargetRef = useRef(null); // minimap jump-to target (eased)
  // Where the pan WANTS to be. Every input writes here; the rendered offset
  // chases it with one exponential, so no source has its own integrator.
  const panTarget = useRef({ x: 0, y: 0 });
  const flingRef = useRef({ x: 0, y: 0 }); // post-drag throw, px/s
  const wasDragging = useRef(false);
  const prevOff = useRef({ x: 0, y: 0 }); // last frame's pan, for measured velocity
  // the player card's footprint in world px (centred on screen) — the shape the
  // grid gets shoved out of. hx/hy are half-extents, so aspect comes for free.
  const pushRef = useRef({ on: false, x: 0, y: 0, hx: 0, hy: 0 });

  const cell = config.tileSize + config.gap;

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      resetView: () => {
        input.offset.current.x = 0;
        input.offset.current.y = 0;
        input.vel.current.x = 0;
        input.vel.current.y = 0;
        panTarget.current.x = 0;
        panTarget.current.y = 0;
        prevOff.current.x = 0;
        prevOff.current.y = 0;
        flingRef.current.x = 0;
        flingRef.current.y = 0;
        scrollTargetRef.current = null;
      },
      // hide the clicked tile + freeze the grid while the player is open, and
      // arm the push field with the card box the player is about to occupy.
      openCell: (col, row, box) => {
        hiddenRef.current = { col, row };
        pausedRef.current = true;
        pushRef.current = box
          ? { on: true, x: box.x, y: box.y, hx: box.hx, hy: box.hy }
          : { on: false, x: 0, y: 0, hx: 0, hy: 0 };
      },
      // released when the player STARTS closing, so the neighbours drift back
      // together with the flip home instead of snapping after it lands.
      releasePush: () => {
        pushRef.current.on = false;
      },
      closeCell: () => {
        hiddenRef.current = null;
        pausedRef.current = false;
        pushRef.current.on = false;
      },
      // minimap: ease the grid so the nearest instance of a unique cover centres
      jumpToCover: (uc, ur) => {
        const cfg = configRef.current;
        const cell = cfg.tileSize + cfg.gap;
        const off = input.offset.current;
        const centerCol = Math.round(-off.x / cell);
        const centerRow = Math.round(-off.y / cell);
        const col = uc + GRID_COLS * Math.round((centerCol - uc) / GRID_COLS);
        const row = ur + GRID_ROWS * Math.round((centerRow - ur) / GRID_ROWS);
        const rOff = mod(row, 2) ? cfg.brickOffset * cell : 0;
        scrollTargetRef.current = { x: -(col * cell + rOff), y: -(row * cell) };
      },
    };
  }, [apiRef, input, configRef]);

  // Pool: enough tiles to cover the viewport + margin. Each tile recycles
  // individually (off-screen), so there are no synchronized grid jumps.
  const { poolCols, poolRows, poolCount } = useMemo(() => {
    const pc = Math.ceil(size.width / cell) + MARGIN * 2 + 1;
    let pr = Math.ceil(size.height / cell) + MARGIN * 2 + 1;
    pr += pr % 2; // even → vertical recycle preserves brick row parity
    return { poolCols: pc, poolRows: pr, poolCount: pc * pr };
  }, [size.width, size.height, cell]);

  const geo = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  // Rounded corners are cut here, per-fragment, NOT baked into the texture's
  // alpha. A baked corner leaves texels where alpha varies, and linear/mipmap
  // filtering blends RGB and alpha separately — the opaque texel inside the
  // curve averages with the transparent one outside and lands on half-grey at
  // half-alpha, which reads as a dark line tracing every corner. An opaque
  // texture plus an analytic mask has no such texels at all, and the curve
  // stays crisp at any tile size instead of being fixed at bake resolution.
  const radiusUniform = useRef({ value: config.cornerRadius });
  const materials = useMemo(
    () =>
      Array.from({ length: poolCount }, () => {
        const m = new THREE.MeshBasicMaterial({
          transparent: true,
          depthWrite: false,
          toneMapped: false,
        });
        m.onBeforeCompile = (shader) => {
          shader.uniforms.uRadius = radiusUniform.current;
          // own varying: `uv` is always declared by three's vertex prefix, while
          // `vMapUv` only exists once a map is attached (it isn't, on first compile).
          shader.vertexShader = shader.vertexShader
            .replace("void main() {", "varying vec2 vTileUv;\nvoid main() {")
            .replace(
              "#include <begin_vertex>",
              "#include <begin_vertex>\n\tvTileUv = uv;",
            );
          shader.fragmentShader = shader.fragmentShader
            .replace(
              "void main() {",
              "uniform float uRadius;\nvarying vec2 vTileUv;\nvoid main() {",
            )
            .replace(
              "#include <map_fragment>",
              `#include <map_fragment>
	{
		// signed distance to a rounded box in normalised (-1..1) tile space,
		// antialiased across exactly one pixel via the screen-space derivative.
		vec2 p = ( vTileUv - 0.5 ) * 2.0;
		float rr = clamp( uRadius, 0.0, 0.5 ) * 2.0;
		vec2 q = abs( p ) - ( 1.0 - rr );
		float sd = length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 ) - rr;
		float aa = fwidth( sd ) * 0.5 + 1e-6;
		diffuseColor.a *= 1.0 - smoothstep( -aa, aa, sd );
	}`,
            );
        };
        return m;
      }),
    [poolCount],
  );
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);
  useEffect(() => () => geo.dispose(), [geo]);

  // corners are shader-side now, so the bake only depends on resolution
  const texOpts = useMemo(() => ({ resolution: TEX_RESOLUTION }), []);

  // pre-bake every cover texture; rebuild when the look OR the sources change.
  // When the real album art arrives (covers swaps), re-arm the one-time reveal
  // so the staggered entrance plays WITH images instead of over blank slate.
  useEffect(() => {
    warmCoverTextures(COUNT, texOpts);
    for (const s of slots.current) {
      if (!s) continue;
      s.idx = -1; // reassign meshes to new textures
      s.born = false;
      s.scale.x = 0;
      s.scale.v = 0;
      s.enter.x = 0;
      s.enter.v = 0;
    }
    t0.current = null; // hold the entrance until coversReady() (or the timeout)
    return () => disposeCoverTextures();
  }, [texOpts, covers]);

  // per-tile state — lattice (col,row) + a position spring + a scale spring
  const meshes = useRef([]);
  // One ref callback per slot, made once and reused. An inline arrow here is a
  // NEW function every render, so React detaches and re-attaches all ~110 mesh
  // refs (a null call, then a real one) even when nothing about the mesh moved.
  const meshCbs = useRef([]);
  const meshRef = (k) =>
    (meshCbs.current[k] ??= (el) => {
      meshes.current[k] = el;
    });
  const slots = useRef([]);
  const t0 = useRef(null);
  const readyFired = useRef(false); // fire onReady once, when the reveal arms
  const lastFocus = useRef(-1);
  const stretchX = useRef({ x: 0, v: 0 });
  const stretchY = useRef({ x: 0, v: 0 });

  useEffect(() => {
    meshes.current.length = poolCount;
    const cI = Math.floor(poolCols / 2);
    const cJ = Math.floor(poolRows / 2);
    slots.current = Array.from({ length: poolCount }, (_, k) => {
      const cx = k % poolCols; // 0 = left … poolCols-1 = right
      const rj = (k / poolCols) | 0; // 0 = bottom … poolRows-1 = top
      const di = cx - cI;
      const dj = rj - cJ;
      // diagonal wavefront: top-left fires first (0), bottom-right last. The
      // jitter scatters the line so the sweep reads organic, not mechanical.
      const diag = cx + (poolRows - 1 - rj);
      return {
        col: di,
        row: dj,
        posX: { x: 0, v: 0 },
        posY: { x: 0, v: 0 },
        scale: { x: 0, v: 0 },
        enter: { x: 0, v: 0 }, // entrance spring: 0 → overshoot → 1 once born
        push: { x: 0, v: 0 }, // click-recoil spring: 0 → 1 while a cover is open
        renderScale: 1, // last drawn scale (hover × entrance × depth) — tap rect
        idx: -1,
        init: false,
        born: false,
        bornDelay: diag, // diagonal step index (× popStagger)
        bornJit: hash01(k * 7.3), // per-tile timing scatter (× popJitter)
      };
    });
    t0.current = null; // restart the load cascade
  }, [poolCount, poolCols, poolRows]);

  const CameraRig = useCameraRig();

  useFrame((state, delta) => {
    const cfg = configRef.current;
    // one cover to the GPU per frame, at the top of the frame — see makeCovers
    drainCoverUploads(gl, 1);
    // Clamped at BOTH ends. The ceiling stops a stalled tab from teleporting the
    // grid on the frame it resumes. The floor matters just as much and is easier
    // to miss: the velocity below divides pan travel by dt, so a zero delta — a
    // duplicated rAF, a resumed frame — turns a held-still finger's 0px of
    // travel into 0/0 = NaN, and nothing downstream rejects NaN (every
    // comparison against it is false). That one bad frame would poison the
    // offset and every spring reading it, for good. 1/240 is below any real
    // frame, so this costs nothing when awake.
    const dt = Number.isFinite(delta) ? Math.min(Math.max(delta, 1 / 240), 1 / 30) : 1 / 60;
    const W = size.width;
    const H = size.height;
    const halfW = W / 2;
    const halfH = H / 2;
    const cellPx = cfg.tileSize + cfg.gap;
    const reduce = cfg.reducedMotion;

    const off = input.offset.current;
    const vel = input.vel.current;

    // ── integrate input → pan offset ──────────────────────────────────────
    // ONE model for every source. Drag, wheel, throw and minimap jump all move
    // the same TARGET pan; the rendered offset chases that target with a single
    // exponential. Nothing is banked, nothing is rate-limited, nothing is thrown
    // away — every px of gesture lands, in the order it arrived.
    //
    // What this replaces: the wheel used to be banked, capped to N seconds of
    // travel, drained a slice per frame, and separately capped again on the
    // spend RATE — so a hard fling both lost distance (over the bank cap) and
    // kept moving after your fingers stopped (the clipped remainder drained
    // late). Two caps, both invisible, both fighting the gesture. And the moment
    // the bank emptied, control handed over to a completely different momentum
    // integrator at a fraction of the speed, which is the "freak out" you feel.
    const tgt = panTarget.current;
    const fling = flingRef.current;
    const dragging = input.down.current;

    if (pausedRef.current) {
      // frozen behind the open player so the source tile stays put for the
      // close animation to return to.
      tgt.x = off.x;
      tgt.y = off.y;
      vel.x = 0;
      vel.y = 0;
      fling.x = 0;
      fling.y = 0;
      wasDragging.current = false; // unpausing must not fire a phantom throw
      input.pending.current.x = 0;
      input.pending.current.y = 0;
      input.wheel.current.x = 0;
      input.wheel.current.y = 0;
    } else {
      if (dragging) {
        scrollTargetRef.current = null; // a drag cancels a minimap jump
        fling.x = 0;
        fling.y = 0;
        if (!wasDragging.current) {
          // Grabbing stops the grid WHERE IT IS. The target can be ahead of the
          // rendered pan mid-smooth (or mid-jump); without this the first frame
          // of the drag would teleport the grid onto it.
          tgt.x = off.x;
          tgt.y = off.y;
        }
        tgt.x += input.pending.current.x;
        tgt.y += input.pending.current.y;
        input.pending.current.x = 0;
        input.pending.current.y = 0;
      } else {
        const wb = input.wheel.current;
        if (wb.x || wb.y) {
          // Spent WHOLE, now — nothing is held back for a later frame. The only
          // thing between the gesture and the pan is RESISTANCE: gain falls off
          // with how hard you're scrolling, so the fast end gets diminishing
          // returns instead of a ceiling. Scrolling twice as hard always moves
          // you further, just not twice as far.
          scrollTargetRef.current = null; // scrolling cancels a minimap jump
          fling.x = 0; // a scroll takes over from a drag's throw
          fling.y = 0;
          const rate = Math.hypot(wb.x, wb.y) / dt; // px/s of pan asked for
          const knee = Math.max(cfg.scrollKnee, 1);
          const soft =
            rate > knee ? Math.pow(knee / rate, clamp(cfg.scrollResist, 0, 1)) : 1;
          tgt.x += wb.x * soft;
          tgt.y += wb.y * soft;
          wb.x = 0;
          wb.y = 0;
        } else if (wasDragging.current && !input.cancelled.current) {
          // let go of a drag → the pan keeps the speed it had. A gesture the
          // system took away (edge swipe, second finger) is NOT a release, so it
          // gets no throw — that one used to fling the grid across the screen
          // for no reason the hand could account for.
          fling.x = vel.x;
          fling.y = vel.y;
        }

        if (scrollTargetRef.current) {
          const st = scrollTargetRef.current;
          const k = clamp(dt * 5, 0, 1);
          tgt.x += (st.x - tgt.x) * k;
          tgt.y += (st.y - tgt.y) * k;
          if (Math.abs(st.x - tgt.x) < 0.5 && Math.abs(st.y - tgt.y) < 0.5) {
            tgt.x = st.x;
            tgt.y = st.y;
            scrollTargetRef.current = null;
          }
        } else if (fling.x || fling.y) {
          tgt.x += fling.x * dt;
          tgt.y += fling.y * dt;
          const d = Math.pow(cfg.momentumDamping, dt * 60);
          fling.x *= d;
          fling.y *= d;
          if (Math.hypot(fling.x, fling.y) < cfg.stopThreshold) {
            fling.x = 0;
            fling.y = 0;
          }
        }
      }

      // Under the finger the pan IS the finger — no smoothing, or the content
      // slides out from under the skin holding it. A throw skips it too: the
      // decay already IS the smooth part, and putting the pan a further ~90ms
      // behind it at the exact moment you let go is what made the release feel
      // mushy on touch. Smoothing exists for the wheel, whose deltas arrive in
      // discrete chunks; a finger's don't. exp(-dt/τ) rather than a raw lerp so
      // the feel is identical at 60, 120 and 30fps instead of softening when
      // frames drop.
      const throwing = fling.x !== 0 || fling.y !== 0;
      const tau = dragging || throwing ? 0 : Math.max(cfg.scrollSmooth ?? 0, 0);
      const k = tau > 1e-4 ? 1 - Math.exp(-dt / tau) : 1;
      off.x += (tgt.x - off.x) * k;
      off.y += (tgt.y - off.y) * k;
    }
    wasDragging.current = dragging && !pausedRef.current;

    // Velocity is MEASURED off the pan now instead of being a second, parallel
    // integrator that could disagree with it — the stretch, the throw speed and
    // the spring tightening below all read the motion that actually happened.
    const pOff = prevOff.current;
    const a = clamp(dt * 30, 0, 1);
    vel.x = lerp(vel.x, (off.x - pOff.x) / dt, a);
    vel.y = lerp(vel.y, (off.y - pOff.y) / dt, a);
    pOff.x = off.x;
    pOff.y = off.y;
    if (Math.hypot(vel.x, vel.y) < cfg.stopThreshold) {
      vel.x = 0;
      vel.y = 0;
    }

    // The pan is never capped; the SPRINGS tighten with speed instead. Trail
    // length is ζ·response/π × speed, so scaling response by 1/(1 + speed/S)
    // makes the trail approach a fixed ceiling (~200px at the defaults, half a
    // cell) however hard you scroll — the softness survives, the tearing can't.
    const trackTighten =
      1 / (1 + Math.hypot(vel.x, vel.y) / Math.max(cfg.springTrackSpeed, 1));

    // ── directional squash & stretch (shared across all tiles) ──────────
    const sxTarget = reduce ? 0 : clamp(Math.abs(vel.x) / cfg.stretchRef, 0, 1) * cfg.stretchMax;
    const syTarget = reduce ? 0 : clamp(Math.abs(vel.y) / cfg.stretchRef, 0, 1) * cfg.stretchMax;
    const stX = stepSpring(stretchX.current, sxTarget, dt, cfg.stretchResponse, cfg.stretchDamping);
    const stY = stepSpring(stretchY.current, syTarget, dt, cfg.stretchResponse, cfg.stretchDamping);
    const tileSX = 1 + stX - cfg.stretchSquash * stY;
    const tileSY = 1 + stY - cfg.stretchSquash * stX;

    // ── entrance clock ─────────────────────────────────────────────────────
    // Hold the reveal until the album art has actually loaded (coversReady),
    // so the stagger plays over real images — not blank slate. A timeout is the
    // escape hatch if art never arrives (Spotify off / offline).
    const elapsed = state.clock.elapsedTime;
    if (t0.current == null) {
      if (reduce || coversReady() || elapsed > cfg.popReadyTimeout) {
        t0.current = elapsed;
        if (!readyFired.current) {
          readyFired.current = true;
          onReady?.(); // tell the HUD it can stagger in now (art is loaded)
        }
      }
    }
    const armed = t0.current != null;
    const since = armed ? elapsed - t0.current : 0;

    // corner radius is a live uniform — no texture rebuild when it's dragged
    radiusUniform.current.value = cfg.cornerRadius;

    // O(1) hit-test: snap a world point to its nearest (brick-offset) cell,
    // then confirm the point actually landed on the tile and not in the gap.
    // `half` is the hit box half-extent, so touch can ask for a looser one.
    const cellAt = (px, py, half) => {
      const r = Math.round((py - off.y) / cellPx);
      const rOff = mod(r, 2) ? cfg.brickOffset * cellPx : 0;
      const c = Math.round((px - off.x - rOff) / cellPx);
      const wx = c * cellPx + off.x + rOff;
      const wy = r * cellPx + off.y;
      if (Math.abs(px - wx) < half && Math.abs(py - wy) < half) return { c, r };
      return null;
    };

    let hCol = null;
    let hRow = null;
    if (input.hovering.current && !input.down.current) {
      const hit = cellAt(input.pointer.current.x, input.pointer.current.y, cfg.tileSize / 2);
      if (hit) {
        hCol = hit.c;
        hRow = hit.r;
      }
    }

    const sigma = cfg.centerSigma * Math.min(halfW, halfH);
    const halfDiag = Math.hypot(halfW, halfH);
    const spanX = poolCols * cellPx;
    const spanY = poolRows * cellPx;
    const limX = halfW + cfg.tileSize;
    const limY = halfH + cfg.tileSize;

    // click-push field: an ellipse stretched to the player card's aspect, with
    // a soft falloff band outside it. Distances are to the ellipse SURFACE, so
    // the pocket takes the card's shape, while the shove direction stays purely
    // radial — each tile leaves along its own ray.
    const push = pushRef.current;
    const pushPad = cfg.pushInflate * cfg.tileSize;
    const pushRX = Math.max(1, push.hx + pushPad);
    const pushRY = Math.max(1, push.hy + pushPad);
    const pushRange = Math.max(1, cfg.pushFalloff * cellPx);
    const pushOn = push.on && !reduce;
    // per-axis force, scaled by the field's own proportions: the long axis keeps
    // full strength, the short one gets its share. A landscape card therefore
    // sweeps sideways instead of firing tiles out through the top and bottom,
    // where there's barely a tile of headroom to begin with.
    const pushAxis = Math.max(pushRX, pushRY);
    const pushFX = lerp(1, pushRX / pushAxis, cfg.pushAnisotropy);
    const pushFY = lerp(1, pushRY / pushAxis, cfg.pushAnisotropy);

    let focusIdx = -1;
    let focusDist = Infinity;

    const hid = hiddenRef.current;

    for (let k = 0; k < poolCount; k++) {
      const mesh = meshes.current[k];
      const slot = slots.current[k];
      if (!mesh || !slot) continue;

      // ── recycle based on the RENDERED (sprung) position ────────────────
      // Teleport a tile only once it has actually scrolled off-screen — using
      // where it IS, not its target. On a fast drag the spring lags behind the
      // target, so keying off the target would yank away a tile that's still
      // visible (the "pops out / disappears early"). Shifting the lattice cell
      // and the spring position together by one full span keeps the teleport
      // invisible and preserves the lag.
      let row = slot.row;
      let col = slot.col;
      let guard = 0;
      while (slot.posY.x > limY && guard++ < 8) { row -= poolRows; slot.posY.x -= spanY; }
      while (slot.posY.x < -limY && guard++ < 16) { row += poolRows; slot.posY.x += spanY; }
      guard = 0;
      while (slot.posX.x > limX && guard++ < 8) { col -= poolCols; slot.posX.x -= spanX; }
      while (slot.posX.x < -limX && guard++ < 16) { col += poolCols; slot.posX.x += spanX; }
      slot.col = col;
      slot.row = row;

      // the source tile is the one the player grew out of — it's invisible while
      // the card is open, and the card's morph-home target was recorded from its
      // geometry at click time. Anything that keeps evolving underneath it is a
      // mismatch the eye catches the instant the tile is revealed again.
      const isSource = hid != null && col === hid.col && row === hid.row;

      // target world position for this lattice cell (with brick offset)
      const rOff = mod(row, 2) ? cfg.brickOffset * cellPx : 0;
      const tx = col * cellPx + off.x + rOff;
      const ty = row * cellPx + off.y;

      // content (texture swaps happen off-screen, on recycle/init)
      const idx = contentIdx(col, row);
      if (idx !== slot.idx) {
        slot.idx = idx;
        const tex = getCoverTexture(idx, { resolution: TEX_RESOLUTION });
        if (tex && mesh.material.map !== tex) {
          // needsUpdate ONLY when a map appears where there was none. That flag
          // makes three re-derive the material's program, and tiles swap texture
          // on every recycle — i.e. constantly, while scrolling. Going from one
          // texture to another changes no shader define, so the recompile check
          // was pure overhead on exactly the frames that could least afford it.
          if (!mesh.material.map) mesh.material.needsUpdate = true;
          mesh.material.map = tex;
        }
        mesh.userData.coverIdx = idx;
      }

      // organic follow: position spring chases the target (overshoots). No
      // snap on recycle — the teleport above already moved the spring position
      // in lock-step with the lattice, so motion stays continuous.
      if (!slot.init) {
        slot.posX.x = tx; slot.posX.v = 0;
        slot.posY.x = ty; slot.posY.v = 0;
        slot.init = true;
      } else if (reduce) {
        slot.posX.x = tx; slot.posY.x = ty;
      } else if (isSource) {
        // frozen at the exact position the card recorded on click. Tapping
        // mid-drift leaves this spring lagging its target; letting it settle
        // while hidden means the card morphs home to a spot the tile has since
        // left, and you see the gap close after the card is already gone.
        slot.posX.v = 0;
        slot.posY.v = 0;
      } else {
        const distT = clamp(Math.hypot(tx, ty) / halfDiag, 0, 1);
        const jit = 1 + (hash01(k) - 0.5) * 2 * cfg.followJitter;
        const resp =
          lerp(cfg.followResponseCenter, cfg.followResponseEdge, distT) * jit * trackTighten;
        stepSpring(slot.posX, tx, dt, resp, cfg.followDamping);
        stepSpring(slot.posY, ty, dt, resp, cfg.followDamping);
      }
      const wx = slot.posX.x;
      const wy = slot.posY.x;

      // distances / focus (from where the tile actually is)
      const dn = Math.hypot(wx, wy);
      if (dn < focusDist) {
        focusDist = dn;
        focusIdx = idx;
      }

      // ── one-time entrance: a real damped spring per tile ─────────────────
      // born gate trips when this tile's diagonal delay (+ jitter) elapses,
      // then ONE underdamped spring (0 → overshoot → 1) drives the whole
      // "scale + translate + opacity" combo. Because it's a genuine spring it
      // overshoots and decays — the asymmetric settle that reads as natural and
      // alive; a monotonic ease here is exactly what felt linear. Motion leads,
      // opacity just chases the spring so it never looks like a slow fade.
      // Two gates, both must pass: the diagonal clock (since ≥ startDelay) AND
      // this tile's own image actually being painted (coverLoaded). The second
      // is the hard guarantee — a tile never springs in over a blank slate even
      // if the global ready-timeout armed the clock early.
      const startDelay =
        (slot.bornDelay + slot.bornJit * cfg.popJitter) * cfg.popStagger;
      if (
        !slot.born &&
        armed &&
        (reduce || (since >= startDelay && coverLoaded(idx)))
      ) {
        slot.born = true;
      }
      if (reduce || !slot.born) {
        slot.enter.x = 0;
        slot.enter.v = 0;
      } else {
        stepSpring(slot.enter, 1, dt, cfg.popResponse, cfg.popDamping);
      }
      const e = reduce ? 1 : slot.enter.x; // 0 → ~1.1 (overshoot) → 1
      const enterScale = lerp(cfg.popScaleFrom, 1, e);
      const enterRise = reduce ? 0 : -(1 - e) * cfg.popRise; // rise up, overshoot
      const enterOpacity = reduce ? 1 : smoothstep(0, 0.45, e); // chases the spring

      const g = Math.exp(-(dn * dn) / (2 * sigma * sigma)); // 1 centre → 0 far
      const hovered = !isSource && hCol != null && col === hCol && row === hRow;

      // steady-state scale spring tracks ONLY hover + centre bump; the entrance
      // is owned by the envelope, so park the spring at target until revealed.
      const scaleTarget = (1 + cfg.centerScale * g) * (hovered ? cfg.hoverScale : 1);
      if (reduce || !slot.born) {
        slot.scale.x = scaleTarget;
        slot.scale.v = 0;
      } else if (isSource) {
        // frozen: the card is animating back to the size this tile had when it
        // was clicked (hover bump included). Letting the spring drift down to
        // the un-hovered target here is what made the card land at one size and
        // the revealed tile appear at another.
        slot.scale.v = 0;
      } else {
        stepSpring(slot.scale, scaleTarget, dt, cfg.scaleResponse, cfg.scaleDamping);
      }
      // dreamy depth falloff (constant — not an entry animation). The same
      // falloff drives opacity AND size: a tile drifting to the edge shrinks as
      // it dims, so it reads as receding instead of just going transparent.
      const distN = clamp(dn / halfDiag, 0, 1);
      const away = smoothstep(cfg.depthStart, 1, distN);
      const depth = 1 - cfg.depthFade * away;
      const depthScale = 1 - cfg.depthScale * away;

      const sc = slot.scale.x * enterScale * depthScale;
      // the tile's true on-screen scale this frame, cached so a tap can hand the
      // player the rect the tile is ACTUALLY drawn at — depth shrink and all.
      slot.renderScale = sc;

      // ── click recoil ─────────────────────────────────────────────────────
      // Displacement is render-only: the lattice, the follow springs and the
      // recycle bounds all keep working off the un-pushed position, so a shoved
      // tile can't teleport or lose its place. Nearer tiles get a faster spring
      // than far ones, which is what turns a uniform shove into a ripple.
      let pdx = 0;
      let pdy = 0;
      let pushShrink = 1;
      const rx = wx - push.x;
      const ry = wy - push.y;
      const rd = Math.hypot(rx, ry);
      // approximate signed distance to the ellipse: <0 inside, >0 outside. k1 is
      // the tile's position in "ellipse radii", k2 rescales that back into px.
      const k1 = Math.hypot(rx / pushRX, ry / pushRY);
      const k2 = Math.hypot(rx / (pushRX * pushRX), ry / (pushRY * pushRY));
      const sd = k2 > 1e-9 ? (k1 * (k1 - 1)) / k2 : -Math.min(pushRX, pushRY);
      const inField = pushOn && !isSource && rd > 0.001 && sd < pushRange;
      if (isSource) {
        // The source tile sits inside its own push field, so it used to be shoved
        // out with everything else. Closing releases the push and reveals the tile
        // half a second later — but the recoil spring is underdamped and still
        // unwinding at that point, so the card would land, vanish, and the tile
        // would appear tens of px off and visibly slide+bounce the rest of the way
        // home. It's hidden anyway: keep it parked exactly where the card lands.
        slot.push.x = 0;
        slot.push.v = 0;
      } else if (inField || slot.push.x > 0.0005 || Math.abs(slot.push.v) > 0.0005) {
        const spread = 1 + clamp(Math.max(sd, 0) / pushRange, 0, 1) * cfg.pushSpread;
        stepSpring(slot.push, inField ? 1 : 0, dt, cfg.pushResponse * spread, cfg.pushDamping);
        if (rd > 0.001) {
          // full strength anywhere inside the ellipse, easing off across the band
          const f = sd <= 0 ? 1 : 1 - smoothstep(0, 1, sd / pushRange);
          const amp = cfg.pushStrength * f * slot.push.x;
          pdx = (rx / rd) * amp * pushFX; // radial — straight out from the centre
          pdy = (ry / rd) * amp * pushFY;
          pushShrink = 1 - cfg.pushScale * f * clamp(slot.push.x, 0, 1);
        }
      } else {
        slot.push.x = 0;
        slot.push.v = 0;
      }

      // apply
      const baseW = cfg.tileSize * Math.max(0.0001, sc * pushShrink);
      mesh.position.set(wx + pdx, wy + enterRise + pdy, hovered ? 20 : g * 4);
      mesh.scale.set(baseW * tileSX, baseW * tileSY, 1);
      mesh.renderOrder = hovered ? 10 : g > 0.5 ? 2 : 1;
      mesh.material.opacity = clamp(depth * enterOpacity, 0, 1);
      mesh.visible = sc > 0.002 && !isSource;
    }

    if (focusIdx !== lastFocus.current) {
      lastFocus.current = focusIdx;
      onFocusChange?.(focusIdx);
    }

    if (input.tap.current) {
      const t = input.tap.current;
      input.tap.current = null;
      // Hit-test the tap from ITS OWN coordinates rather than reusing the hover
      // cell. Touch has no hover: a tap that holds still fires no pointermove,
      // so hCol would be stale or null and the cover just wouldn't open. The
      // release point is always the truth about what was tapped.
      const cr = gl.domElement.getBoundingClientRect();
      const tx = t.x - cr.left - cr.width / 2;
      const ty = -(t.y - cr.top - cr.height / 2);
      // Fingers are imprecise and the gap between covers is wide, so give touch
      // a little forgiveness. Safe: the nearest-cell snap has already decided
      // WHICH cover this is — the box only decides whether it counts as a hit.
      const half = t.coarse
        ? Math.min(cfg.tileSize / 2 + 16, cellPx / 2)
        : cfg.tileSize / 2;
      const hit = cellAt(tx, ty, half);
      if (hit) {
        // exact on-screen rect of the clicked tile → the player flips out of it
        const ccx = cr.left + cr.width / 2;
        const ccy = cr.top + cr.height / 2;
        let tileRect = { cx: ccx, cy: ccy, size: cfg.tileSize };
        for (let k = 0; k < poolCount; k++) {
          const s = slots.current[k];
          if (s && s.col === hit.c && s.row === hit.r) {
            tileRect = {
              cx: ccx + s.posX.x,
              cy: ccy - s.posY.x,
              // renderScale, not scale.x: the drawn size also carries the depth
              // falloff (a tile away from centre is up to ~28% smaller). Handing
              // over the raw hover/centre spring made the card morph home to a
              // square the tile never occupied — the further out you clicked, the
              // worse the mismatch when it landed.
              size: cfg.tileSize * Math.max(0.05, s.renderScale ?? s.scale.x),
            };
            break;
          }
        }
        onOpen?.(contentIdx(hit.c, hit.r), tileRect, { col: hit.c, row: hit.r });
      }
    }
  });

  return (
    <>
      <CameraRig />
      {Array.from({ length: poolCount }).map((_, k) => (
        <mesh key={k} ref={meshRef(k)} geometry={geo} material={materials[k]} />
      ))}
    </>
  );
}

// Everything the frame loop reads comes off `configRef`, not the `config` prop,
// so this component does not need to re-render just because its parent did —
// and a parent render here means reconciling the whole mesh pool mid-drag.
// `config` is a flat bag of numbers, so compare it by value: Leva hands back a
// fresh object identity on every render even when no control moved, which would
// otherwise defeat the memo entirely.
function sameConfig(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (!Object.is(a[k], b[k])) return false;
  return true;
}

export default memo(
  CoversGrid,
  (a, b) =>
    a.covers === b.covers &&
    a.configRef === b.configRef &&
    a.apiRef === b.apiRef &&
    a.onFocusChange === b.onFocusChange &&
    a.onOpen === b.onOpen &&
    a.onReady === b.onReady &&
    sameConfig(a.config, b.config),
);

// 1 unit = 1px orthographic frustum, refit on resize.
function useCameraRig() {
  return useMemo(
    () =>
      function CameraRig() {
        const { camera, size } = useThree();
        useLayoutEffect(() => {
          camera.left = -size.width / 2;
          camera.right = size.width / 2;
          camera.top = size.height / 2;
          camera.bottom = -size.height / 2;
          camera.updateProjectionMatrix();
        }, [camera, size.width, size.height]);
        return null;
      },
    [],
  );
}
