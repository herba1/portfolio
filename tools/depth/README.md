# Depth maps for lab pieces

`depth.py` turns a photo into a relative depth map (white = near) with Depth Anything V2 Small (ONNX).

    pip install onnxruntime pillow numpy
    curl -L -o tools/depth/da2s.onnx https://github.com/fabio-sim/Depth-Anything-ONNX/releases/download/v2.0.0/depth_anything_v2_vits.onnx
    python3 tools/depth/depth.py photo.jpg photo-depth.png

Writes a 16-bit PNG and an 8-bit `-8.png` preview at the photo's resolution. The model file is not committed.

`depth_hr.py` is the sharper version (same model, same outputs: 16-bit PNG + `-8.png`, white = near). It runs an aspect-correct global pass, then overlapping 518 tiles at 2x and 4x that are robustly aligned (scale, shift, tilt) to the coarser pass and feather-blended, then snaps depth edges to photo edges. No tile seams, no hair halos; about a minute for a 24 MP photo on 4 cores.

    python3 tools/depth/depth_hr.py photo.jpg photo-depth.png   # --levels 2,4  --no-refine

# Photo tools: fill, layers, normals, segment

Four offline CLIs for the realistic photo pieces, sharing `kit.py` (I/O, guided filter, push-pull, sheets). numpy + OpenCV + onnxruntime only, no torch. Every one has `--help` with the full method. Run them with `python3 -I` (the models are downloaded files).

| Tool | What it makes | Model (licence) |
|---|---|---|
| `fill.py` | inpaints a hole: cropped, tiled, feathered, grain-matched | LaMa big-lama, ONNX export by Carve (Apache-2.0 on the export; see note) |
| `layers.py` | herb's near layer + filled plate, or an N-band multiplane stack | uses `fill.py` |
| `normals.py` | normals, metric depth, FOV, validity (sky) mask; depth-slope fallback; planar snapping | MoGe-2 ViT-S normal, ONNX by the MoGe author (MIT) |
| `segment.py` | `prompt`: SAM 2.1 point/box masks with tiled zoom refinement; `sky`: sky matte keeping wires; `fg`: BiRefNet matte | SAM 2.1 Hiera-Tiny (Apache-2.0); BiRefNet_lite (MIT); `sky` uses no model |

## Models

Models live outside the repo, one directory per download, under `$LAB_MODELS` (default `/tmp/claude-0/models`). `tools/depth/*.onnx` and `*.onnx_data` are git-ignored in case one lands in the tree.

    M=${LAB_MODELS:-/tmp/claude-0/models}
    hf() { mkdir -p "$M/$1/$(dirname $3)"; curl -fL -o "$M/$1/$3" "https://huggingface.co/$2/resolve/main/$3"; }
    hf lama-carve        Carve/LaMa-ONNX                      lama_fp32.onnx                                  # 208 MB
    hf moge2-vits-normal Ruicheng/moge-2-vits-normal-onnx     model.onnx                                      # 141 MB
    hf sam21-tiny        onnx-community/sam2.1-hiera-tiny-ONNX onnx/vision_encoder.onnx
    hf sam21-tiny        onnx-community/sam2.1-hiera-tiny-ONNX onnx/vision_encoder.onnx_data                 # 134 MB
    hf sam21-tiny        onnx-community/sam2.1-hiera-tiny-ONNX onnx/prompt_encoder_mask_decoder.onnx
    hf sam21-tiny        onnx-community/sam2.1-hiera-tiny-ONNX onnx/prompt_encoder_mask_decoder.onnx_data    # 21 MB
    # optional
    hf moge2-vitb-normal Ruicheng/moge-2-vitb-normal-onnx     model.onnx                                      # 419 MB, --model vitb (not tested here)
    hf birefnet-lite     onnx-community/BiRefNet_lite-ONNX    onnx/model.onnx                                 # 224 MB, segment.py fg

Hugging Face serves these files from `us.aws.cdn.hf.co`; the cloud environment's allowlist needs that host as well as `huggingface.co`.

Licences, as checked on the model cards and repos (Nov 2026):

