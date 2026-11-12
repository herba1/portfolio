// Dev check for the glyph-morph lab piece: loads /lab/glyph-morph?check on
// the running dev server at a few viewport sizes. The piece sweeps every word
// pair (both ways) through the first 0.6s of the morph and flags overlapping
// glyph clip rects, pieces narrower than 0.25em, and glyphs still cut once the
// word has settled. Exits 1 on any flag.
//
//   node tools/depth/bakes/glyph-morph/check.mjs
import { launch, BASE } from "../../../factory/lib.mjs";

const SIZES = [
  [1280, 800],
  [1920, 1080],
  [390, 844],
];

const browser = await launch();
let bad = 0;
for (const [width, height] of SIZES) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(`${BASE}/lab/glyph-morph?check`, { waitUntil: "load" });
  const result = await page.waitForFunction(() => window.__glyphMorphCheck, null, { timeout: 60000 }).then((h) => h.jsonValue());
  console.log(`${width}x${height} size ${result.size}px: ${result.ok ? "ok" : `${result.flags.length} flags`}`);
  for (const f of result.flags.slice(0, 40)) console.log(`  ${f.pair} t=${f.t} ${f.kind}: ${f.msg}`);
  if (process.env.VERBOSE) for (const s of result.timing) console.log(`  ${s.pair.padEnd(20)} whole at ${s.whole}s, at rest ${s.rest}s, ${s.cut} steps with a cut glyph`);
  if (!result.ok) bad += 1;
  await page.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
