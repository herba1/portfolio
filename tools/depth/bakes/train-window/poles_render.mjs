// Render the train window's pole keys from the train's camera.
//
//   node tools/depth/bakes/train-window/poles_render.mjs <model dir> <hdr> <out dir> [head|trunk] [first] [count]
//
// <model dir> holds Poly Haven `modular_electricity_poles` 2k glTF (CC0),
// <hdr> the field plate `rural_asphalt_road` (any size, CC0). Writes one
// float32 RGBA render (bottom-up, premultiplied linear) per key, 2x
// supersampled, plus cells-<region>.json; poles.py turns them into the atlases.
// Renders in software GL (slow): pass first/count to split the work.
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, createReadStream, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "../../../factory/lib.mjs";
import { POLE_GEOM, POLE_REGIONS, poleCells } from "../../../../src/app/lab/train-window/poleKeys.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../../../..");
const [model, hdr, out, region = "head", first = "0", count = "999"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const R = POLE_REGIONS[region];
const layout = poleCells(R);
const SS = 2;
// plane-y rows: fine enough for twice the densest atan(y) row
const yMin2 = R.y0 < 0 && R.y1 > 0 ? 0 : Math.min(R.y0 * R.y0, R.y1 * R.y1);
const rowsPerUnit = (R.rowsPerDeg * 180) / Math.PI / (1 + yMin2);
const H = Math.ceil(SS * rowsPerUnit * (R.y1 - R.y0));
const jobs = layout.cells.slice(+first, +first + +count).map((c) => ({
  name: `${region}_${c.px.toFixed(2)}.f32`,
  px: c.px,
  l: -c.hw,
  r: c.hw,
  t: R.y1,
  b: R.y0,
  W: c.w * SS,
  H,
}));
writeFileSync(join(out, `cells-${region}.json`), JSON.stringify({ region: R, ...layout, H, SS }, null, 1));

const cfg = {
  preset: "preset_01_",
  exclude: ["fastener", "fastener_loop"], // the guy wire
  rot: -Math.PI / 2,
  scale: POLE_GEOM.scale,
  D: POLE_GEOM.D,
  camH: POLE_GEOM.camH,
  jobs,
};
const three = join(ROOT, "node_modules/three");
const server = createServer((req, res) => {
  const u = decodeURIComponent(req.url.split("?")[0]);
  if (req.method === "POST" && u.startsWith("/out/")) {
    const chunks = [];
    req.on("data", (d) => chunks.push(d));
    req.on("end", () => {
      writeFileSync(join(out, u.slice(5)), Buffer.concat(chunks));
      console.log("wrote", u.slice(5));
      res.end("ok");
    });
    return;
  }
  let f = null;
  if (u === "/" || u === "/index.html") f = join(HERE, "poles_render.html");
  else if (u === "/jobs.json") return res.end(JSON.stringify(cfg));
  else if (u === "/env.hdr") f = hdr;
  else if (u === "/three.module.js" || u === "/three.core.js") f = join(three, "build", u.slice(1));
  else if (u.startsWith("/jsm/")) f = join(three, "examples", u);
  else if (u.startsWith("/model/")) f = join(model, u.slice(7));
  if (!f || !existsSync(f)) {
    res.statusCode = 404;
    return res.end();
  }
  res.setHeader("content-type", f.endsWith(".js") ? "text/javascript" : f.endsWith(".html") ? "text/html" : "application/octet-stream");
  createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const browser = await launch();
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto(`http://127.0.0.1:${port}/index.html`);
await page.waitForFunction(() => window.__done, null, { timeout: 3600000, polling: 1000 });
await browser.close();
server.close();
console.log(readFileSync(join(out, `cells-${region}.json`), "utf8").length, "bytes of layout;", jobs.length, "keys");
