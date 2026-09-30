# Splat video: end-to-end plan

For the agent running this on Herb's M5 MacBook Pro. Read the whole file before starting. Keep Herb posted in a line or two per phase.

## Status (2026-09-30)

Phases 0–4 are done on Herb's M5 (16 GB). Phase 5 is waiting on a clip.

Run a clip:

```bash
tools/splat4d/export.sh --video ~/Movies/clip.mov --start 0 --end 4 --out public/splats/4d/<name> --ply-preview
tools/splat4d/render.sh <name> 0,6,12
```

Then open `/lab/splat-video?clip=<name>` (the page opens the newest export by default). Re-running `export.sh` with only selection flags changed (`--budget`, `--motion-eps`, voxels…) reuses the cached model outputs in `~/dev/MoVieS/out/<name>/` and takes seconds. Pass `--fresh` to rerun the model. `tools/splat4d/setup.sh` rebuilds the Mac setup from scratch.

Measured on the DAVIS tennis sample (13 frames, 518×294):

| | fp32 | fp16 (default) |
|---|---|---|
| Backbone | 51 s | 32 s |
| GPU memory | 13.0 GB | 8.3 GB |
| CPU render vs input frame | 25.8 dB | 25.8 dB |

The full ~1.9M model splats score 27.9 dB, so the export loses about 2 dB. It is 364k splats and 18 MB. Exports use 25 output times by default (the model predicts the in-between moments). With 13 they crossfade between copies of the subject and look ghosty. A 3 s clip takes about 70 s end to end at 10.5 GB.

Changes from the plan below:

- **No VGGT-1B download.** The MoVieS checkpoint already holds every weight, so the model is built empty (`accelerate.init_empty_weights`) and loaded with `strict=True, assign=True`. That saves 4.8 GB of disk and RAM. Because of this, `--hfov auto` reads the 35 mm-equivalent focal length from the clip metadata. If the clip has none, it uses 65°. Pass `--hfov` to override.
- **Chunked attention.** Global attention is split into query chunks (`--attention-chunk 1024`), and the DPT heads take 4 frames at a time. Without this, 13 frames swapped the 16 GB Mac to a halt.
- **fp16 by default.** It matches fp32 in quality.
- **Static set is merged, not picked.** Copies that land in the same voxel (1.5 px footprint and 10 % depth) become one Gaussian: moment-matched covariance and stacked opacity `1 − ∏(1 − α)`. Picking a single copy left the scene sparse and dark, because each copy's opacity is low (median about 0.15) and the model relies on 13 overlapping copies.
- **Dynamic set comes from every input frame and is not merged.** Keeping only the reference frame's copies made the subject see-through. Merging trajectories cost 4 dB. `--dynamic-frames N` limits it to N evenly spaced frames, and `--merge-dynamic` turns merging back on. `--extra-dynamic-frames` is gone.
- **Budget raised to 500k.** When over budget, the dynamic set keeps at most half of it.
- **`tools/splat4d/check.py`** is a numpy EWA splat renderer. It renders an export from the capture camera and compares it with the input frames. This is how the export was checked without a browser.
- **Player loops by bouncing** (`PLAYBACK.bounce` in `splatVideoParams.js`), so a real clip doesn't jump at the loop point.

Not verified yet:
- The player has not been opened in a browser: `?clip=fake` and `?clip=tennis` are the first things to look at.
- How MoVieS handles a truly still camera. Every DAVIS sample pans. A panning phone clip fed in as still collapses into a flat, blended scene with almost nothing moving.

## Goal

Herb films a short clip with the phone standing still. We turn it into a 3D Gaussian splat scene that **plays like the video** and that you can **nudge the camera around** in the browser (drag, cursor parallax) while it plays. It shows up first as a lab page on herb.art (`/lab/splat-video`). The homepage comes later, after Herb has seen it.

## Decisions already made (don't reopen them)

