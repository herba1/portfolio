import { CORE, FULL, HUBS, MOUTH, ROLLER, TAPE_HALF, TAPE_Y } from "./cassetteTape";
import {
  COUNTER,
  JCARD,
  blobCanvas,
  counterCanvas,
  deskCanvas,
  endGrainCanvas,
  foilCanvas,
  jcardCanvas,
  labelCanvas,
  packCanvas,
  pencilWoodCanvas,
} from "./cassetteTextures";

export const SHELL = { w: 100.4, d: 63.8, h: 12 };
export const PENCIL = { length: 124, inR: 3.45, tan: 4.05 / 17.5, lead: 1.0, tip: 0.24 };
export const HUB_HOLE = 6.6;

function texture(THREE, renderer, source, { srgb = true, repeat = false, mips = true } = {}) {
  const t = new THREE.CanvasTexture(source);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.generateMipmaps = mips;
  t.needsUpdate = true;
  return t;
}

function roundedRect(path, x0, y0, x1, y1, r) {
  path.moveTo(x0 + r, y0);
  path.lineTo(x1 - r, y0);
  path.quadraticCurveTo(x1, y0, x1, y0 + r);
  path.lineTo(x1, y1 - r);
  path.quadraticCurveTo(x1, y1, x1 - r, y1);
  path.lineTo(x0 + r, y1);
  path.quadraticCurveTo(x0, y1, x0, y1 - r);
  path.lineTo(x0, y0 + r);
  path.quadraticCurveTo(x0, y0, x0 + r, y0);
}

function shellShape(THREE) {
  const hw = SHELL.w / 2;
  const hd = SHELL.d / 2;
  const r = 3.2;
  const nx = 26;
  const notch = SHELL.d / 2 - 28.6;
  const s = new THREE.Shape();
  s.moveTo(-hw + r, hd);
  s.lineTo(hw - r, hd);
  s.quadraticCurveTo(hw, hd, hw, hd - r);
  s.lineTo(hw, -hd + r);
  s.quadraticCurveTo(hw, -hd, hw - r, -hd);
  s.lineTo(nx + 0.8, -hd);
  s.quadraticCurveTo(nx, -hd, nx, -hd + 0.8);
  s.lineTo(nx, -hd + notch);
  s.lineTo(-nx, -hd + notch);
  s.lineTo(-nx, -hd + 0.8);
  s.quadraticCurveTo(-nx, -hd, -nx - 0.8, -hd);
  s.lineTo(-hw + r, -hd);
  s.quadraticCurveTo(-hw, -hd, -hw, -hd + r);
  s.lineTo(-hw, hd - r);
  s.quadraticCurveTo(-hw, hd, -hw + r, hd);
  for (const hub of HUBS) {
    const hole = new THREE.Path();
    hole.absarc(hub.x, -hub.z, HUB_HOLE, 0, Math.PI * 2, true);
    s.holes.push(hole);
  }
  for (const [x, z] of [[-14, 25.2], [14, 25.2]]) {
    const hole = new THREE.Path();
    hole.absarc(x, -z, 1.25, 0, Math.PI * 2, true);
    s.holes.push(hole);
  }
  return s;
}

function plateShape(THREE) {
  const hd = SHELL.d / 2;
  const s = new THREE.Shape();
  s.moveTo(-31, -17.5);
  s.lineTo(31, -17.5);
  s.lineTo(40.5, -hd + 0.6);
  s.lineTo(26.6, -hd + 0.6);
  s.lineTo(26.6, -28.2);
  s.lineTo(-26.6, -28.2);
  s.lineTo(-26.6, -hd + 0.6);
  s.lineTo(-40.5, -hd + 0.6);
  s.lineTo(-31, -17.5);
  for (const [x, z] of [[-14, 25.2], [14, 25.2]]) {
    const hole = new THREE.Path();
    hole.absarc(x, -z, 1.25, 0, Math.PI * 2, true);
    s.holes.push(hole);
  }
  return s;
}

