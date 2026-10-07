import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const require = createRequire(join(ROOT, "package.json"));
const parser = require("@shaderfrog/glsl-parser");

const KNOWN = new Set([
  "gl_FragColor", "gl_FragCoord", "gl_Position", "gl_PointSize", "gl_PointCoord", "gl_FrontFacing", "gl_FragDepth", "gl_VertexID", "gl_InstanceID",
  "uv", "position", "normal", "color", "instanceMatrix", "instanceColor", "modelMatrix", "modelViewMatrix", "projectionMatrix", "viewMatrix", "normalMatrix", "cameraPosition", "isOrthographic",
  "texture2D", "texture", "textureCube", "texture2DProj", "texture2DLod", "textureLod", "texelFetch", "textureSize", "textureGrad",
  "radians", "degrees", "sin", "cos", "tan", "asin", "acos", "atan", "sinh", "cosh", "tanh", "pow", "exp", "log", "exp2", "log2", "sqrt", "inversesqrt", "abs", "sign",
  "floor", "trunc", "round", "roundEven", "ceil", "fract", "mod", "modf", "min", "max", "clamp", "mix", "step", "smoothstep", "isnan", "isinf", "length", "distance",
  "dot", "cross", "normalize", "faceforward", "reflect", "refract", "matrixCompMult", "outerProduct", "transpose", "determinant", "inverse", "lessThan", "lessThanEqual",
  "greaterThan", "greaterThanEqual", "equal", "notEqual", "any", "all", "not", "dFdx", "dFdy", "fwidth", "float", "int", "bool", "uint",
  "vec2", "vec3", "vec4", "ivec2", "ivec3", "ivec4", "uvec2", "uvec3", "uvec4", "bvec2", "bvec3", "bvec4", "mat2", "mat3", "mat4",
  "sampler2D", "samplerCube", "void", "true", "false", "floatBitsToInt", "floatBitsToUint", "intBitsToFloat", "uintBitsToFloat", "packHalf2x16", "unpackHalf2x16",
]);

function files(target) {
  const stat = statSync(target);
  if (stat.isFile()) return [target];
  const out = [];
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    const path = join(target, entry.name);
    if (entry.isDirectory()) out.push(...files(path));
    else if (/\.(jsx?|mjs|glsl|frag|vert)$/.test(entry.name)) out.push(path);
  }
  return out;
}

function shadersIn(source) {
  const found = [];
  const re = /`([^`]*?void\s+main\s*\([^`]*?)`/g;
  let match;
  while ((match = re.exec(source))) {
    const line = source.slice(0, match.index).split("\n").length;
    found.push({ code: match[1], line });
  }
  return found;
}

const defines = (code) => [...code.matchAll(/^\s*#define\s+(\w+)/gm)].map((m) => m[1]);

let failed = false;
const target = process.argv[2] ? (process.argv[2].startsWith("/") ? process.argv[2] : join(ROOT, process.argv[2])) : null;
if (!target) {
  console.log("usage: node scripts/lab-glsl-check.mjs src/app/lab/<slug>");
  process.exit(2);
}

let count = 0;
for (const file of files(target)) {
  const source = readFileSync(file, "utf-8");
  for (const shader of shadersIn(source)) {
    count += 1;
    const label = `${relative(ROOT, file)}:${shader.line}`;
    const macros = new Set(defines(shader.code));
    const cleaned = shader.code
      .replace(/\$\{[^}]*\}/g, "1.0")
      .split("\n")
      .map((l) => (/^\s*#/.test(l) ? "" : l))
      .join("\n");
    let ast;
    try {
      ast = parser.parse(cleaned, { quiet: true });
    } catch (error) {
      failed = true;
      console.log(`FAIL ${label} syntax: ${String(error.message).split("\n").slice(0, 3).join(" | ")}`);
      continue;
    }
    const undeclared = new Set();
    for (const scope of ast.scopes) {
      for (const [name, binding] of Object.entries(scope.bindings || {})) {
        if (!binding.declaration && !KNOWN.has(name) && !macros.has(name)) undeclared.add(name);
      }
      for (const [name, binding] of Object.entries(scope.functions || {})) {
        const declared = Object.values(binding || {}).some((b) => b?.declaration);
        if (!declared && !KNOWN.has(name) && !macros.has(name)) undeclared.add(`${name}()`);
      }
    }
    if (undeclared.size) {
      failed = true;
      console.log(`FAIL ${label} undeclared: ${[...undeclared].join(", ")}`);
    } else {
      console.log(`ok   ${label}`);
    }
  }
}
if (!count) console.log("no shaders found");
process.exit(failed ? 1 : 0);
