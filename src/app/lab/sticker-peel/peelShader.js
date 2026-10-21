const NOISE = `
float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float vnoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  vec2 w = f * f * (3.0 - 2.0 * f);
  float a = hash12(cell);
  float b = hash12(cell + vec2(1.0, 0.0));
  float c = hash12(cell + vec2(0.0, 1.0));
  float d = hash12(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int k = 0; k < 4; k++) {
    sum += amp * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.7);
    amp *= 0.5;
  }
  return sum;
}
`;

export const SCENE_VS = `#version 300 es
precision highp float;
uniform mat3 uClipToScene;
out vec2 vScene;
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vec2 clip = corner * 2.0 - 1.0;
  vScene = (uClipToScene * vec3(clip, 1.0)).xy;
  gl_Position = vec4(clip, 0.0, 1.0);
}
`;

export const SCENE_FS = `#version 300 es
precision highp float;
uniform sampler2D uPhoto;
uniform sampler2D uMask;
uniform sampler2D uShadow;
uniform vec2 uRes;
uniform vec3 uGround;
uniform vec3 uDisc;
uniform vec2 uMaskRange;
uniform float uPxPerUnit;
uniform sampler2D uBase;
uniform float uCompose;
in vec2 vScene;
out vec4 outColor;
${NOISE}

float boxSdf(vec2 p, vec2 halfSize, float radius) {
  vec2 q = abs(p) - halfSize + radius;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

vec3 maskAt(vec2 p) {
  vec2 uv = (p - uMaskRange.x) / uMaskRange.y;
  return texture(uMask, uv).rgb;
}

vec3 compose(vec2 p, float px) {
  vec3 col = texture(uBase, gl_FragCoord.xy / uRes).rgb;
  float sleeveD = boxSdf(p, vec2(0.5), 0.012);
  if (sleeveD < 0.0 && p.x > uMaskRange.x && p.y > uMaskRange.x) {
    vec3 mask = maskAt(p);
    if (mask.r + mask.g < 0.0005) return col * (1.0 - (0.3 * texture(uShadow, gl_FragCoord.xy / uRes).r + 0.4 * texture(uShadow, gl_FragCoord.xy / uRes).g));
    vec3 sleeve = col;
    float residue = mask.r;
    float fibre = mask.g;
    vec2 e = vec2(0.0035, 0.0);
    float around = 0.25 * (maskAt(p + e.xy).r + maskAt(p - e.xy).r + maskAt(p + e.yx).r + maskAt(p - e.yx).r);
    float rim = clamp(abs(around - residue) * 3.0, 0.0, 1.0);
    vec3 film = sleeve * 0.86 + vec3(0.085, 0.08, 0.066);
    sleeve = mix(sleeve, film, residue * 0.78);
    float dust = smoothstep(0.82, 1.0, vnoise(p * 700.0)) * smoothstep(0.5, 0.9, vnoise(p * 90.0)) * residue;
    sleeve += vec3(0.1, 0.095, 0.085) * dust;
    sleeve *= 1.0 - rim * 0.22;
    float fibreTex = vnoise(vec2(p.x * 2400.0, p.y * 380.0)) * 0.6 + vnoise(p * 900.0) * 0.4;
    vec3 pulp = vec3(0.9, 0.885, 0.85) * (0.86 + 0.14 * fibreTex);
    float lifted = fibre * smoothstep(0.3, 0.62, fibreTex);
    sleeve = mix(sleeve, pulp, clamp(lifted * 1.4, 0.0, 1.0));

    vec2 light = normalize(vec2(1.0, 1.0));
    float sweep = dot(p, light);
    sleeve += vec3(residue * (0.035 + 0.09 * exp(-pow((sweep + 0.1) * 2.4, 2.0))));
    float inside = clamp(-sleeveD / max(px, 0.0001), 0.0, 1.0);
    col = mix(col, sleeve, inside);
  }
  vec2 sh = texture(uShadow, gl_FragCoord.xy / uRes).rg;
  return col * (1.0 - (0.3 * sh.r + 0.4 * sh.g));
}

void main() {
  vec2 p = vScene;
  float px = 1.0 / uPxPerUnit;
  if (uCompose > 0.5) {
    outColor = vec4(compose(p, px), 1.0);
    return;
  }
  vec3 col = uGround;

  float sleeveD = boxSdf(p, vec2(0.5), 0.012);
  float discD = length(p - uDisc.xy) - uDisc.z;
  vec2 castP = p - vec2(0.008, 0.018);
  float castD = min(boxSdf(castP, vec2(0.5), 0.01), length(castP - uDisc.xy) - uDisc.z);
  float softShadow = smoothstep(0.09, -0.03, castD) * 0.2;
  float midShadow = smoothstep(0.03, -0.01, castD) * 0.14;
  float contactD = min(boxSdf(p - vec2(0.002, 0.004), vec2(0.5), 0.006), length(p - vec2(0.002, 0.004) - uDisc.xy) - uDisc.z);
  float contact = smoothstep(0.006, -0.001, contactD) * 0.24;
  col *= 1.0 - (softShadow + midShadow + contact);

  float discCover = clamp(0.5 - discD / max(fwidth(discD), px), 0.0, 1.0);
  if (discCover > 0.0) {
    vec2 q = p - uDisc.xy;
    float r = length(q);
    float ang = atan(q.y, q.x);
    float groovePhase = r * 2200.0;
    float grooveAa = clamp(1.0 - fwidth(groovePhase) * 0.6, 0.0, 1.0);
    float groove = 0.5 + 0.5 * sin(groovePhase) * grooveAa;
    float band = smoothstep(0.43, 0.432, r) * (1.0 - smoothstep(0.476, 0.478, r));
    float sheen = pow(abs(cos(ang + 0.95)), 14.0) * 0.32 + pow(abs(cos(ang + 0.95)), 3.0) * 0.06;
    vec3 vinyl = vec3(0.045, 0.045, 0.05);
    vinyl += vec3(0.9, 0.92, 1.0) * sheen * (0.55 + 0.45 * groove) * (0.4 + 0.6 * band);
    vinyl += vec3(0.02) * groove;
    float lip = smoothstep(uDisc.z - 0.006, uDisc.z - 0.001, r);
    vinyl += vec3(0.16) * lip * (0.5 + 0.5 * cos(ang + 2.2));
    float underSleeve = smoothstep(0.045, 0.0, p.x - 0.5);
    vinyl *= 1.0 - 0.75 * underSleeve;
    col = mix(col, vinyl, discCover);
  }

  float sleeveCover = clamp(0.5 - sleeveD / max(fwidth(sleeveD), px), 0.0, 1.0);
  if (sleeveCover > 0.0) {
    vec2 uv = p + 0.5;
    vec3 photo = texture(uPhoto, uv).rgb;
    vec3 mask = maskAt(p);
    float ghost = mask.b;
    vec3 faded = mix(photo, vec3(0.6, 0.585, 0.56), 0.12);
    vec3 art = mix(faded, photo * 0.97, ghost * 0.75);
    float grain = vnoise(p * 1500.0) - 0.5;
    float grit = hash12(floor(p * 2600.0)) - 0.5;
    art += grain * 0.05 + grit * 0.025;

    float edgeD = -sleeveD;
    float cornerness = smoothstep(0.045, 0.0, length(abs(p) - 0.5));
    float edgeSoft = (1.0 - smoothstep(0.0, 0.006, edgeD)) * (0.22 + 0.12 * fbm(p * 18.0));
    float cornerSoft = (1.0 - smoothstep(0.0, 0.022, edgeD)) * clamp(cornerness, 0.0, 1.0) * (0.35 + 0.25 * fbm(p * 24.0));
    float edgeWear = max(edgeSoft, cornerSoft);

    vec2 rc = p - vec2(0.012, 0.004);
    float rr = length(rc);
    float ang = atan(rc.y, rc.x);
    float ringBand = exp(-pow((rr - 0.463) / 0.011, 2.0));
    float ringSide = 0.35 + 0.65 * smoothstep(-0.2, 0.9, sin(ang + 0.7));
    float ringBreak = smoothstep(0.38, 0.66, fbm(vec2(ang * 7.0, rr * 30.0)));
    float labelRing = exp(-pow((rr - 0.168) / 0.006, 2.0)) * smoothstep(0.45, 0.75, fbm(vec2(ang * 11.0, 3.0)));
    float speck = smoothstep(0.35, 0.75, vnoise(p * 620.0));
    float wear = clamp(ringBand * ringSide * ringBreak * 1.1 + labelRing * 0.35, 0.0, 1.0) * speck;
    wear = max(wear * 0.8, edgeWear);
    vec3 card = vec3(0.83, 0.81, 0.77) * (0.92 + 0.08 * vnoise(vec2(p.x * 1800.0, p.y * 300.0)));
    vec3 sleeve = mix(art, card, wear * 0.62);

    vec2 light = normalize(vec2(1.0, 1.0));
    float sweep = dot(p, light);
    float sheen = exp(-pow((sweep + 0.18) * 2.6, 2.0)) * 0.05;
    sheen *= 1.0 - 0.6 * wear;
    sleeve += vec3(sheen);
    sleeve *= 0.97 + 0.03 * smoothstep(0.7, -0.5, sweep);

    float rimLight = (1.0 - smoothstep(0.0, 1.6 * px, edgeD));
    float facing = clamp(dot(-normalize(p + 0.0001), light) * 0.5 + 0.5, 0.0, 1.0);
    sleeve = mix(sleeve, sleeve * 0.7 + vec3(0.32), rimLight * facing * 0.5);
    col = mix(col, sleeve, sleeveCover);
  }

  outColor = vec4(col, 1.0);
}
`;