- **Model:** [MoVieS](https://github.com/chenguolin/MoVieS) (PKU + ByteDance + CMU, CVPR 2026, MIT license). It turns one ordinary video into moving splats: every pixel of the input frames becomes a Gaussian, and the model predicts where each one is at any output time. That gives us the same set of Gaussians moving through time, which avoids the flicker you'd get from running a per-image model such as Apple's SHARP on every frame.
- **Camera:** stationary (tripod or propped phone), one angle. There's no camera-pose step: every frame gets the identity pose.
- **Fidelity:** artifacts are fine. Stretching or holes at the sides when you swing the camera are accepted. Herb just wants it on his page.
- **Compute:** run on the Mac (Apple GPU through PyTorch `mps`). A rented NVIDIA GPU is only a fallback (see the end).
- **Player:** our own small three.js splat renderer. drei's `<Splat>` (used on the homepage in `src/app/experience/components/SplatViewer.jsx`) loads one static `.splat` file and can't animate. **No new npm dependencies** (lab rule).

## What's verified and what isn't

Verified by reading MoVieS at commit `77262fa`:

- `src/infer_davis_nvs.py` calls `model.backbone(images, C2W, fxfycxcy, input_timesteps, output_timesteps, frames_chunk_size=16)`. It returns:
  - `backbone_outputs`: `depth`, `color`, `scale`, `rotation`, `opacity`, each `(B, F_in, C, H, W)`.
  - `pred_motions`: `(B, F_out, F_in, 4, H, W)`. The xyz offset (plus confidence) of every input-frame Gaussian at every output time.
  - `pred_motion_gs`: a list of `F_out` dicts of per-time attribute overrides (`motion_color`, `motion_opacity`, `motion_scale`, `motion_rotation`, whichever exist).
- The demo uses 13 input frames and 13 output times (`torch.linspace(0, 1, 13)`). Output times are just a tensor we pass in, so we can ask for more.
- The upstream demo renders only MP4s. The splats themselves come from `GaussianRenderer.render()` in `src/models/gs_render/gs_renderer.py`. `GaussianModel.save_ply()` in `gs_util.py` writes standard 3DGS PLY.
- Intrinsics `fxfycxcy` are **normalized**: `fx` is divided by width, `fy` by height, `cx`/`cy` are fractions (see `unproject_depth` in `src/utils/geo_util.py`). Cameras use the OpenCV convention: x right, y down, z forward.
- `sh_degree = 0`, so color is plain RGB in [0, 1] after `color_activation`.
- There are three CUDA-only imports, all avoidable:
  - `xformers` in `src/models/networks/attention.py`. Only the `MemEffAttention` class uses it. Setting `opt.memory_efficient_attention = False` switches to the plain `Attention` class, which uses `F.scaled_dot_product_attention`. Same parameter names, so the checkpoint still loads with `strict=True`.
  - `gsplat` in `gs_util.py`. Only needed to draw preview MP4s. We don't render.
  - `torch_scatter` in `gs_renderer.py`. Only the optional voxelization inside `render()`.
- `VGGSplaT.__init__` calls `VGGT.from_pretrained("facebook/VGGT-1B")`. Expect a multi-GB Hugging Face download the first time the model is built.

**Not verified**, so find out in order:

1. Whether every op runs on `mps`.
2. Peak memory on Herb's Mac. VGGT-1B alone is about 5 GB of weights in fp32.
3. The input resolution and pixel range the model expects. Mirror the sample `.npz`.
4. Which `motion_*` keys `pred_motion_gs` actually contains.
5. Whether output times between the input times look sane.
6. How good MoVieS looks with a perfectly static camera.

## Where things live

| What | Where | In git? |
|---|---|---|
| MoVieS clone, checkpoints, VGGT weights | `~/dev/MoVieS` (outside this repo) | no |
| Python venv | `~/dev/MoVieS/.venv` | no |
| Exporter + Mac shims | `tools/splat4d/` in this repo | yes |
| Fake-data generator | `scripts/splat4d-fake.mjs` | yes |
| Generated scenes | `public/splats/4d/<name>/` | **no**: add `public/splats/4d/` to `.gitignore` |
| Player | `src/app/lab/splat-video/` | yes |

Work on a branch, never `main`. Never commit weights, clips or generated scene data.

## Suggested order

Start the Phase 0 downloads, then build the player on fake data (Phase 4a) while they run. Phases 1–3 get real data flowing. Phase 5 is Herb's clip.

---

## Phase 0: Mac setup

1. Check the machine: `sysctl hw.memsize` and `sw_vers`. Report the RAM to Herb. 24 GB or more is comfortable. 16 GB may need fewer frames or a smaller width.
2. `brew install ffmpeg git-lfs` if they're missing.
3. Clone the model and create the venv:
   ```bash
   mkdir -p ~/dev && cd ~/dev
   git clone https://github.com/chenguolin/MoVieS && cd MoVieS
   git -C extensions clone https://github.com/facebookresearch/vggt.git
   python3.11 -m venv .venv && source .venv/bin/activate
   pip install torch torchvision
   pip install einops numpy pillow matplotlib plyfile omegaconf imageio imageio-ffmpeg \
     accelerate safetensors pytorch-msssim lpips kiui diffusers transformers huggingface_hub \
     opencv-python wandb
   ```
   Do **not** install `xformers`, `gsplat`, `torch-scatter` or `deepspeed`, and don't run `settings/setup.sh` (it's for Linux + CUDA). If the VGGT clone has its own requirements, install only the non-CUDA ones.