function hubShape(THREE) {
  const s = new THREE.Shape();
  s.absarc(0, 0, CORE, 0, Math.PI * 2, false);
  const bore = new THREE.Path();
  const pts = [];
  for (let k = 0; k < 6; k += 1) {
    const a = (k * Math.PI) / 3;
    const tipHalf = Math.asin(0.72 / 3.52);
    const rootHalf = Math.asin(0.72 / 4.4);
    pts.push([4.4, a - rootHalf], [3.52, a - tipHalf], [3.52, a + tipHalf], [4.4, a + rootHalf]);
    const next = a + Math.PI / 3 - rootHalf;
    for (let j = 1; j < 6; j += 1) pts.push([4.4, a + rootHalf + ((next - a - rootHalf) * j) / 6]);
  }
  pts.forEach(([r, a], i) => {
    if (i === 0) bore.moveTo(r * Math.cos(a), r * Math.sin(a));
    else bore.lineTo(r * Math.cos(a), r * Math.sin(a));
  });
  bore.closePath();
  s.holes.push(bore);
  for (let k = 0; k < 6; k += 1) {
    const a0 = (k * Math.PI) / 3 + 0.2;
    const a1 = ((k + 1) * Math.PI) / 3 - 0.2;
    const win = new THREE.Path();
    win.absarc(0, 0, 9.4, a0, a1, false);
    win.absarc(0, 0, 5.9, a1 - 0.05, a0 + 0.05, true);
    win.closePath();
    s.holes.push(win);
  }
  return s;
}