- **LaMa** (`Carve/LaMa-ONNX`): the ONNX repo is tagged Apache-2.0; the LaMa code (advimman/lama) is Apache-2.0. The original big-lama weights carry no separate licence statement (herb's note), so treat the fills as Apache-2.0 code output with that caveat.
- **MoGe-2** (`Ruicheng/moge-2-vits-normal-onnx`, `-vitb-`, `-vitl-`): MIT (the ViT-L ONNX card and the source checkpoints say MIT; the ViT-S/B ONNX repos carry no card but are the same author's exports of the MIT checkpoints). Backbone DINOv2: Apache-2.0.
- **SAM 2.1 Hiera-Tiny** (`onnx-community/sam2.1-hiera-tiny-ONNX`, from `facebook/sam2.1-hiera-tiny`): Apache-2.0.
- **BiRefNet_lite** (`onnx-community/BiRefNet_lite-ONNX`): MIT. There is no ONNX of BiRefNet_HR; exporting one needs torch.
- **Depth Anything V2 Small** (`da2s.onnx`): Apache-2.0.
- Not used: Marigold-IID (OpenRAIL++ weights) has no ONNX or CPU path without torch/diffusers; skipped.

## Commands

    P=photo.jpg D=photo-depth.png          # D from depth_hr.py (white = near)

    # fill a hole (white in hole.png); --compare also runs shift-fill, Telea, NS and writes a sheet
    python3 -I tools/depth/fill.py $P hole.png filled.png [--grow 4] [--compare sheet.jpg]

    # herb's split: band1.png (near layer RGBA), plate1.jpg (LaMa plate), depth0.png (plate depth, the erosion), depth1.png
    python3 -I tools/depth/layers.py $P $D out/ --preview out/sheet.jpg
    # multiplane: N bands, each band<k>.png + plate<k>.jpg + depth<k>.png, layers.json
    python3 -I tools/depth/layers.py $P $D out/ --bands 4 [--thresholds 0.2,0.45,0.7] [--near-mask person.png]

    # normals + metric depth + FOV (MoGe-2): normal.png (16-bit, OpenGL camera space), depth.png (16-bit metres
    # scaled by camera.json depth_max), mask.png (white = surface, black = sky), camera.json (fov_x/fov_y/fx/up)
    python3 -I tools/depth/normals.py $P out/ --snap
    # fallback without a learned model: normals from the depth map's slope
    python3 -I tools/depth/normals.py $P out/ --from-depth $D --fov 60 --sky sky.png --snap

    # masks
    python3 -I tools/depth/segment.py prompt $P mask.png --point 750,1200 --neg 0.5,0.1 [--box x0,y0,x1,y1]
    python3 -I tools/depth/segment.py sky $P sky.png --depth $D [--moge out/mask.png]
    python3 -I tools/depth/segment.py fg $P fg.png      # BiRefNet_lite: experimental, untested (out of memory here)

Coordinates are photo pixels, or fractions when every number is at most 1. `prompt` caches the SAM embedding next to the output (`mask.sam.npz`), so further prompts on the same photo take a couple of seconds.

All ONNX sessions use 2 threads (`--threads`), with the memory arena off; the machine is shared.

## Results and timings

Measured Nov 2026 on the shared 4-core box with 2 threads per session. The load average
was 40-50 for most of these runs (other jobs), so the wall times are 4-6x what a quiet
machine gives; the quiet-machine figure is in brackets where it was measured.

| Step | Wall time |
|---|---|
| LaMa, one 512 tile | 57 s loaded (9 s quiet) |
| `fill.py`, crossing 3000x2000, hole 8-9 % of the frame (coarse + 13-17 tiles) | 800-990 s loaded |
| `fill.py --method shift` / `telea` / `ns`, same hole | 40 s / 13-18 s / 10-18 s |
| `layers.py` herb split at 1280, LaMa plate (13 tiles) | 744 s loaded |
| `layers.py --bands 4` at 1280, three LaMa plates | 2030 s loaded |
| `layers.py` with `--fill telea` (for trying out cuts) | 20-35 s |
| `normals.py`, MoGe-2 ViT-S at 1036 px, 3600 tokens, outputs at 2048 | 118-152 s loaded (model 88-128 s), peak 1.2 GB RAM |
| `normals.py --from-depth` (fallback) at 2048 | 30-55 s |
| `segment.py prompt`, SAM 2.1 tiny: encoder / decoder / cached prompt | 50 s loaded (16 s quiet) / under 1 s / 2-6 s |
| `segment.py prompt` with tiled zoom on a full-height object (4 extra encodes) | 165 s loaded |
| `segment.py sky` at 2048 | 14-27 s |

What came out (sheets in `factory/reality/tools/`):

- **fill**: LaMa wins clearly. On a ground-truth test (the near signal's mask moved onto
  visible pixels) it scores 17.2 dB PSNR in the hole against 14.5-14.7 dB for shift-fill,
  Telea and NS, and it is the only method that carries the utility pole, the wires and the
  tree line through the hole. Behind the real signal it removes the signal cleanly, wires
  continued. Its weak spot is fine foliage at 1:1, which comes out softer than the photo;
  tiles at native size (the default up to 3000 px wide) are a little crisper than 2x-down
  ones. Shift-fill keeps real grass texture but smears structure. `fill-crossing-*.jpg`.
- **layers**: herb's split works as he describes: the near layer is the strip on the near
  side of every depth edge, the plate keeps the interiors, and at +-2.5 % the layered
  shift has none of the plain depth warp's doubled crossbucks. The N-band stack composites
  back to the photo at 32-37 dB. Relative depth puts a halo of "near" sky round near
  silhouettes, so pass `--sky` (a `segment.py sky` matte) for multiplane stacks.
  `layers-*.jpg`.
- **normals**: MoGe-2 ViT-S gives clean, metric, gravity-consistent normals (the road snaps
  flat, walls to two or three orientations) plus FOV (65.8 deg on crossing-summer, 75.0 deg on
  the low-angle Kyoto shot). The depth-slope fallback is usable only with a sky matte and
  is much noisier on foliage; use it when MoGe is not available. `normals-moge-vs-slope-v2.jpg`.
- **segment**: the sky matte holds 1-2 px wires against bright cloud and blue sky, keeps the
  aircraft and antennas, and resolves leaf gaps and lattice gaps. One SAM pass at 256 px logits
  is blobby on a 3000 px photo; the tiled zoom (each tile re-encoded at about native size,
  prompted with the coarse mask's own box and deepest points) gives crisp crossbuck and
  bell edges. `segment-*.jpg`.
- **Not delivered**: BiRefNet_lite (`segment.py fg`) ran out of memory: past 5 GB at its
  fixed 1024 input on this 16 GB shared box. The code path is there but no output has
  been checked. There is no BiRefNet_HR ONNX, and Marigold-IID has no CPU/ONNX path.