export const STICKER_VS = `#version 300 es
precision highp float;
in vec2 aUv;
uniform mat3 uSceneToClip;
uniform vec2 uOrigin;
uniform vec2 uAxis;
uniform vec2 uSize;
uniform vec2 uP0;
uniform vec2 uDir;
uniform vec4 uCurl;
uniform float uLayer;
uniform vec3 uCam;
uniform vec2 uLightShift;
uniform float uShadowMode;
out vec2 vUv;
out vec3 vNormal;
out float vZ;
out float vSigma;

void main() {
  vec2 local = (aUv - 0.5) * uSize;
  vec2 flat2 = uOrigin + vec2(uAxis.x * local.x - uAxis.y * local.y, uAxis.y * local.x + uAxis.x * local.y);
  float peel = uCurl.x;
  float radius = max(uCurl.y, 0.00001);
  float phi = uCurl.z;
  float lift = uCurl.w;
  float s = dot(flat2 - uP0, uDir);
  float sigma = peel - s;
  vec3 pos = vec3(flat2, 0.0);
  vec3 normal = vec3(0.0, 0.0, 1.0);
  if (sigma > 0.0 && peel > 0.00001) {
    float arc = radius * phi;
    float theta = phi;
    float t;
    float z;
    if (sigma < arc) {
      theta = sigma / radius;
      t = peel - radius * sin(theta);
      z = radius * (1.0 - cos(theta));
    } else {
      float rest = sigma - arc;
      t = peel - radius * sin(phi) - rest * cos(phi);
      z = radius * (1.0 - cos(phi)) + rest * sin(phi);
    }
    pos.xy = flat2 + uDir * (t - s);
    pos.z = z;
    normal = vec3(uDir * sin(theta), cos(theta));
  }
  pos.z += lift;
  vUv = aUv;
  vNormal = normal;
  vZ = pos.z;
  vSigma = sigma;
  vec2 projected;
  if (uShadowMode > 0.5) {
    projected = pos.xy + uLightShift * pos.z + uLightShift * 0.012;
  } else {
    projected = pos.xy + (pos.xy - uCam.xy) * (pos.z / (uCam.z - pos.z));
  }
  vec3 clip = uSceneToClip * vec3(projected, 1.0);
  float depth = 0.5 - clamp(pos.z, 0.0, 0.5) * 0.9 - uLayer * 0.004;
  gl_Position = vec4(clip.xy, depth, 1.0);
}
`;