4. `python -c "import torch; print(torch.__version__, torch.backends.mps.is_available())"` must print `True`.
5. Download the checkpoint and the preprocessed sample videos (they include poses) into `resources/`, as the MoVieS README says:
   ```bash
   hf download chenguolin/MoVieS --local-dir resources
   ```
   (Older `huggingface_hub` versions call it `huggingface-cli download`.)
   Then arrange it so `resources/movies_ckpt.safetensors` and `resources/DAVIS/<name>.npz` exist; those are the paths `infer_davis_nvs.py` uses. List what you got.
6. Inspect one sample and note the answers. Our own input must match exactly:
   ```python
   import numpy as np; z = np.load("resources/DAVIS/<name>.npz")
   for k in z.files: print(k, z[k].shape, z[k].dtype, z[k].min(), z[k].max())
   ```
   Record: number of frames, H and W (the demo GIFs are 518×294, and H and W are probably multiples of 14), image value range, `fxfycxcy` values, and whether `C2W[0]` is identity.

## Phase 1: shims and model load on MPS

Create `tools/splat4d/movies_mac.py`, which sets up MoVieS on a Mac without editing the clone:

```python
import os, sys, types, importlib.util
import torch
import torch.nn.functional as F

def install_cuda_shims():
    if importlib.util.find_spec("xformers") is None:
        ops = types.ModuleType("xformers.ops")
        ops.unbind = torch.unbind
        def memory_efficient_attention(q, k, v, p=0.0):
            return F.scaled_dot_product_attention(
                q.transpose(1, 2), k.transpose(1, 2), v.transpose(1, 2), dropout_p=p
            ).transpose(1, 2)
        ops.memory_efficient_attention = memory_efficient_attention
        root = types.ModuleType("xformers"); root.ops = ops
        sys.modules["xformers"], sys.modules["xformers.ops"] = root, ops
    def unavailable(name):
        def fail(*a, **k): raise NotImplementedError(f"{name} is CUDA-only and unused by the exporter")
        return fail
    if importlib.util.find_spec("gsplat") is None:
        m = types.ModuleType("gsplat"); m.rasterization = unavailable("gsplat")
        sys.modules["gsplat"] = m
    if importlib.util.find_spec("torch_scatter") is None:
        m = types.ModuleType("torch_scatter")
        m.scatter_add = unavailable("torch_scatter"); m.scatter_max = unavailable("torch_scatter")
        sys.modules["torch_scatter"] = m

def load_movies(movies_root, device):
    os.chdir(movies_root)
    sys.path.insert(0, movies_root)
    install_cuda_shims()
    from safetensors.torch import load_file
    from src.options import opt_dict
    from src.models import SplatRecon
    opt = opt_dict["movies"]
    opt.memory_efficient_attention = False
    model = SplatRecon(opt, load_lpips=False)
    model.load_state_dict(load_file("resources/movies_ckpt.safetensors"), strict=True)
    return model.eval().to(device), opt
```