function packTop(THREE, segments) {
  const g = new THREE.BufferGeometry();
  const count = (segments + 1) * 2;
  const pos = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const nor = new Float32Array(count * 3);
  const idx = [];
  for (let i = 0; i <= segments; i += 1) {
    nor[i * 6 + 1] = 1;
    nor[i * 6 + 4] = 1;
    if (i < segments) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  g.setIndex(idx);
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.userData.segments = segments;
  return g;
}

export function setPackTop(g, inner, outer) {
  const n = g.userData.segments;
  const pos = g.attributes.position.array;
  const uv = g.attributes.uv.array;
  const span = (FULL + 1) * 2;
  for (let i = 0; i <= n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    const c = Math.cos(a);
    const s = -Math.sin(a);
    pos[i * 6] = inner * c;
    pos[i * 6 + 2] = inner * s;
    pos[i * 6 + 3] = outer * c;
    pos[i * 6 + 5] = outer * s;
    uv[i * 4] = 0.5 + (inner * c) / span;
    uv[i * 4 + 1] = 0.5 - (inner * s) / span;
    uv[i * 4 + 2] = 0.5 + (outer * c) / span;
    uv[i * 4 + 3] = 0.5 - (outer * s) / span;
  }
  g.attributes.position.needsUpdate = true;
  g.attributes.uv.needsUpdate = true;
  g.computeBoundingSphere();
}

function pencilGeometry(THREE) {
  const { length, inR, tan, tip } = PENCIL;
  const rc = inR / Math.cos(Math.PI / 6);
  const coneStart = length - rc / tan;
  const ys = [0, 24, 48, 72, 96];
  const fineFrom = coneStart - 2;
  for (let i = 0; i <= 120; i += 1) ys.push(fineFrom + ((length - fineFrom) * i) / 120);
  const K = 10;
  const pos = [];
  const nor = [];
  const idx = [];
  const cosA = 1 / Math.sqrt(1 + tan * tan);
  const sinA = tan * cosA;
  for (let f = 0; f < 6; f += 1) {
    const a0 = (f * Math.PI) / 3;
    const a1 = ((f + 1) * Math.PI) / 3;
    const c0 = [rc * Math.cos(a0), rc * Math.sin(a0)];
    const c1 = [rc * Math.cos(a1), rc * Math.sin(a1)];
    const fn = [Math.cos(a0 + Math.PI / 6), Math.sin(a0 + Math.PI / 6)];
    const base = pos.length / 3;
    for (let row = 0; row < ys.length; row += 1) {
      const y = ys[row];
      const cone = Math.max(tip, (length - y) * tan);
      for (let j = 0; j <= K; j += 1) {
        const t = j / K;
        const px = c0[0] + (c1[0] - c0[0]) * t;
        const pz = c0[1] + (c1[1] - c0[1]) * t;
        const rho = Math.hypot(px, pz);
        const ux = px / rho;
        const uz = pz / rho;
        if (rho <= cone) {
          pos.push(px, y, pz);
          nor.push(fn[0], 0, fn[1]);
        } else {
          pos.push(ux * cone, y, uz * cone);
          nor.push(ux * cosA, sinA, uz * cosA);
        }
      }
    }
    for (let row = 0; row < ys.length - 1; row += 1) {
      for (let j = 0; j < K; j += 1) {
        const a = base + row * (K + 1) + j;
        const b = a + K + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const tipIndex = pos.length / 3;
  pos.push(0, length + tip * 0.6, 0);
  nor.push(0, 1, 0);
  const lastRow = ys.length - 1;
  for (let f = 0; f < 6; f += 1) {
    const base = f * ys.length * (K + 1) + lastRow * (K + 1);
    for (let j = 0; j < K; j += 1) idx.push(base + j, tipIndex, base + j + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function pencilMaterial(THREE, wood, foil) {
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#1d4636"),
    roughness: 0.38,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
  });
  const uniforms = {
    uWood: { value: wood },
    uFoil: { value: foil },
    uLen: { value: PENCIL.length },
    uInR: { value: PENCIL.inR },
    uTan: { value: PENCIL.tan },
    uLead: { value: PENCIL.lead },
    uLeadCol: { value: new THREE.Color("#2b2b2e") },
    uGold: { value: new THREE.Color("#d9b56a") },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vLocal;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLocal = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vLocal;\nuniform sampler2D uWood;\nuniform sampler2D uFoil;\nuniform float uLen;\nuniform float uInR;\nuniform float uTan;\nuniform float uLead;\nuniform vec3 uLeadCol;\nuniform vec3 uGold;",
      )
      .replace(
        "#include <color_fragment>",
        [
          "#include <color_fragment>",
          "float pAng = atan(vLocal.z, vLocal.x);",
          "float pTurn = mod(pAng + 6.2831853, 6.2831853);",
          "float pSeg = mod(pTurn, 1.0471976);",
          "float hexR = uInR / max(0.5, cos(pSeg - 0.5235988));",
          "float coneR = max(0.0, (uLen - vLocal.y) * uTan);",
          "float pEdge = max(0.004, fwidth(coneR - hexR) * 1.5);",
          "float woodMask = smoothstep(-pEdge, pEdge, hexR - coneR);",
          "float leadMask = smoothstep(uLead + pEdge, uLead - pEdge, coneR);",
          "vec3 woodCol = texture2D(uWood, vec2(pTurn / 6.2831853, vLocal.y / 36.0)).rgb;",
          "float faceIdx = floor(pTurn / 1.0471976);",
          "vec2 foilUv = vec2(pSeg / 1.0471976, (vLocal.y - 34.0) / 60.0);",
          "float foilIn = step(4.5, faceIdx) * step(faceIdx, 5.5) * step(0.0, foilUv.y) * step(foilUv.y, 1.0);",
          "float foilA = texture2D(uFoil, clamp(foilUv, 0.0, 1.0)).a * foilIn * (1.0 - woodMask);",
          "diffuseColor.rgb = mix(diffuseColor.rgb, uGold, foilA);",
          "diffuseColor.rgb = mix(diffuseColor.rgb, woodCol, woodMask);",
          "diffuseColor.rgb = mix(diffuseColor.rgb, uLeadCol, leadMask);",
        ].join("\n"),
      )
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor = mix(mix(roughnessFactor, 0.3, foilA), 0.74, woodMask);\nroughnessFactor = mix(roughnessFactor, 0.38, leadMask);",
      )
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = max(foilA, leadMask * 0.55);")
      .replace("#include <lights_physical_fragment>", "#include <lights_physical_fragment>\nmaterial.clearcoat *= (1.0 - woodMask) * (1.0 - foilA);");
  };
  m.customProgramCacheKey = () => "cassette-pencil";
  return m;
}

function hexCap(THREE) {
  const s = new THREE.Shape();
  const rc = PENCIL.inR / Math.cos(Math.PI / 6);
  for (let k = 0; k < 6; k += 1) {
    const a = (k * Math.PI) / 3;
    if (k === 0) s.moveTo(rc * Math.cos(a), rc * Math.sin(a));
    else s.lineTo(rc * Math.cos(a), rc * Math.sin(a));
  }
  s.closePath();
  const g = new THREE.ShapeGeometry(s);
  const uv = g.attributes.uv.array;
  const p = g.attributes.position.array;
  for (let i = 0; i < uv.length / 2; i += 1) {
    uv[i * 2] = 0.5 + p[i * 3] / (rc * 2.1);
    uv[i * 2 + 1] = 0.5 + p[i * 3 + 1] / (rc * 2.1);
  }
  g.rotateX(Math.PI / 2);
  return g;
}

function jcardGeometry(THREE) {
  const { width, front, spine, flap } = JCARD;
  const depth = front + spine + flap;
  const rows = Math.round(depth * 2);
  const g = new THREE.PlaneGeometry(width, depth, 1, rows);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position.array;
  const z0 = -depth / 2 + front;
  const z1 = z0 + spine;
  const t1 = Math.tan((5 * Math.PI) / 180);
  const t2 = Math.tan((13 * Math.PI) / 180);
  for (let i = 0; i < p.length / 3; i += 1) {
    const z = p[i * 3 + 2];
    let y = 0.18;
    if (z > z0) y += (Math.min(z, z1) - z0) * t1;
    if (z > z1) y += (z - z1) * t2;
    p[i * 3 + 1] = y;
  }
  g.computeVertexNormals();
  return g;
}

export function buildWorld(THREE, renderer, mix) {
  const disposables = [];
  const keep = (x) => {
    disposables.push(x);
    return x;
  };
  const root = new THREE.Group();

  const deskTex = keep(texture(THREE, renderer, deskCanvas(1024), { repeat: true }));
  deskTex.repeat.set(3, 3);
  deskTex.rotation = 0.06;
  const desk = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(1600, 1600)),
    keep(new THREE.MeshStandardMaterial({ map: deskTex, roughness: 0.62, metalness: 0, bumpMap: deskTex, bumpScale: 0.35 })),
  );
  desk.rotation.x = -Math.PI / 2;
  desk.receiveShadow = true;
  root.add(desk);

  const cassette = new THREE.Group();
  root.add(cassette);

  const shellMat = keep(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color("#e4e0dc"),
      metalness: 0,
      roughness: 0.09,
      transmission: 1,
      thickness: 2.2,
      ior: 1.52,
      attenuationColor: new THREE.Color("#746a63"),
      attenuationDistance: 6.5,
      specularIntensity: 1,
      clearcoat: 0.6,
      clearcoatRoughness: 0.06,
      envMapIntensity: 1.7,
    }),
  );
  const bevel = 0.7;
  const shellGeo = keep(
    new THREE.ExtrudeGeometry(shellShape(THREE), { depth: SHELL.h - bevel * 2, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 4, curveSegments: 48 }),
  );
  shellGeo.rotateX(-Math.PI / 2);
  shellGeo.translate(0, bevel, 0);
  const shell = new THREE.Mesh(shellGeo, shellMat);
  cassette.add(shell);

  const plateGeo = keep(new THREE.ExtrudeGeometry(plateShape(THREE), { depth: 0.4, bevelEnabled: true, bevelSize: 0.3, bevelThickness: 0.3, bevelSegments: 2, curveSegments: 24 }));
  plateGeo.rotateX(-Math.PI / 2);
  plateGeo.translate(0, SHELL.h - 0.2, 0);
  cassette.add(new THREE.Mesh(plateGeo, shellMat));

  const bossMat = keep(new THREE.MeshStandardMaterial({ color: new THREE.Color("#8d837b"), roughness: 0.3 }));
  const steel = keep(new THREE.MeshStandardMaterial({ color: new THREE.Color("#b9b6b2"), roughness: 0.32, metalness: 1 }));
  const slotMat = keep(new THREE.MeshStandardMaterial({ color: new THREE.Color("#2a2724"), roughness: 0.6, metalness: 0.6 }));
  const bossGeo = keep(new THREE.CylinderGeometry(2.3, 2.5, SHELL.h - 1.8, 24));
  const headGeo = keep(new THREE.CylinderGeometry(1.55, 1.7, 0.7, 28));
  const slotGeo = keep(new THREE.BoxGeometry(2.3, 0.4, 0.32));
  const screws = [
    [-44.6, -26.4, SHELL.h],
    [44.6, -26.4, SHELL.h],
    [-44.6, 26.2, SHELL.h],
    [44.6, 26.2, SHELL.h],
    [0, 21.5, SHELL.h + 0.6],
  ];
  for (const [x, z, top] of screws) {
    const boss = new THREE.Mesh(bossGeo, bossMat);
    boss.position.set(x, SHELL.h / 2, z);
    cassette.add(boss);
    const head = new THREE.Mesh(headGeo, steel);
    head.position.set(x, top + 0.2, z);
    head.castShadow = true;
    cassette.add(head);
    for (const rot of [0.35, 0.35 + Math.PI / 2]) {
      const slot = new THREE.Mesh(slotGeo, slotMat);
      slot.position.set(x, top + 0.42, z);
      slot.rotation.y = rot;
      cassette.add(slot);
    }
  }

  const nylon = keep(new THREE.MeshPhysicalMaterial({ color: new THREE.Color("#efe8da"), roughness: 0.42, clearcoat: 0.2, sheen: 0.3 }));
  const clampMat = keep(new THREE.MeshStandardMaterial({ color: new THREE.Color("#b9ae9c"), roughness: 0.5 }));
  const hubGeo = keep(new THREE.ExtrudeGeometry(hubShape(THREE), { depth: 4.2, bevelEnabled: true, bevelSize: 0.18, bevelThickness: 0.18, bevelSegments: 2, curveSegments: 40 }));
  hubGeo.rotateX(-Math.PI / 2);
  const clampGeo = keep(new THREE.BoxGeometry(1.5, 4.5, 2.8));
  const packTex = keep(texture(THREE, renderer, packCanvas(1024)));
  const packTopMat = keep(
    new THREE.MeshPhysicalMaterial({ map: packTex, color: new THREE.Color("#ffffff"), roughness: 0.3, metalness: 0.05, clearcoat: 0.35, clearcoatRoughness: 0.25, sheen: 0.6, sheenColor: new THREE.Color("#b07a4e"), sheenRoughness: 0.4 }),
  );
  const packSideMat = keep(new THREE.MeshStandardMaterial({ color: new THREE.Color("#3b2519"), roughness: 0.5 }));
  const packSideGeo = keep(new THREE.CylinderGeometry(1, 1, TAPE_HALF * 2, 128, 1, true));
  const hubs = HUBS.map((spec) => {
    const group = new THREE.Group();
    group.position.set(spec.x, 0, spec.z);
    const spin = new THREE.Group();
    group.add(spin);
    const hub = new THREE.Mesh(hubGeo, nylon);
    hub.position.y = TAPE_Y - 2.3;
    hub.castShadow = true;
    hub.receiveShadow = true;
    spin.add(hub);
    const clampMesh = new THREE.Mesh(clampGeo, clampMat);
    clampMesh.position.set(10.1, TAPE_Y, 0);
    spin.add(clampMesh);
    const topGeo = keep(packTop(THREE, 160));
    setPackTop(topGeo, CORE - 0.05, CORE + 4);
    const top = new THREE.Mesh(topGeo, packTopMat);
    top.position.y = TAPE_Y + TAPE_HALF;
    top.receiveShadow = true;
    spin.add(top);
    const side = new THREE.Mesh(packSideGeo, packSideMat);
    side.position.y = TAPE_Y;
    side.castShadow = true;
    group.add(side);
    cassette.add(group);
    return { group, spin, top, topGeo, side };
  });

  const rollerGeo = keep(new THREE.CylinderGeometry(ROLLER.r, ROLLER.r, 4.6, 32));
  const pinGeo = keep(new THREE.CylinderGeometry(0.75, 0.75, SHELL.h - 2, 16));
  for (const sign of [-1, 1]) {
    const roller = new THREE.Mesh(rollerGeo, nylon);
    roller.position.set(sign * ROLLER.x, TAPE_Y, ROLLER.z);
    cassette.add(roller);
    const axle = new THREE.Mesh(pinGeo, steel);
    axle.scale.set(0.6, 1, 0.6);
    axle.position.set(sign * ROLLER.x, SHELL.h / 2, ROLLER.z);
    cassette.add(axle);
    const pin = new THREE.Mesh(pinGeo, steel);
    pin.position.set(sign * (MOUTH.x + 1.6), SHELL.h / 2, MOUTH.z - 0.9);
    cassette.add(pin);
  }
  const felt = new THREE.Mesh(keep(new THREE.BoxGeometry(4, 3.4, 0.9)), keep(new THREE.MeshStandardMaterial({ color: new THREE.Color("#3d4a44"), roughness: 1 })));
  felt.position.set(0, TAPE_Y, MOUTH.z - 0.55);
  cassette.add(felt);
  const bronze = new THREE.Mesh(
    keep(new THREE.BoxGeometry(11, 3.2, 0.22)),
    keep(new THREE.MeshStandardMaterial({ color: new THREE.Color("#b58a4e"), roughness: 0.3, metalness: 1 })),
  );
  bronze.position.set(0, TAPE_Y, MOUTH.z - 1.15);
  cassette.add(bronze);
  const shield = new THREE.Mesh(keep(new THREE.BoxGeometry(6.5, 7, 0.3)), steel);
  shield.position.set(0, TAPE_Y, MOUTH.z - 1.7);
  cassette.add(shield);

  const tapeGeo = new THREE.BufferGeometry();
  keep(tapeGeo);
  const tapeMax = 260;
  tapeGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(tapeMax * 2 * 3), 3));
  tapeGeo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(tapeMax * 2 * 3), 3));
  const tapeIdx = [];
  for (let i = 0; i < tapeMax - 1; i += 1) {
    const a = i * 2;
    tapeIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  tapeGeo.setIndex(tapeIdx);
  tapeGeo.setDrawRange(0, 0);
  const tapeMat = keep(
    new THREE.MeshPhysicalMaterial({ color: new THREE.Color("#4a2c1c"), roughness: 0.26, metalness: 0.1, clearcoat: 0.6, clearcoatRoughness: 0.2, side: THREE.DoubleSide, sheen: 0.2, sheenColor: new THREE.Color("#a8764c") }),
  );
  const tape = new THREE.Mesh(tapeGeo, tapeMat);
  tape.castShadow = true;
  tape.receiveShadow = true;
  tape.frustumCulled = false;
  cassette.add(tape);

  const labelTex = keep(texture(THREE, renderer, labelCanvas(mix)));
  const label = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(76, 15)),
    keep(new THREE.MeshStandardMaterial({ map: labelTex, roughness: 0.82, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })),
  );
  label.rotation.x = -Math.PI / 2;
  label.position.set(0, SHELL.h + 0.04, -22.2);
  label.receiveShadow = true;
  cassette.add(label);

  const shadowTex = keep(texture(THREE, renderer, blobCanvas(256, 176, 26, 9), { srgb: false }));
  const contact = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(SHELL.w * 1.22, SHELL.d * 1.26)),
    keep(new THREE.MeshBasicMaterial({ color: 0x1a1008, alphaMap: shadowTex, transparent: true, opacity: 0.55, depthWrite: false })),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.06;
  contact.renderOrder = 1;
  cassette.add(contact);
  const castTex = keep(texture(THREE, renderer, blobCanvas(256, 176, 34, 22), { srgb: false }));
  const cast = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(SHELL.w * 1.34, SHELL.d * 1.5)),
    keep(new THREE.MeshBasicMaterial({ color: 0x2a1a0c, alphaMap: castTex, transparent: true, opacity: 0.42, depthWrite: false })),
  );
  cast.rotation.x = -Math.PI / 2;
  cast.position.set(8, 0.05, 9);
  cast.renderOrder = 1;
  cassette.add(cast);

  const jcard = new THREE.Group();
  const jTex = keep(texture(THREE, renderer, jcardCanvas(mix)));
  const jMesh = new THREE.Mesh(keep(jcardGeometry(THREE)), keep(new THREE.MeshStandardMaterial({ map: jTex, roughness: 0.9, side: THREE.DoubleSide })));
  jMesh.castShadow = true;
  jMesh.receiveShadow = true;
  jcard.add(jMesh);
  const counterCan = counterCanvas();
  const counterTex = keep(texture(THREE, renderer, counterCan, { mips: false }));
  counterTex.minFilter = THREE.LinearFilter;
  const counter = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(COUNTER.width, COUNTER.height)),
    keep(new THREE.MeshStandardMaterial({ map: counterTex, transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })),
  );
  counter.rotation.x = -Math.PI / 2;
  const jDepth = JCARD.front + JCARD.spine + JCARD.flap;
  counter.position.set(-JCARD.width / 2 + 80, 0.2, -jDepth / 2 + 59.2);
  counter.receiveShadow = true;
  jcard.add(counter);
  const jShadowTex = keep(texture(THREE, renderer, blobCanvas(200, 190, 20, 10), { srgb: false }));
  const jShadow = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(JCARD.width * 1.08, jDepth * 1.08)),
    keep(new THREE.MeshBasicMaterial({ color: 0x1a1008, alphaMap: jShadowTex, transparent: true, opacity: 0.16, depthWrite: false })),
  );
  jShadow.rotation.x = -Math.PI / 2;
  jShadow.position.y = 0.04;
  jcard.add(jShadow);
  root.add(jcard);

  const woodTex = keep(texture(THREE, renderer, pencilWoodCanvas(), { repeat: true }));
  const foilTex = keep(texture(THREE, renderer, foilCanvas(), { srgb: false }));
  const pencil = new THREE.Group();
  const pencilBody = new THREE.Mesh(keep(pencilGeometry(THREE)), keep(pencilMaterial(THREE, woodTex, foilTex)));
  pencilBody.castShadow = true;
  pencilBody.receiveShadow = true;
  pencil.add(pencilBody);
  const endTex = keep(texture(THREE, renderer, endGrainCanvas()));
  const cap = new THREE.Mesh(keep(hexCap(THREE)), keep(new THREE.MeshStandardMaterial({ map: endTex, roughness: 0.8, side: THREE.DoubleSide })));
  cap.position.y = 0.01;
  pencil.add(cap);
  const pencilHit = new THREE.Mesh(
    keep(new THREE.CylinderGeometry(7.5, 7.5, PENCIL.length + 6, 12)),
    keep(new THREE.MeshBasicMaterial({ visible: false })),
  );
  pencilHit.position.y = PENCIL.length / 2;
  pencil.add(pencilHit);
  root.add(pencil);

  const pShadowTex = keep(texture(THREE, renderer, blobCanvas(512, 64, 14, 9), { srgb: false }));
  const pencilShadow = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(PENCIL.length + 14, 14)),
    keep(new THREE.MeshBasicMaterial({ color: 0x1a1008, alphaMap: pShadowTex, transparent: true, opacity: 0.42, depthWrite: false })),
  );
  pencilShadow.rotation.x = -Math.PI / 2;
  pencilShadow.position.y = 0.05;
  pencilShadow.renderOrder = 1;
  root.add(pencilShadow);

  const dispose = () => {
    for (const d of disposables) d.dispose?.();
  };

  return { root, desk, cassette, hubs, tape, tapeGeo, tapeMax, label, labelTex, jTex, jcard, counter, counterCan, counterTex, pencil, pencilHit, pencilShadow, shell, dispose };
}
