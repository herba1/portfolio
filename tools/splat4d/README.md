# splat4d

Tooling behind the private lab page `/lab/splat-video`. It turns a phone clip filmed from a still phone into something you can lean into in the browser.

The favourite result is the **layered depth video**: a soft-matted person over a tear-free room, built on a clean background plate.

## Private by design

- **The page is dev-only.** `src/app/lab/splat-video/page.js` calls `notFound()` in any production build, Vercel previews included, while `experiment.json` says `"status": "candidate"`.
  - The lab index (`/lab`) is also dev-only and marked no-index.
  - The page is not in the sitemap or the public nav.
  - It is reachable only from `npm run dev` on your machine.
- **Clips and exports never enter git.** They live only on this machine:

  | What | Where |
  | --- | --- |
  | Source clips, normalised by `phone.sh` | `~/dev/splat-clips/` |
  | Exports the page plays | `public/splats/4d/` (in `.gitignore`, never deployed) |
  | Caches: depth, mattes, plates, stream windows | `~/dev/MoVieS/out/<name>/` |
  | Model weights | `~/dev/MoVieS/resources/` |

- Do not publish exports of the Netflix test clips (CC BY-NC-ND). DAVIS clips are for local evaluation only. Treat friends' clips as private.

## Setup

```bash
tools/splat4d/setup.sh
```

This installs ffmpeg and uv if missing, then sets up MoVieS at `~/dev/MoVieS` (pinned to `77262fa`) with its Python 3.11 venv. It downloads:
- the MoVieS checkpoint;
- big-LaMa (verified by sha256), used for the plate fill.

Depth Anything V2 Small loads from Hugging Face on first use. The Apple Vision matte (`vision_matte.swift`) compiles itself to `~/dev/MoVieS/bin/vision_matte` on first use.

## One command per clip

```bash
tools/splat4d/phone.sh ~/Downloads/IMG_1234.MOV <name> [start seconds] [end seconds]
```

It normalises the clip into `~/dev/splat-clips/<name>.mp4`:
- trims to the range;
- tone-maps iPhone HDR to SDR;
- bakes in rotation;
- keeps the native frame rate up to 30 fps, and caps anything faster at 30;
- caps the long side at 1920.

It reads the lens from the clip's 35 mm focal-length tag, falling back to 65 degrees. Then it builds three exports:

| Export | Script | What it is | Time for about 25 s on an M5 |
| --- | --- | --- | --- |
| `<name>-depth` | `depthvideo.sh`, then `depthvideo_hd.sh` | Layered depth video (rgbd v3), the favourite | about 16 min of MoVieS depth, then 2-5 min |
| `<name>-stream` | `longclip.sh --still` | Per-second splat windows, used by the hybrid | about 25 min |
| `<name>` | `hybrid.sh` | Splat room with the video subject on top | about 4 min |

Run one build at a time; each one uses the GPU heavily. All steps cache under `~/dev/MoVieS/out/`, so a stopped run resumes where it left off.

To rebuild only the depth video after an exporter change:

```bash
tools/splat4d/depthvideo_hd.sh --video ~/dev/splat-clips/<name>.mp4 --start 0 --end <seconds> --hfov <deg> --depth-cache ~/dev/MoVieS/out/<name>-depth/depth_outputs.npz --out public/splats/4d/<name>-depth
```

`<seconds>` and `<deg>` are printed by `phone.sh` and stored in the export's `meta.json` under `source.end` and `source.hfovDeg`.

## Viewing

```bash
npm run dev
```

Open `/lab/splat-video?clip=<name>-depth` on the dev server's port. The port is set in `.claude/launch.json`; 3001 at the moment, because another app holds 3000.

Drag to lean, up to 12 deg yaw and 6 deg pitch; "Back to lens" resets the view.

Judge every change in two places: at the lens, where the frame should match the source, and at the full lean in all four corners.

## Filming tips

- Keep the phone still: on a tripod, or propped on something.
- 24 or 30 fps, 10-30 s.
- Landscape or portrait both work, and HDR is fine.
- Stand a metre or more from the wall, so the room has depth of its own.
- A plain or lightly textured background fills best behind the person. Busy shelves are where the generated fill shows.

## Layered depth video format (rgbd v3)

`rgbd.mp4` is one H.264 atlas per frame. `meta.layout` gives each band as `[x, y, w, h]`:

| Band | Size | Holds |
| --- | --- | --- |
| `color` | full | The live frame. Where the subject draws, it holds the colour unmixed against the room the player renders, so the composite at the lens reproduces the frame. |
| `alpha` | full | The refined Vision matte. In landscape it sits under the colour band; in portrait, beside it. |
| `depth` | mesh, half size | The subject's disparity, 8-bit between `disparity.min` and `disparity.max`. Pits are closed and sunken spots lifted; past the core it takes the nearest core value, softened at the seams. |
| `shade` | 1/8 | The per-frame live-over-plate gain (value / 255 x `layers.shadeRange`), so the revealed wall follows the shadows and exposure of the live wall. |

`plate.png` stacks the clean plate (LaMa-filled where never seen) over its disparity, which is the farthest room depth seen at each pixel.

The player (`RgbdScene.jsx`, `rgbdMaterial.js`) draws the room on the plate geometry first, then the subject's opaque core and premultiplied rim. Older rgbd v2 exports (`depthvideo.py`) still play through the single-mesh path.

## More

`docs/splat-video-plan.md` holds the full research log: every round, what was measured, what was tried and dropped, and why.