- Run with `PYTORCH_ENABLE_MPS_FALLBACK=1`, so any op MPS lacks falls back to the CPU.
- If the import fails on some other training-only package, `pip install` it if that works on macOS. Otherwise stub it the same way.
- Start in **fp32 with no autocast**, which is the most likely to work. Try `torch.autocast("mps", dtype=torch.float16)` only after fp32 works, and only if speed or memory needs it.
- **Check:** the model loads with `strict=True` on `mps`. Print the parameter count and `torch.mps.driver_allocated_memory()`.

## Phase 2: run the sample on the Mac

Write `tools/splat4d/export.py` (spec in Phase 3). Its first job is just to run the backbone on one DAVIS sample.

- Copy the argument handling from `infer_davis_nvs.py`, but use `device = "mps"` and fp32 tensors instead of the `torch.autocast("cuda", bfloat16)` block.
- Save a depth preview with the repo's own helpers (`colorize_depth`, `tensor_to_video` from `src.utils`) to `out/<name>/depth.mp4` and look at it.
- **Check:** it finishes. Report wall time and peak memory to Herb.
- **If it runs out of memory:** use fewer input frames (13 → 8) or a smaller width (518 → 364, which keeps multiples of 14). Global attention over every frame's tokens is the memory peak.
- **If an op still fails** with the MPS fallback on, and you can't get around it within ~1 hour: stop and ask Herb (see "Fallback" below).

## Phase 3: exporter to the web format

`tools/splat4d/export.py` CLI (make the flags real; the values below are defaults):

```
python tools/splat4d/export.py \
  --movies ~/dev/MoVieS \
  (--npz resources/DAVIS/<name>.npz | --video ~/Movies/clip.mov --start 0 --end 4) \
  --in-frames 13 --out-times 25 --width 518 \
  --hfov auto \
  --budget 350000 \
  --out public/splats/4d/<name> \
  --ply-preview \
  --device mps --dtype fp32
```

### 3.1 Inputs

- **`--npz`:** use the sample exactly as `infer_davis_nvs.py` does.
- **`--video`:** decode with imageio (ffmpeg), sample `--in-frames` frames evenly between `--start` and `--end`, and resize and crop to the sample's H and W convention and value range.
  - Check orientation: iPhone videos carry a rotation flag. Save `input_frames.jpg`, a contact sheet of the frames, and look at it.
  - `C2W` is the identity for every frame.
- **Intrinsics:**
  - `--hfov <deg>` gives `fx = 0.5 / tan(hfov/2)`, `fy = fx * W / H`, `cx = cy = 0.5`.
  - `--hfov auto` estimates it once with VGGT, which is already downloaded: run `VGGT.from_pretrained("facebook/VGGT-1B")` on the frames and convert its pose encoding with the `vggt.utils.pose_enc` helpers. Take the median across frames.
  - Print the hfov you used. An iPhone 1× lens in landscape 16:9 is roughly 65–70° horizontal, which is a sanity check.
- Input timesteps are `linspace(0, 1, in_frames)` and output times are `linspace(0, 1, out_times)`. Start with `--out-times` equal to `--in-frames`. Raise it only after that works.

### 3.2 Build per-time Gaussians (no pruning)

For each output time `i`, copy the attribute preparation in `GaussianRenderer.render()` **exactly**: from the line reading `color, scale, rotation, opacity` down to the spherical-harmonics block, stopping before `pcs = []`. Same order of operations, same activations, same `rearrange("b v c h w -> b (v h w) c")`. Don't "fix" anything; the model was trained with that exact code.

- Set `offset = pred_motions[:, i, :, :3]` and merge in `pred_motion_gs[i]` first, as the demo loop does.
- **Skip** the renderer's opacity pruning, voxelization and rasterization. Pruning each time separately would break the one-to-one match of Gaussians across time.

Result: for `M = F_in·H·W` candidates:
- `xyz[T, M, 3]`
- `opacity[T, M]`
- `rgb[M, 3]` (if `motion_color` exists, take the value at the reference time for v1)
- `scale[M, 3]` and `rot[M, 4]` (same; order is wxyz)

Candidate index `m = v·H·W + y·W + x`. It's the same Gaussian at every time.

Print which `motion_*` keys exist, plus the value ranges.

### 3.3 Choose which Gaussians to keep