export const STICKER_FS = `#version 300 es
precision highp float;
uniform sampler2D uArt;
uniform sampler2D uShadow;
uniform vec2 uRes;
uniform vec3 uBacking;
uniform vec4 uMaterial;
uniform vec4 uCurl;
in vec2 vUv;
in vec3 vNormal;
in float vZ;
in float vSigma;
out vec4 outColor;
${NOISE}

void main() {
  vec4 art = texture(uArt, vUv);
  if (art.a < 0.004) discard;
  vec3 base = art.rgb / art.a;
  vec3 n = normalize(vNormal);
  bool front = n.z >= 0.0;
  vec3 facingN = front ? n : -n;
  vec3 lightDir = normalize(vec3(-0.42, -0.62, 0.66));
  vec3 halfV = normalize(lightDir + vec3(0.0, 0.0, 1.0));
  float diffuse = max(dot(facingN, lightDir), 0.0);
  float flatDiffuse = 0.66;
  float shade = (0.5 + 0.5 * diffuse) / (0.5 + 0.5 * flatDiffuse);
  float gloss = uMaterial.x;
  float shine = uMaterial.y;
  float translucent = uMaterial.z;
  float spec = pow(max(dot(facingN, halfV), 0.0), shine);
  float flatSpec = pow(max(dot(vec3(0.0, 0.0, 1.0), halfV), 0.0), shine);
  float curled = smoothstep(0.0005, 0.006, vSigma);
  vec3 col;
  if (front) {
    float held = smoothstep(0.004, 0.03, vZ);
    shade = mix(shade, max(shade, 0.98 + 0.06 * diffuse), held);
    col = base * shade + vec3(gloss * max(spec - flatSpec * (1.0 - curled), 0.0));
    col += vec3(0.05) * curled * diffuse * gloss;
  } else {
    float tooth = vnoise(vUv * vec2(380.0, 380.0 * uMaterial.w));
    vec3 backing = uBacking * (0.95 + 0.05 * tooth);
    vec3 seen = mix(backing, backing * base, translucent);
    float radius = max(uCurl.y, 0.00001);
    float theta = clamp(vSigma / radius, 0.0, uCurl.z);
    float onRoll = 1.0 - smoothstep(uCurl.z * 0.8, uCurl.z, theta);
    float roll = exp(-pow((theta - 1.85) / 0.42, 2.0)) * onRoll;
    float diffuseB = max(dot(facingN, lightDir), 0.0);
    float sticky = pow(max(dot(facingN, halfV), 0.0), 26.0) * 0.12;
    col = seen * (0.9 + 0.16 * diffuseB) + vec3(0.22) * roll + vec3(sticky);
  }
  float creaseR = max(uCurl.y, 0.00001);
  float crease = exp(-max(vSigma, 0.0) / (creaseR * 0.4)) * smoothstep(0.0, 0.0006, vSigma);
  col *= 1.0 - 0.38 * crease;
  float sh = texture(uShadow, gl_FragCoord.xy / uRes).g;
  float grounded = 1.0 - smoothstep(0.0005, 0.004, vZ);
  col *= 1.0 - 0.42 * sh * grounded;
  outColor = vec4(col * art.a, art.a);
}
`;

