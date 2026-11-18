// Playwright from this folder's node_modules (`npm install` here), or from a
// global install when there is none (cloud sessions ship one).
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import path from "node:path";

const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch {
  const root = execSync("npm root -g").toString().trim();
  const candidates = [process.env.NODE_PATH, root, "/opt/node-tools/node_modules"].filter(Boolean);
  for (const c of candidates) { try { pw = createRequire(path.join(c, "_"))("playwright"); break; } catch {} }
  if (!pw) throw new Error("Playwright not found. Run `npm install` in tools/showreel.");
}
export const chromium = pw.chromium;