With a static camera, every input frame contributes a full copy of the unchanging background: 13 frames means 13 copies. Rules, all deterministic:

- **Visible:** `max_t opacity > --min-opacity` (0.02).
- **Depth clip:** drop points behind the camera or beyond the 99th depth percentile (`--max-depth-pct 99`). Otherwise far outliers blow up the quantization bounds.
- **Motion:** `motion[m] = max_t |xyz_t − xyz_ref|`, with scene scale `s` = median depth. The Gaussian is dynamic if `motion > --motion-eps · s` (0.01).
- **Dynamic set:** Gaussians from the reference input frame `v_ref` (middle frame by default), plus optional `--extra-dynamic-frames k` evenly spaced frames if the moving subject shows holes.
- **Static set:** from all frames, voxel-deduped. Voxel size is the pixel footprint at that depth (`depth / fx_px · --static-voxel 1.5`); keep one per voxel, preferring `v_ref`. This fills in background the subject covers in `v_ref`.
- **Budget:** if over `--budget`, thin the static set first (hash-stride over pixels), then the dynamic set.
- Print the counts: candidates, visible, static, dynamic, final.

### 3.4 Output format `splat4d` v1

All binaries are little-endian. Splats are ordered `[static…, dynamic…]`. Keep coordinates in **OpenCV camera-0 space**; the player flips them.

`meta.json`:
```json
{
  "format": "splat4d", "version": 1, "exportId": "<unix-ms>",
  "count": 0, "staticCount": 0, "dynamicCount": 0,
  "frames": 25, "duration": 4.0,
  "bounds": { "min": [0, 0, 0], "max": [0, 0, 0] },
  "covScale": 1.0,
  "coords": "opencv-camera0",
  "camera": { "vfovDeg": 0, "aspect": 0, "pivotDepth": 0 },
  "source": { "clip": "", "inFrames": 13, "width": 518, "height": 294, "movies": "77262fa" }
}
```

| File | Size | Layout |
|---|---|---|
| `base.bin` | `count` × 16 B | Six float16 values for the 3D covariance upper triangle `xx, xy, xz, yy, yz, zz`, where Σ = R·diag(s²)·Rᵀ, multiplied by `covScale`. Then `r, g, b, a` as uint8, where `a` is the reference opacity. That's exactly one RGBA32UI texel per splat. |
| `static.bin` | `staticCount` × 8 B | uint16 `x, y, z` quantized into `bounds`, plus uint16 opacity. |
| `dynamic.bin` | `frames` × `dynamicCount` × 8 B | Same layout per splat, frame-major. |

- `covScale`: pick it so the median variance is about 1. float16 loses tiny splats otherwise.
- `pivotDepth`: median depth of the dynamic set (the subject), or of the center region if nothing is dynamic.
- `vfovDeg`: from `fy` (`2·atan(0.5/fy)`).
- `--ply-preview`: also write standard 3DGS PLYs of frames `0` and `T/2` for the kept Gaussians. Vectorize the writer; upstream `save_ply` builds Python tuples per point and is slow at millions.