export const SHADOW_FS = `#version 300 es
precision highp float;
uniform sampler2D uArt;
in vec2 vUv;
in vec3 vNormal;
in float vZ;
in float vSigma;
out vec4 outColor;
void main() {
  float a = texture(uArt, vUv).a;
  if (a < 0.004) discard;
  float contact = (1.0 - smoothstep(0.0008, 0.004, vZ)) * a;
  float lifted = smoothstep(0.0008, 0.01, vZ) * (1.0 - 0.55 * smoothstep(0.03, 0.12, vZ)) * a;
  outColor = vec4(contact, lifted, 0.0, 1.0);
}
`;

export const BLUR_VS = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = corner;
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const BLUR_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uStep;
in vec2 vUv;
out vec4 outColor;
void main() {
  float tight = 0.0;
  float soft = 0.0;
  float tightSum = 0.0;
  float softSum = 0.0;
  for (int i = -4; i <= 4; i++) {
    float f = float(i);
    float wt = exp(-f * f / 6.0);
    float ws = exp(-f * f / 8.0);
    tight += texture(uSrc, vUv + uStep * f * 0.4).r * wt;
    soft += texture(uSrc, vUv + uStep * f * 1.5).g * ws;
    tightSum += wt;
    softSum += ws;
  }
  outColor = vec4(tight / tightSum, soft / softSum, 0.0, 1.0);
}
`;

export const RESIDUE_VS = `#version 300 es
precision highp float;
in vec2 aUv;
uniform vec2 uOrigin;
uniform vec2 uAxis;
uniform vec2 uSize;
uniform vec2 uMaskRange;
out vec2 vUv;
out vec2 vFlat;
void main() {
  vec2 local = (aUv - 0.5) * uSize;
  vec2 flat2 = uOrigin + vec2(uAxis.x * local.x - uAxis.y * local.y, uAxis.y * local.x + uAxis.x * local.y);
  vUv = aUv;
  vFlat = flat2;
  vec2 m = (flat2 - uMaskRange.x) / uMaskRange.y;
  gl_Position = vec4(m * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const RESIDUE_FS = `#version 300 es
precision highp float;
uniform sampler2D uArt;
uniform vec2 uP0;
uniform vec2 uDir;
uniform float uPeel;
uniform vec3 uGlue;
uniform float uGhost;
uniform vec2 uSize;
in vec2 vUv;
in vec2 vFlat;
out vec4 outColor;
${NOISE}

void main() {
  float a = texture(uArt, vUv).a;
  if (a < 0.02) discard;
  if (uGhost > 0.5) {
    outColor = vec4(0.0, 0.0, smoothstep(0.3, 0.9, a), 1.0);
    return;
  }
  float s = dot(vFlat - uP0, uDir);
  if (s > uPeel) discard;
  vec2 edgeDist = min(vUv, 1.0 - vUv) * uSize;
  float edge = 1.0 - smoothstep(0.0, 0.012, min(edgeDist.x, edgeDist.y));
  float clouds = fbm(vFlat * 42.0 + uGlue.z * 13.0);
  float blotch = smoothstep(0.32, 0.7, clouds);
  float residue = uGlue.x * clamp(0.45 + 0.55 * blotch + 0.3 * edge, 0.0, 1.0) * smoothstep(0.2, 0.9, a);
  float tearField = fbm(vFlat * 95.0 + uGlue.z * 7.0 + 40.0);
  float tear = uGlue.y * smoothstep(0.6, 0.8, tearField) * (0.35 + 0.65 * edge) * smoothstep(0.4, 0.95, a);
  outColor = vec4(residue * 0.9, tear, 0.0, 1.0);
}
`;

export const STRAND_VS = `#version 300 es
precision highp float;
in vec3 aPos;
in vec2 aAcross;
uniform mat3 uSceneToClip;
uniform vec3 uCam;
uniform vec2 uLightShift;
uniform float uShadowMode;
out vec2 vAcross;
void main() {
  vec2 projected;
  float depth;
  if (uShadowMode > 0.5) {
    projected = aPos.xy + uLightShift * aPos.z;
    depth = 0.49;
  } else {
    projected = aPos.xy + (aPos.xy - uCam.xy) * (aPos.z / (uCam.z - aPos.z));
    depth = 0.5 - clamp(aPos.z, 0.0, 0.5) * 0.9 - 0.02;
  }
  vec3 clip = uSceneToClip * vec3(projected, 1.0);
  vAcross = aAcross;
  gl_Position = vec4(clip.xy, depth, 1.0);
}
`;

export const STRAND_FS = `#version 300 es
precision highp float;
uniform float uShadowMode;
in vec2 vAcross;
out vec4 outColor;
void main() {
  float x = vAcross.x;
  float coverage = vAcross.y;
  float edge = 1.0 - smoothstep(0.55, 1.0, abs(x));
  if (uShadowMode > 0.5) {
    float a = edge * coverage * 0.16;
    outColor = vec4(0.0, 0.0, 0.0, a);
    return;
  }
  float body = sqrt(max(1.0 - x * x, 0.0));
  float highlight = pow(max(1.0 - abs(x + 0.3) / 0.3, 0.0), 2.0);
  vec3 glue = vec3(0.96, 0.89, 0.74) * (0.62 + 0.38 * body);
  vec3 col = glue + vec3(0.7) * highlight;
  float a = edge * coverage * (0.78 + 0.22 * highlight);
  outColor = vec4(col * a, a);
}
`;
