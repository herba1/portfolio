"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useGridInput } from "./useGridInput";
import {
  getCoverTexture,
  warmCoverTextures,
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

export default function CoversGrid({ config, configRef, apiRef, covers, onFocusChange, onOpen, onReady }) {
  const { size, gl } = useThree();
  const input = useGridInput(configRef);

  // a specific tile to hide (leaves a gap) + freeze, while the player is open
  const hiddenRef = useRef(null);
  const pausedRef = useRef(false);
  const scrollTargetRef = useRef(null); // minimap jump-to target (eased)

  const cell = config.tileSize + config.gap;

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      resetView: () => {
        input.offset.current.x = 0;
        input.offset.current.y = 0;
        input.vel.current.x = 0;
        input.vel.current.y = 0;
      },
      // hide the clicked tile + freeze the grid while the player is open
      openCell: (col, row) => {
        hiddenRef.current = { col, row };
        pausedRef.current = true;
      },
      closeCell: () => {
        hiddenRef.current = null;
        pausedRef.current = false;
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

  const materials = useMemo(
    () =>
      Array.from({ length: poolCount }, () =>
        new THREE.MeshBasicMaterial({
          transparent: true,
          depthWrite: false,
          toneMapped: false,
          premultipliedAlpha: true, // matches the premultiplied cover textures
        }),
      ),
    [poolCount],
  );
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);
  useEffect(() => () => geo.dispose(), [geo]);

  const texOpts = useMemo(
    () => ({ resolution: TEX_RESOLUTION, cornerRadius: config.cornerRadius }),
    [config.cornerRadius],
  );

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
  const slots = useRef([]);
  const t0 = useRef(null);
  const readyFired = useRef(false); // fire onReady once, when the reveal arms
  const lastFocus = useRef(-1);
  const lookRef = useRef("");
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
    const dt = Math.min(delta, 1 / 30);
    const W = size.width;
    const H = size.height;
    const halfW = W / 2;
    const halfH = H / 2;
    const cellPx = cfg.tileSize + cfg.gap;
    const reduce = cfg.reducedMotion;

    const off = input.offset.current;
    const vel = input.vel.current;

    // ── integrate input → pan offset + velocity (snappy, so motion reacts) ─
    if (pausedRef.current) {
      // frozen behind the open player so the source tile stays put for the
      // close animation to return to.
      vel.x = 0;
      vel.y = 0;
      input.pending.current.x = 0;
      input.pending.current.y = 0;
    } else if (input.down.current) {
      scrollTargetRef.current = null; // a drag cancels a minimap jump
      off.x += input.pending.current.x;
      off.y += input.pending.current.y;
      const a = clamp(dt * 30, 0, 1);
      vel.x = lerp(vel.x, input.pending.current.x / dt, a);
      vel.y = lerp(vel.y, input.pending.current.y / dt, a);
      input.pending.current.x = 0;
      input.pending.current.y = 0;
    } else if (scrollTargetRef.current) {
      const st = scrollTargetRef.current;
      const k = clamp(dt * 5, 0, 1);
      off.x += (st.x - off.x) * k;
      off.y += (st.y - off.y) * k;
      vel.x = 0;
      vel.y = 0;
      if (Math.abs(st.x - off.x) < 0.5 && Math.abs(st.y - off.y) < 0.5) {
        off.x = st.x;
        off.y = st.y;
        scrollTargetRef.current = null;
      }
    } else {
      off.x += vel.x * dt;
      off.y += vel.y * dt;
      const d = Math.pow(cfg.momentumDamping, dt * 60);
      vel.x *= d;
      vel.y *= d;
      if (Math.hypot(vel.x, vel.y) < cfg.stopThreshold) {
        vel.x = 0;
        vel.y = 0;
      }
    }
    const sp = Math.hypot(vel.x, vel.y);
    if (sp > cfg.maxSpeed) {
      const k = cfg.maxSpeed / sp;
      vel.x *= k;
      vel.y *= k;
    }

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

    // rebuild textures in place if the look changed at runtime
    const lookKey = `${cfg.cornerRadius}`;
    if (lookRef.current !== lookKey) {
      lookRef.current = lookKey;
      for (let k = 0; k < slots.current.length; k++) slots.current[k].idx = -1;
    }

    // O(1) hover: snap pointer to its nearest (brick-offset) cell
    let hCol = null;
    let hRow = null;
    if (input.hovering.current && !input.down.current) {
      const px = input.pointer.current.x;
      const py = input.pointer.current.y;
      const r = Math.round((py - off.y) / cellPx);
      const rOff = mod(r, 2) ? cfg.brickOffset * cellPx : 0;
      const c = Math.round((px - off.x - rOff) / cellPx);
      const wx = c * cellPx + off.x + rOff;
      const wy = r * cellPx + off.y;
      if (Math.abs(px - wx) < cfg.tileSize / 2 && Math.abs(py - wy) < cfg.tileSize / 2) {
        hCol = c;
        hRow = r;
      }
    }

    const sigma = cfg.centerSigma * Math.min(halfW, halfH);
    const halfDiag = Math.hypot(halfW, halfH);
    const spanX = poolCols * cellPx;
    const spanY = poolRows * cellPx;
    const limX = halfW + cfg.tileSize;
    const limY = halfH + cfg.tileSize;

    let focusIdx = -1;
    let focusDist = Infinity;

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

      // target world position for this lattice cell (with brick offset)
      const rOff = mod(row, 2) ? cfg.brickOffset * cellPx : 0;
      const tx = col * cellPx + off.x + rOff;
      const ty = row * cellPx + off.y;

      // content (texture swaps happen off-screen, on recycle/init)
      const idx = contentIdx(col, row);
      if (idx !== slot.idx) {
        slot.idx = idx;
        const tex = getCoverTexture(idx, { resolution: TEX_RESOLUTION, cornerRadius: cfg.cornerRadius });
        if (tex && mesh.material.map !== tex) {
          mesh.material.map = tex;
          mesh.material.needsUpdate = true;
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
      } else {
        const distT = clamp(Math.hypot(tx, ty) / halfDiag, 0, 1);
        const jit = 1 + (hash01(k) - 0.5) * 2 * cfg.followJitter;
        const resp = lerp(cfg.followResponseCenter, cfg.followResponseEdge, distT) * jit;
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
      const hovered = hCol != null && col === hCol && row === hRow;

      // steady-state scale spring tracks ONLY hover + centre bump; the entrance
      // is owned by the envelope, so park the spring at target until revealed.
      const scaleTarget = (1 + cfg.centerScale * g) * (hovered ? cfg.hoverScale : 1);
      if (reduce || !slot.born) {
        slot.scale.x = scaleTarget;
        slot.scale.v = 0;
      } else {
        stepSpring(slot.scale, scaleTarget, dt, cfg.scaleResponse, cfg.scaleDamping);
      }
      const sc = slot.scale.x * enterScale;

      // dreamy depth falloff (constant — not an entry animation)
      const distN = clamp(dn / halfDiag, 0, 1);
      const depth = 1 - cfg.depthFade * smoothstep(cfg.depthStart, 1, distN);

      // apply
      const baseW = cfg.tileSize * Math.max(0.0001, sc);
      mesh.position.set(wx, wy + enterRise, hovered ? 20 : g * 4);
      mesh.scale.set(baseW * tileSX, baseW * tileSY, 1);
      mesh.renderOrder = hovered ? 10 : g > 0.5 ? 2 : 1;
      mesh.material.opacity = clamp(depth * enterOpacity, 0, 1);
      const hid = hiddenRef.current;
      mesh.visible = sc > 0.002 && !(hid && col === hid.col && row === hid.row);
    }

    if (focusIdx !== lastFocus.current) {
      lastFocus.current = focusIdx;
      onFocusChange?.(focusIdx);
    }

    if (input.tap.current) {
      input.tap.current = null;
      if (hCol != null) {
        // exact on-screen rect of the clicked tile → the player flips out of it
        const cr = gl.domElement.getBoundingClientRect();
        const ccx = cr.left + cr.width / 2;
        const ccy = cr.top + cr.height / 2;
        let tileRect = { cx: ccx, cy: ccy, size: cfg.tileSize };
        for (let k = 0; k < poolCount; k++) {
          const s = slots.current[k];
          if (s && s.col === hCol && s.row === hRow) {
            tileRect = {
              cx: ccx + s.posX.x,
              cy: ccy - s.posY.x,
              size: cfg.tileSize * Math.max(0.5, s.scale.x),
            };
            break;
          }
        }
        onOpen?.(contentIdx(hCol, hRow), tileRect, { col: hCol, row: hRow });
      }
    }
  });

  return (
    <>
      <CameraRig />
      {Array.from({ length: poolCount }).map((_, k) => (
        <mesh key={k} ref={(el) => (meshes.current[k] = el)} geometry={geo} material={materials[k]} />
      ))}
    </>
  );
}

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