**Check:** drag `frame_0.ply` into [SuperSplat](https://superspl.at/editor) and confirm it looks like the scene. Report sizes. Rough expectation: 300k static + 60k dynamic × 25 frames ≈ 5 + 12 + 6 MB.

## Phase 4: the player (lab page)

Load the `lab-build` and `taste` skills first and follow the lab contract. That means:
- Files only in `src/app/lab/splat-video/`.
- No comments in lab code.
- Type tokens only; 4px vertical grid.
- Light page with a one-line title.
- `node scripts/lab-gate.mjs splat-video` must print PASS.
- No new dependencies.

Scaffold by hand the way `scaffold()` in `scripts/lab-generate.mjs` does: the same `page.js` shape and an `experiment.json` with `status: "candidate"`. Lab pages 404 in prod view unless shipped, so this stays local.

### 4a: fake data first

Write `scripts/splat4d-fake.mjs`. It writes `public/splats/4d/fake/` in the exact v1 format:
- a static backdrop of ~200k splats (a gradient or checker plane with some depth relief);
- a dynamic figure of ~30k splats (e.g. a torus that bobs and turns) over 24 frames.

Build the whole player against this, so you're never blocked on the model.

### Files

- `page.js`
- `SplatVideoExperience.jsx`: state, loading, mounts through `@/app/ui/ClientOnly`.
- `SplatVideoScene.jsx`: R3F canvas.
- `splatMaterial.js`: GLSL3 `ShaderMaterial`.
- `loadSplat4d.js`
- `sortWorker.js`
- `splatVideoParams.js`
- `SplatVideoControls.jsx`
- `splat-video.css`
- `experiment.json`

### Loading

- `fetch(meta.json, { cache: "no-store" })`, then the `.bin` files with `?v=<exportId>`.
- This matters: `next.config.mjs` serves `/splats/*` as `immutable` for a year, so without the version query a re-export never shows up.
- Stream with a reader so the loading state shows real progress.
- Clip name comes from `?clip=` and defaults to the newest real export, falling back to `fake`.

### GPU data (WebGL2, no copies)

- `base.bin` → `DataTexture`, `RGBAIntegerFormat` + `UnsignedIntType` (RGBA32UI), width 2048, rows padded.
- `static.bin` → `DataTexture` RGBA16UI (`UnsignedShortType`).
- `dynamic.bin` → `DataArrayTexture` RGBA16UI, one layer per frame.
- One instanced quad (`InstancedBufferGeometry`) with a per-instance float `aSplat` index, rewritten from the sort order.

### Vertex shader

- Look up the splat index. Take its position from the static texture, or `mix(layer f0, layer f1, u)` from the dynamic array. Dequantize with the bounds, and mix opacity the same way.
- Build the 3D covariance from `base` ÷ `covScale`. Project with the 2D EWA Jacobian (the same math as antimatter15/splat, MIT) and add 0.3 px² low-pass.
- Eigen-decompose to the quad axes, clamped to 1024 px.
- Cull behind the camera and well outside the frustum.
- Three.js view space looks down −Z. Use `−z` as depth and get the Jacobian signs right; this is the classic bug.
- Focal in pixels: `focal = viewportHeight / (2·tan(vfov/2))`.

### Fragment shader and blending

- Gaussian falloff; discard beyond `r² > 4`.
- Premultiplied output.
- `CustomBlending`, `OneFactor` / `OneMinusSrcAlphaFactor`, `depthWrite: false`. Draw back-to-front.

### Coordinates

- Put the splat object in a group with `rotation.x = Math.PI`. That maps OpenCV to three.js with no data conversion.
- The default camera is then the capture camera: position `(0, 0, 0)`, no rotation, `fov = meta.camera.vfovDeg`.
- Orbit pivot is `(0, 0, −pivotDepth)`.
- **Check:** at time 0 from the default camera, the frame should line up with the first input frame.

### Sort worker

- Holds the static positions and all dynamic frames; send them once, transferred.
- Each request carries the view-matrix z row, `f0`, `f1` and `u`. The worker computes depth and runs a 16-bit counting sort, far to near, then posts back a transferable `Float32Array` of indices.
- Only one request in flight. Re-sort when the camera moves or time advances.
- Create it with `new Worker(new URL("./sortWorker.js", import.meta.url), { type: "module" })`.

### Playback and interaction

- Loops over `meta.duration`, interpolating between the `frames` output times.
- Space toggles play and pause.
- A scrub bar: arrow keys step frames; Home and End jump to the ends.
- Speed 0.25 / 0.5 / 1.
- "Back to lens" resets the camera.
- Drag to orbit around the pivot: yaw ±25°, pitch ±12°, with damping. Wheel or pinch dolly within 0.85–1.15 × pivot distance.
- Subtle cursor parallax on desktop while idle (±4°).
- Put all limits and defaults in `splatVideoParams.js`.

### States and hygiene

- **States:** loading with byte progress; error, where a missing clip shows the export command to run; playing; paused; scrubbing; reduced motion (starts paused on frame 0, no autoplay, parallax off).
- **Mobile below 900px:** controls collapse, DPR capped at 1.5, touch drag.
- **Hygiene:**
  - Stop the frame loop when the tab is hidden.
  - Dispose textures, geometry, material and the worker on unmount.
  - Guard `window` on the server.
  - No `setState` synchronously in effects (React 19 lint).

**Check:** the fake scene plays smoothly at 60 fps on the Mac with no sorting pops. The gate passes. Show Herb `localhost:3000/lab/splat-video?clip=fake`.

## Phase 5: Herb's clip

### Filming guide (tell Herb)

- Phone on a tripod or propped. **Nothing touches it** during the take.
- Landscape. 1× main lens. No Cinematic or Portrait mode, no zoom.
- **HDR video off** (Settings → Camera → Record Video). 1080p or 4K at 30 fps.
- Lock focus and exposure (long-press on the subject).
- Bright, even light, so there's no motion blur.
- Herb 1.5–3 m from the phone, a background with some texture and depth, no mirrors or screens.
- 3–5 seconds of **slow, clear motion**: turning, raising a hand, leaning. 13 input frames across 4 s is about 3 per second, so fast gestures fall between samples.
- A few takes are cheap. Pick the best after export.

### Run it

```bash
PYTORCH_ENABLE_MPS_FALLBACK=1 python tools/splat4d/export.py --movies ~/dev/MoVieS \
  --video <clip> --start <s> --end <s> --out public/splats/4d/<name> --ply-preview
```

Look at `input_frames.jpg`, the depth preview and the SuperSplat PLY, then open `/lab/splat-video?clip=<name>`.

## Phase 6: tuning (only what's visibly wrong)

| Problem | Knob to try |
|---|---|
| Choppy motion | `--in-frames` 13 → 16/24 (memory permitting); `--out-times` 25 → 49 |
| Holes on the moving subject | `--extra-dynamic-frames 2` |
| Background holes where the subject was | smaller `--static-voxel` |
| Too heavy or slow | lower `--budget`; higher DPR cap on desktop only |
| Everything too flat or stretched | try `--hfov` a few degrees either way |
| Swinging too far looks bad | tighten yaw and pitch in `splatVideoParams.js` |
| Mushy background moving | raise `--motion-eps` |

Report what changed and why in `experiment.json` (`description`, `intent`).

## Later: the homepage (separate go-ahead from Herb)

Don't touch `src/app/experience/*` or the homepage until Herb has seen the lab page and says so.

- **One sort for everything.** Two separately sorted splat renderers in one scene composite wrong where they overlap. Convert `public/splats/herb-scan-clean.splat` into the static part of a splat4d scene, so the room and the moving subject render in one sort.
- **Size.** The homepage needs single-digit MB. Options:
  - Pre-gzip the `.bin` files and decompress with the browser's `DecompressionStream`, no dependency needed.
  - Fewer, larger splats for mobile.
  - Pack the dynamic attributes into a hardware-decoded video texture, as the V³ and StreamSTGS papers do.
- The splat URLs need a version in the path or query, because of the immutable cache headers.

## Fallback: rented NVIDIA GPU

Ask Herb before spending money. If the Mac can't run the model:
- Rent a Linux machine with an NVIDIA GPU with ≥ 24 GB VRAM (RTX 4090, L40S, A100…) from RunPod, Lambda or Vast.
- Run the upstream `settings/setup.sh` unchanged.
- Run the same `export.py` with `--device cuda --dtype bf16`. The shims switch themselves off when the real packages exist.
- Copy `public/splats/4d/<name>/` back to the Mac.

## Stop and ask Herb when

- MPS won't run after the shims, the CPU fallback, fp32 and fewer frames (then offer the fallback).
- The DAVIS sample looks broken (not just artifacty): show the depth preview before filming anything.
- Anything outside `tools/splat4d/`, `scripts/splat4d-fake.mjs`, `src/app/lab/splat-video/`, `.gitignore` or `docs/` needs changing.
- A file over 5 MB is about to be committed.

## Done means

- `localhost:3000/lab/splat-video?clip=<herb-clip>` plays Herb's clip as moving splats on a loop.
- The camera can be dragged and nudged while it plays.
- `node scripts/lab-gate.mjs splat-video` prints PASS, and `experiment.json` is filled in.
- FPS, splat count and data size reported to Herb.
- The exporter, shims, fake generator and player are committed on a branch and pushed. No scene data or weights.
