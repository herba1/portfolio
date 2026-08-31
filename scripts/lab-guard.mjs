import { resolve } from "node:path";

let raw = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  let payload = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = {};
  }
  const allowed = process.env.LAB_ALLOWED_DIR;
  if (!allowed) process.exit(0);
  const input = payload.tool_input || {};
  const target = input.file_path || input.notebook_path || input.path;
  if (!target) process.exit(0);
  const full = resolve(process.cwd(), target);
  const root = resolve(process.cwd(), allowed);
  if (full === root || full.startsWith(root + "/")) process.exit(0);
  console.error(`Writes are limited to ${allowed}. Refused: ${target}`);
  process.exit(2);
});
