export const PRINTER = {
  halfW: 60,
  depth: 104,
  top: 40,
  exitY: 37.4,
  exitZ: -1.2,
  exitAngle: -0.3,
  rollZ: 76,
  rollFloor: 7,
  slotZ: 47,
  feedZ: 30,
  rollMax: 26,
  rollCore: 8.5,
};

function ringCanvas(size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const c = size / 2;
  ctx.fillStyle = "#f2f1ec";
  ctx.fillRect(0, 0, size, size);
  for (let r = c; r > 0; r -= 1.5) {
    const shade = 236 + Math.round(Math.sin(r * 1.7) * 6 + Math.sin(r * 0.31) * 4);
    ctx.strokeStyle = `rgb(${shade - 4} ${shade - 3} ${shade - 6})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  return canvas;
}

function grainCanvas(size, base, spread, seed) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(size, size);
  let s = seed;
  for (let i = 0; i < size * size; i += 1) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const n = (s / 4294967296 - 0.5) * spread;
    img.data[i * 4] = base[0] + n;
    img.data[i * 4 + 1] = base[1] + n;
    img.data[i * 4 + 2] = base[2] + n;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export async function buildPrinter(THREE) {
  const { RoundedBoxGeometry } = await import("three/examples/jsm/geometries/RoundedBoxGeometry.js");
  const P = PRINTER;
  const group = new THREE.Group();
  const disposables = [];
  const keep = (x) => {
    disposables.push(x);
    return x;
  };

  const grain = keep(new THREE.CanvasTexture(grainCanvas(128, [128, 128, 128], 40, 7)));
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  grain.repeat.set(6, 6);
  const shell = keep(
    new THREE.MeshStandardMaterial({ color: 0x2e2e31, roughness: 0.62, metalness: 0.0, roughnessMap: grain, envMapIntensity: 0.6 }),
  );
  const shellDark = keep(new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.7, metalness: 0 }));
  const steel = keep(new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.32, metalness: 1, envMapIntensity: 1.1 }));
  const slit = keep(new THREE.MeshBasicMaterial({ color: 0x0b0b0c }));
  const button = keep(new THREE.MeshStandardMaterial({ color: 0x3a3a3e, roughness: 0.48, metalness: 0 }));
  const led = keep(new THREE.MeshStandardMaterial({ color: 0x1b3a22, emissive: 0x39e06a, emissiveIntensity: 0.9, roughness: 0.3 }));

  const add = (geometry, material, x, y, z, opts = {}) => {
    keep(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = opts.cast !== false;
    mesh.receiveShadow = true;
    if (opts.rot) mesh.rotation.set(...opts.rot);
    group.add(mesh);
    return mesh;
  };

  const frontD = P.slotZ + 4;
  add(new RoundedBoxGeometry(P.halfW * 2, P.top, frontD, 5, 6), shell, 0, P.top / 2, frontD / 2);
  const cheekW = 11;
  const rearZ0 = frontD - 6;
  const rearD = P.depth - rearZ0;
  add(new RoundedBoxGeometry(cheekW, 34, rearD, 4, 5), shell, -P.halfW + cheekW / 2, 17, rearZ0 + rearD / 2);
  add(new RoundedBoxGeometry(cheekW, 34, rearD, 4, 5), shell, P.halfW - cheekW / 2, 17, rearZ0 + rearD / 2);
  add(new RoundedBoxGeometry(P.halfW * 2, 15, 10, 4, 4), shell, 0, 7.5, P.depth - 5);
  add(new RoundedBoxGeometry(P.halfW * 2 - cheekW * 2 + 2, P.rollFloor, rearD - 8, 2, 2), shellDark, 0, P.rollFloor / 2, rearZ0 + rearD / 2 - 2);

  add(new THREE.BoxGeometry(92, 2.6, 1.2), slit, 0, P.exitY + 0.2, 0.2, { cast: false });
  add(new THREE.BoxGeometry(88, 0.6, 3.2), slit, 0, P.top + 0.05, P.feedZ, { cast: false });

  const teeth = new THREE.Shape();
  const half = 45;
  const pitch = 2.6;
  teeth.moveTo(-half, 4);
  teeth.lineTo(-half, 0);
  for (let x = -half; x < half - 0.01; x += pitch) {
    teeth.lineTo(x + pitch / 2, -1.6);
    teeth.lineTo(Math.min(half, x + pitch), 0);
  }
  teeth.lineTo(half, 4);
  teeth.lineTo(-half, 4);
  const blade = keep(new THREE.ExtrudeGeometry(teeth, { depth: 0.5, bevelEnabled: false }));
  blade.rotateX(Math.PI / 2);
  const bladeMesh = new THREE.Mesh(blade, steel);
  bladeMesh.position.set(0, P.exitY + 1.5, 0.5);
  bladeMesh.rotation.x = -0.18;
  bladeMesh.castShadow = true;
  group.add(bladeMesh);
  add(new RoundedBoxGeometry(96, 2.2, 6, 1, 1), shell, 0, P.exitY + 2.8, 2.6);

  const feed = add(new RoundedBoxGeometry(15, 2.4, 8, 2, 1.1), button, -40, P.top + 0.6, 20);
  add(new THREE.CylinderGeometry(1.4, 1.4, 0.8, 20), led, 44, P.top + 0.3, 20, { cast: false });

  const ringTex = keep(new THREE.CanvasTexture(ringCanvas(256)));
  ringTex.colorSpace = THREE.SRGBColorSpace;
  const rollSide = keep(new THREE.MeshStandardMaterial({ color: 0xf3f2ee, roughness: 0.6 }));
  const rollEnd = keep(new THREE.MeshStandardMaterial({ map: ringTex, roughness: 0.75 }));
  const core = keep(new THREE.MeshStandardMaterial({ color: 0xb59a74, roughness: 0.85 }));
  const hole = keep(new THREE.MeshBasicMaterial({ color: 0x2a241d }));
  const rollGeo = keep(new THREE.CylinderGeometry(1, 1, 79, 64, 1, false));
  rollGeo.rotateZ(Math.PI / 2);
  const roll = new THREE.Mesh(rollGeo, [rollSide, rollEnd, rollEnd]);
  roll.castShadow = true;
  roll.receiveShadow = true;
  group.add(roll);
  const coreGeo = keep(new THREE.CylinderGeometry(P.rollCore, P.rollCore, 79.6, 32, 1, true));
  coreGeo.rotateZ(Math.PI / 2);
  const coreMesh = new THREE.Mesh(coreGeo, core);
  group.add(coreMesh);
  const holeGeo = keep(new THREE.CylinderGeometry(P.rollCore - 1.2, P.rollCore - 1.2, 79.8, 32, 1, false));
  holeGeo.rotateZ(Math.PI / 2);
  const holeMesh = new THREE.Mesh(holeGeo, hole);
  group.add(holeMesh);

  const webGeo = keep(new THREE.PlaneGeometry(80, 1));
  const webMat = keep(new THREE.MeshStandardMaterial({ color: 0xf3f2ee, roughness: 0.6, side: THREE.DoubleSide }));
  const web = new THREE.Mesh(webGeo, webMat);
  web.castShadow = true;
  web.receiveShadow = true;
  group.add(web);

  const hits = group.children.filter((m) => m.isMesh);

  function setRoll(radius, angle) {
    const cy = P.rollFloor + radius + 0.4;
    roll.scale.set(1, radius, radius);
    roll.position.set(0, cy, P.rollZ);
    roll.rotation.x = angle;
    coreMesh.position.set(0, cy, P.rollZ);
    holeMesh.position.set(0, cy, P.rollZ);
    const sx = P.feedZ;
    const sy = P.top + 0.4;
    const dz = P.rollZ - sx;
    const dy = cy - sy;
    const dist = Math.hypot(dz, dy);
    const base = Math.atan2(dy, dz);
    const off = Math.acos(Math.min(1, radius / dist));
    const tangentAngle = base + Math.PI - off;
    const tz = P.rollZ + Math.cos(tangentAngle) * radius;
    const ty = cy + Math.sin(tangentAngle) * radius;
    const ez = sx;
    const ey = sy;
    const len = Math.hypot(tz - ez, ty - ey);
    web.scale.set(1, len, 1);
    web.position.set(0, (ty + ey) / 2, (tz + ez) / 2);
    web.rotation.set(Math.atan2(tz - ez, ty - ey), 0, 0);
  }

  function setLed(level) {
    led.emissiveIntensity = 0.35 + 1.4 * level;
  }

  function pressFeed(depth) {
    feed.position.y = P.top + 0.6 - depth * 1.1;
  }

  setRoll(P.rollMax, 0);

  function dispose() {
    for (const d of disposables) d.dispose();
  }

  return { group, hits, setRoll, setLed, pressFeed, dispose };
}
