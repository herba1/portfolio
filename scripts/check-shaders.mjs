import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const parser = require("@shaderfrog/glsl-parser");

const BUILTIN = new Set([
  "gl_FragColor", "gl_FragCoord", "gl_Position", "gl_PointSize", "gl_PointCoord",
  "gl_FrontFacing", "gl_FragDepth", "gl_VertexID", "gl_InstanceID",
  "uv", "position", "normal", "modelMatrix", "modelViewMatrix", "projectionMatrix",
  "viewMatrix", "normalMatrix", "cameraPosition", "isOrthographic",
  "texture2D", "texture", "textureCube", "texture2DProj", "texture2DLod",
  "radians", "degrees", "sin", "cos", "tan", "asin", "acos", "atan", "sinh", "cosh",
  "tanh", "pow", "exp", "log", "exp2", "log2", "sqrt", "inversesqrt", "abs", "sign",
  "floor", "trunc", "round", "roundEven", "ceil", "fract", "mod", "modf", "min",
  "max", "clamp", "mix", "step", "smoothstep", "isnan", "isinf", "length", "distance",
  "dot", "cross", "normalize", "faceforward", "reflect", "refract", "matrixCompMult",
  "outerProduct", "transpose", "determinant", "inverse", "lessThan", "lessThanEqual",
  "greaterThan", "greaterThanEqual", "equal", "notEqual", "any", "all", "not",
  "dFdx", "dFdy", "fwidth", "float", "int", "bool", "uint",
  "vec2", "vec3", "vec4", "ivec2", "ivec3", "ivec4", "bvec2", "bvec3", "bvec4",
  "mat2", "mat3", "mat4", "sampler2D", "samplerCube", "void", "true", "false",
]);

const TYPES =
  "float|int|bool|uint|vec2|vec3|vec4|ivec2|ivec3|ivec4|bvec2|bvec3|bvec4|mat2|mat3|mat4";

function extractShaders(file) {
  const src = fs.readFileSync(file, "utf8");
  const out = [];
  const re = /export const (\w+) = \/\* glsl \*\/ `([\s\S]*?)`;/g;
  let m;
  while ((m = re.exec(src))) out.push({ name: m[1], code: m[2], file });
  return out;
}

function duplicateDeclarations(code) {
  const lines = code.split("\n");
  const problems = [];
  let depth = 0;
  let scopeStack = [new Map()];
  lines.forEach((line, i) => {
    const declRe = new RegExp(`^\\s*(?:const\\s+)?(${TYPES})\\s+(\\w+)\\s*[=;\\[]`);
    const m = line.match(declRe);
    if (m) {
      const scope = scopeStack[scopeStack.length - 1];
      if (scope.has(m[2])) {
        problems.push(
          `line ${i + 1}: '${m[2]}' redeclared (first at line ${scope.get(m[2])}) — ${line.trim()}`,
        );
      } else {
        scope.set(m[2], i + 1);
      }
    }
    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;
    for (let k = 0; k < opens; k++) {
      scopeStack.push(new Map());
      depth++;
    }
    for (let k = 0; k < closes; k++) {
      scopeStack.pop();
      depth--;
      if (scopeStack.length === 0) scopeStack = [new Map()];
    }
  });
  return problems;
}

function shaderFiles() {
  const given = process.argv.slice(2);
  if (given.length) return given;
  const roots = fs.readdirSync("src/app", { withFileTypes: true });
  const found = [];
  for (const dir of roots) {
    if (!dir.isDirectory()) continue;
    for (const entry of fs.readdirSync(`src/app/${dir.name}`)) {
      if (entry.endsWith("Shader.js")) found.push(`src/app/${dir.name}/${entry}`);
    }
  }
  return found;
}

let failed = false;
const files = shaderFiles();

for (const file of files) {
  for (const shader of extractShaders(file)) {
    const label = `${file.split("/").slice(-1)[0]}:${shader.name}`;
    let ast = null;
    try {
      ast = parser.parse(shader.code, { quiet: true });
    } catch (error) {
      failed = true;
      console.log(`FAIL ${label} — syntax: ${error.message.split("\n")[0]}`);
      continue;
    }

    const undeclared = [];
    for (const scope of ast.scopes) {
      for (const [name, binding] of Object.entries(scope.bindings || {})) {
        if (!binding.declaration && !BUILTIN.has(name)) undeclared.push(name);
      }
    }

    const dupes = duplicateDeclarations(shader.code);

    if (undeclared.length || dupes.length) {
      failed = true;
      console.log(`FAIL ${label}`);
      for (const d of dupes) console.log(`   redefinition ${d}`);
      for (const u of [...new Set(undeclared)]) console.log(`   undeclared '${u}'`);
    } else {
      console.log(`ok   ${label}`);
    }
  }
}

process.exit(failed ? 1 : 0);
