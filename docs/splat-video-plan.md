# Splat video: end-to-end plan

For the agent running this on Herb's M5 MacBook Pro. Read the whole file before starting. Keep Herb posted in a line or two per phase.

## Status (2026-10-02)

Phases 0–5 are done on Herb's M5 (16 GB). Herb's own clip runs as a 30 s splat stream with audio (herb-30s) and as a depth video (herb-depth-30s). Checkpoints are tagged `splat-video-checkpoint-1` to `-3`. Rounds 3–5 below carry the numbers.

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

### Flipbook mode (the default for Herb's clip)

```bash
tools/splat4d/flipbook.sh --video ~/Movies/clip.mov --start 0 --end 4 --out public/splats/4d/<name>
```

Every video frame (15 fps by default) gets its own complete splat set, and the player hard-cuts between them like video frames. Nothing is interpolated, so the subject never crossfades between copies. How it works:
- MoVieS runs in overlapping windows of 13 frames (3 frames of overlap). Each window's depth scale is matched to the previous window on the shared frames.
- For each frame, every copy in the window at that frame's exact moment is merged into one solid subject, which is the model's intended output for that moment.
- Pixels that never move make one shared background, merged across all frames.
- The moving region is one mask for the whole clip: every pixel that differs from the median frame at any point, with holes closed and filled. Per-frame masks left holes in the parts that barely move, and those faces melted into the averaged background.

On a 3 s, 720p tripod test clip (Xiph's KristenAndSara, local only) at 15 fps: 46 frames, about 4.5 min, 22–23 dB against the video, 2.7M splats and 65 MB. Two people fill half the frame there, so a single person should come out smaller. The format is splat4d v2 (`kind: "flipbook"`): `base.bin` and `points.bin` cover the background followed by every frame's subject, and `frameOffsets` says where each frame starts. Camera limits are now yaw ±12°, pitch ±6° and dolly 0.92–1.08.

### Depth video mode

```bash
tools/splat4d/depthvideo.sh --video ~/Movies/clip.mov --start 0 --end 4 --out public/splats/4d/<name>
```

This mode doesn't use splats. It makes one H.264 file with the color frame (2× the model width) on top and 8-bit disparity below, plus a still background plate (median color, 80th-percentile depth). The player displaces two grid meshes and tears them at depth jumps (`RGBD.tearRelative` 0.08), and the plate fills in behind. MoVieS only provides depth here, with one output time per window, so a window takes about 6 s. 3 s at 30 fps comes out around 1–2 MB.

### Side by side (3 s clips, still camera)

| Clip | Interpolated | Flipbook | Depth video |
|---|---|---|---|
| Johnny (one person talking, 720p) | 61 MB | 43 MB, 24–25 dB | 2.1 MB |
| Dancers (two dancers, black stage, 4K) | 61 MB | 27 MB, 30–32 dB | 1.3 MB |
| KristenAndSara (two people talking) | – | 63 MB, 22–23 dB | – |

A sharper flipbook (subject voxel 1.0) on Johnny gained about 1 dB for twice the size (88 MB), so it was dropped. The page has a pill row for switching clips in place.

### Why tennis-flip looks best: the moving camera

`tennis-flip` takes 13 input frames spread over the whole clip in one window, has the model predict 25 moments, and rebuilds each frame whole: no background/subject split. The tennis camera pans and its poses are known, so the model sees the scene from several viewpoints.

Running the same recipe (`flipbook.sh --spread`) on still-camera clips:
- **Johnny:** ghosts and goes see-through, at 18 dB against 24–25 dB for the windowed flipbook. His head moves too much between 13 samples spread over 3 s, and a still camera adds no new views.
- **Dancers:** solid, at 27–30 dB.

So the multi-view information from a moving camera is what makes it work.

`--estimate-poses` (`tools/splat4d/poses.py`) recovers the camera path from plain video, with no extra model:
1. A MoVieS depth pass runs with identity poses.
2. SIFT matches are found against the previous 1–3 frames.
3. Each camera is solved with PnP RANSAC against 3D points unprojected from the matched frame's depth.

On tennis it lands within 0.1–0.8° of the dataset rotations over an 18° pan. Lucia (a panning DAVIS clip, fed in as a video):
- **Known poses:** 99 MB, 19.4 dB at frame 0.
- **Estimated poses:** 63 MB, 21.6 dB at frame 0, slightly more see-through.

The estimate reports 16° of turn against the dataset's 11.5°. The frame-0 crop and upscale of the test clip may account for part of that.

Filming advice changes accordingly: a slow handheld arc or slide around the subject should beat a tripod.

### Iterating on lucia-est

Scores are measured from each frame's own estimated camera (`check.py --cameras`), at frames 0, middle and end.

| Variant | dB | Size |
|---|---|---|
| lucia-est (hfov 34.8, which is wrong) | 21.6 / 22.3 / 21.7 | 63 MB |
| `--splat-floor 0.5` | 23.5 / 24.3 / 22.7 | 63 MB |
| `--splat-floor 0.8` | 23.1 / 23.5 / 21.9 | 63 MB |
| floor 0.5 + `--opacity-gain 1.5` | 23.3 / 24.1 / 22.5 | 63 MB |
| `--out-times 49` | same per frame, twice as smooth | 123 MB |
| **lucia-v2**: hfov 24.17, floor 0.5, 49 moments | **23.6 / 25.0 / 23.1** | 133 MB |

- **The splat floor** adds `(0.5 px · z / fx)²` to each covariance diagonal after the cache. That closes the gaps between sub-pixel splats, so coverage goes from 0.82 to 0.94 and the result scores 2 dB higher. It is now the default.
- **The camera solver was right all along.** Lucia's real lens is 24.17° (tennis is 34.8°). The estimate over-turned by a constant 1.39×, which is exactly the focal ratio. With the right hfov it reads 11.3° against the dataset's 11.46°. Alternating the depth and pose passes changed nothing. The lens has to be right, so read it from the iPhone metadata or pass `--hfov`.
- **Output times are processed in chunks** (`--time-chunk 25`), and each moment is merged as it comes out, so 49 moments fit in memory: 84 s on the M5.

### Filming guide v2 (Herb's own clip)

Check the clip first: `tools/splat4d/preflight.sh clip.mov`. Aim for green on parallax.

- **Move sideways, don't pan.** Walk a slow arc around the subject, 0.5–1 m over 3–4 s, at 1.5–3 m distance, keeping the subject centred. Pure rotation (a pan or handheld sway) gives no new viewpoints. The drummer clip looks handheld but reads 1 px of parallax. That arc is the camera range viewers get. Repeat the arc back and forth for 30 s, or have a friend walk it.
- **Phone settings:**
  - 1× lens only, so the lens metadata gives the exact field of view.
  - HDR video off. Auto FPS off. Enhanced stabilization, Action and Cinematic modes off.
  - Lock focus and exposure (long-press).
  - 30 fps, 4K or 1080p, landscape.
- **Light and subject:** bright even light, slow clear motion, textured background, no mirrors or screens.
- **Audio:** clap once at the start and once at the end. The claps sync audio and video, and later can sync several phones.
- **The biggest jump after this:** 3–4 phones on tripods 30–40° apart, all filming the same take, synced by the clap. That is a mini version of 4DV.ai's capture rig, and MoVieS already accepts several cameras per moment.

### Round 3 (2026-10-01): research workflow, held-out evaluation, 30 s with audio

A research workflow surveyed the field (four sweeps plus synthesis and two critiques; the plan is in the session log). It found that "the 4D Chinese one" is 4DV.ai (ZJU, FreeTimeGS), captured with 20–70 synced cameras; its player craft is copyable, its multi-view data is not. Nothing on a 16 GB Mac replaces MoVieS, which was trained on 2–13 frames at 518 px.

`evaluate.py` scores exports on frames the model never saw. Held-out DAVIS frames (`flipbook --npz --holdout`: 7 inputs, 6 held out) or between-input video frames with PnP-located cameras give PSNR/SSIM/LPIPS, flicker, holes and sharpness at 10/20° swings, and MB/s. The lucia test clip is 13 stills, so its held-out rows are not valid.

| Change | Result (stroller held-out unless noted) |
|---|---|
| World-static split (`--split-static`, default) | 35.3 → 3.6 MB/s, LPIPS 0.238 → 0.193 |
| Coverage-normalized compositing in the player | the light page no longer hazes partial coverage (about 4 dB of what Herb sees) |
| Needle clamp (`--ray-clamp 2`, default) | sharpness at a 20° swing 0.94 → 1.19, on-path unchanged |
| Velocity (`--velocity`) | 7 moments glide 20.56 dB vs snap 19.49 vs 13 moments 20.92 |
| 616 px input (narrator) | no gain (LPIPS 0.148 vs 0.149), +43% size: rejected |
| Subject voxel 1.5 / 2.5 | detail vs size trade; 2 stays |
| Follow the captured camera path | the captured motion becomes the default view |
| Depth of field off the path | swings soften the parts the footage never saw |
| Explicit moment times | fixes a cursor running up to one moment ahead |

`longclip.py` (splat4d v3 stream) builds 30 s with audio:
- 3 s posed windows on one camera path, each rescaled to the path.
- One shared background for the whole clip.
- 2 s chunks of moving splats with velocity.
- `audio.m4a` as the player's master clock, muted autoplay with a Sound button, and a Buffering state.

drummer-30s (public domain, handheld at night): 241 moments, 166 MB (5.5 MB/s), 9 min on the M5. The rebuilt favourites are much smaller: `lucia-v3` is 8 MB (lucia-v2 was 133 MB) and `stroller-v3` is 10.5 MB.

`preflight.py` checks a clip for HDR, lens metadata, audio, exposure drift and real parallax before any GPU time.

Waiting on Herb's OK to download:
1. DAVIS 480p (833 MB), for real continuous held-out frames.
2. metalsplat, for per-scene optimisation on the Mac GPU, estimated +1.5–3 dB.
3. Video-Depth-Anything-Small, for a 30 s depth-video fallback.

### Round 4 (2026-10-01): smoothness, Herb's clip, refinement, camera solvers

Checkpoint tag: `splat-video-checkpoint-1` (before this round).

- **Smooth motion.** Flipbooks and streams crossfade two neighbouring moments, each gliding along its velocity: smoothstep weight, one shared sort, uniforms set with the order. This targets Herb's "still feels like a flip book".
- **Per-window backgrounds for moving-camera long clips** (see round 3). Still-camera long clips (`longclip --still`) use one shared background from the whole-clip motion mask, 1 s windows and one moment per input frame.
- **Herb's Photo Booth clip** (`~/dev/splat-clips/herb-photobooth.mov`, 150 s webcam, guitar with audio, lens assumed 70° across):
  - preflight is red on parallax (6 px), as expected for a webcam;
  - `herb-flip`: 4 s windowed flipbook at 12 fps with velocity and crossfade, 53 MB;
  - `herb-depth-30s`: depth video with audio muxed in, 14 MB;
  - `herb-30s`: still-camera splat stream with audio.
- **Depth-video plate.** It no longer uses the median of all frames, which kept a ghost of an ever-present subject. It now averages only far pixels (Otsu split on disparity) and inpaints what is never seen (`--plate far`, default).
- **Refinement with metalsplat** (`refine.py`, MIT; Apple GPU, 36 ms per render plus backward pass for 200k splats). Fitting stroller against all 43 non-held-out frames:

  | Variant | PSNR | SSIM | LPIPS |
  |---|---|---|---|
  | none | 20.92 | 0.672 | 0.180 |
  | colour | 21.08 | 0.630 | 0.260 |
  | colour + opacity | 21.15 | 0.620 | 0.249 |
  | all, background frozen | 20.65 | 0.597 | 0.231 |

  PSNR rises a little but the perceptual scores get worse: the fit paints per-splat noise. Not adopted. Two lessons: the training render must use the player's coverage-normalized compositing, and the exact principal point (DAVIS's is about 3 px off centre), now recorded as `camera.intrinsics`.
- **Camera paths.** The DAVIS npz samples are video frames 0–48 at every 4th frame (2 s), so comparisons against them must use the same span. Over matching spans the essential-matrix rotation tracks the dataset well, and the PnP solver over-turns about 1.2–1.6× on translating clips. `flipbook --poses vggt` uses VGGT-1B (now downloaded) for the cameras and lens before MoVieS loads.
- **Compression.** gzip gives 1.03–1.1× on splat bins; Morton order plus delta coding gives 1.26× on positions only. Not worth it.

### Round 5 (2026-10-02): finishing pass

- **Still-camera depth anchoring.** Chained window depth on Herb's 30 s webcam clip drifted from 1.27 to 0.24 on the window behind him, about 6×. Depth video, the windowed flipbook and `longclip --still` now anchor every window to the first frame on the far half of the image, so the window reads 1.27 throughout.
- **Depth-video plate.** Two depth layers (subject against everything behind) replace Otsu and the three-layer split. Herb's plate is now just the room, with inpainting where he always sits.
- **Crossfade scoring** (`evaluate --blend`, stroller, 7 moments, held-out frames halfway between moments):
  - snap: 19.37 dB, flicker 0.86
  - glide: 20.93 dB, flicker 0.84
  - crossfade: 21.02 dB, flicker 0.81, as good as 13 moments
  - So still clips now emit half the moments per second (`--moment-stride 2`).
- **VGGT by default** for spread flipbooks from video (DAVIS stroller, 2 s, 12 real held-out frames):

  | Cameras | Lens | PSNR | SSIM | LPIPS |
  |---|---|---|---|---|
  | VGGT, no lens given | 46.8° (dataset 47.2°) | 20.63 | 0.614 | 0.214 |
  | PnP, given the true lens | – | 20.16 | 0.569 | 0.240 |

  Long clips still use the PnP path.
- **Three-tier still clips.** One background, the subject's still splats per 1 s window as chunk-shared rows, and only moving splats per moment. herb-30s went from 464 MB to 106 MB (3.5 MB/s, 181 moments) and plays without buffering.
- **Report:** https://claude.ai/artifact/9GhUwdbD7DBowTd3A7UCBF (private; it has the experiment ledger and figures).

### Round 6 (2026-10-03): hybrid, the 4DV.ai pass

Herb's verdict on round 5: the splat background is the magic, but the splat subject blurs, ghosts ("phasing in and out of my old frame self") and grows speckled halos. He wants the subject crisp at native frame rate with no in-betweening, and asked how close one video can get to 4DV.ai.

**What 4DV.ai is** (research workflow, 5 areas plus a critic):
- FreeTimeGS-style Gaussians: each one has a time centre, a velocity and a temporal opacity.
- Captured with 18-70 synchronised cameras.
- Played back by a stock WebGL2 PlayCanvas viewer at about 12.5 MB/s.

Their cleanliness comes from the capture, not the renderer. From one webcam, the reachable version is a pixel-sharp subject near the lens over a splat room.

**The hybrid clip kind** (`kind: "hybrid"`, version 3):
- **Background:** the MoVieS window splats with every splat under the subject removed (per-window matte union), re-coloured from the clean plate. Gaps are filled by:
  - plate splats wherever rendered coverage falls under 0.5;
  - an 8% margin past the frame edges;
  - a low-resolution backstop layer 4% behind everything, so parallax never shows page colour.
- **Subject:** the original video, one decoded frame per source frame at 29.97 fps. There are no moments, no crossfade and no glide. It is packed in one H.264 atlas:
  - colour at 1598x1080;
  - depth and alpha bands at 777x525;
  - the clip's audio muxed in.
- **Player:** draws the subject as a depth-displaced mesh in two passes, an opaque core and then a premultiplied rim. It also has:
  - a splat look that draws the same texels as soft points;
  - a per-frame background gain, so the room follows Photo Booth's auto-exposure (0.925-1.048);
  - a 1.08x view zoom and feathered frame borders.

**Matte.** The default is Apple Vision subject lifting (`--matte vision`, via `vision_matte.swift`). It runs at about 15 ms a frame, holds steady, and keeps the guitar as part of the subject. BiRefNet-matting at 1024 px draws finer hair. The combined matte uses Vision as the shape (core eroded 6 px, cleared 12 px outside) with BiRefNet in the band between.

The combined matte flickered twice as much once encoded, so Vision won. After the matte comes:
- detached islands dropped;
- a median of three frames;
- a guided filter against the full-resolution frame;
- a motion-gated hold that freezes alpha where the video is still.

| Matte, on 30-34 s | Encoded edge flicker | LPIPS |
|---|---|---|
| Vision | 0.018 | 0.055 |
| Combined | 0.040 | 0.058 |

**Edge colour.** The camera is still and the plate is known, so edge pixels are unmixed exactly: F = (I - (1 - a) B) / a. Light from the window no longer rings the hair.

**Depth.** The subject's depth comes from Depth Anything V2 Small (`--subject-depth dav2`; Apache-2.0, from Hugging Face, no remote code), run at 770x518 on MPS in about 40 s for 30 s of video.

That depth is relative and its scale swings frame to frame (fitted gain 0.15-0.27). Each frame is fitted to the MoVieS disparity on the solid subject core with a trimmed least-squares scale and shift, and the fit is median-filtered over 15 frames. Then:
- the depth is filled outward from a core eroded 3 px, so edge vertices never sit between subject and wall;
- a motion-gated hold is applied.

On static subject pixels, jitter goes from 0.83 levels per frame with MoVieS depth to 0.69. The guitar, hands, collar and face carry their own relief. `--subject-depth movies` keeps the old path: the anchored MoVieS window depth, a temporal median of 5 frames, guided upsampling.

**Plate behind the subject.** It is filled row by row from the room on either side, so window bars and the couch continue. Push-pull and Telea fills both left a visible silhouette.

**Scores** (`tools/splat4d/hybrid_eval.py`, 16 frames of herb-hybrid at 800 px, at the lens against the source):

| | herb-30s splat stream | herb-hybrid (Vision) | herb-hybrid (combined) |
|---|---|---|---|
| PSNR | 26.05 | 31.20 | 32.01 |
| SSIM | 0.892 | 0.943 | 0.952 |
| LPIPS | 0.100 | 0.067 | 0.064 |
| PSNR on the subject (matte dilated 8 px) | 24.88 | 32.20 | 33.34 |
| Static-edge flicker | n/a | 0.017 | 0.035 |
| Depth jitter, levels per frame | n/a | 0.69 (Depth Anything V2) | 0.85 (MoVieS depth) |
| MB/s | 3.5 | 0.98 | 1.0 |

The combined matte wins single frames, but it flickers twice as much, which is exactly the "phasing" Herb objected to.

Off-axis there is no ground truth. The leash is +-12 degrees of yaw. Checking it in the real player showed a sharp subject and a room that parallaxes correctly. Two artifacts turned up and are now fixed: matte fragments of window glare that floated at the subject's depth, and background cracks showing page colour. A code review with adversarial verification confirmed 12 more defects, all fixed:
- `-shortest` dropped the last 4 frames in the mux;
- odd crop widths sheared frames;
- Splat look points had no depth test;
- the rim drew twice;
- a stale seek fired on scrub release;
- the plate kept an exposure bias;
- unmeasured frames got gain 1.0;
- the long-side FOV and rotation were wrong for portrait clips;
- the cache settings were never checked;
- plus three smaller ones.

**Rebuild:**

```bash
tools/splat4d/hybrid.sh --video ~/dev/splat-clips/herb-photobooth.mov --start 30 --end 60 --hfov 70 --depth-cache ~/dev/MoVieS/out/herb-depth-30s/depth_outputs.npz --windows ~/dev/MoVieS/out/herb-30s --out public/splats/4d/herb-hybrid
```

The two inputs come from earlier steps: `--depth-cache` from `depthvideo.sh`, and `--windows` from `longclip.sh --still`. Vision masks take about 4 minutes and are then cached; the rest of the export takes about 6 minutes. `hybrid.py` refuses caches whose start, end, fps, window length or source clip don't match the run.

**Second clip, no tuning:**
- **Clip:** `kristen-hybrid`, Xiph's public-domain Kristen and Sara: two people, 1280x720 at 60 fps, 9 s.
- **Speed:** the hybrid built in 93 s once its caches existed.
- **Scores against its own splat stream at the lens:**
  - LPIPS 0.081 against 0.124;
  - PSNR 25.4 against 23.7 dB;
  - 27.9 against 23.9 dB on the people.
- **Clean:** edge flicker is 0.023, and the odd 1269 px crop decodes without shearing now.
- **Weak spots:**
  - depth jitter is 1.24 levels per frame, with two moving heads at 60 fps;
  - the poster's small print stays soft, because splats come from 518 px input;
  - a faint blue fringe shows where the matte cuts hair against the blue wall.

```bash
tools/splat4d/depthvideo.sh --video ~/dev/splat-clips/kristen.webm --start 0 --end 10 --hfov 60 --out public/splats/4d/kristen-depth
tools/splat4d/longclip.sh --video ~/dev/splat-clips/kristen.webm --start 0 --end 10 --still --window-seconds 1 --hfov 60 --subject-voxel 2 --out public/splats/4d/kristen-stream
tools/splat4d/hybrid.sh --video ~/dev/splat-clips/kristen.webm --start 0 --end 9 --hfov 60 --depth-cache ~/dev/MoVieS/out/kristen-depth/depth_outputs.npz --windows ~/dev/MoVieS/out/kristen-stream --out public/splats/4d/kristen-hybrid
```

`longclip --still` only writes whole windows, so a 10 s request covers 9 s. hybrid.py's cache check refused `--end 10` for that reason.

**Streaming:** the player loads the 4.5 MB room, then streams `layer.mp4` through the video element with range requests. It is ready in about 0.3 s locally, and shows the buffering pill if the video stalls.

**Splat subject (default look).** Herb asked for the person to be splats too, crisp like 4DV. The player now generates one oriented Gaussian surfel per colour pixel (1598x1080, about 1.7M) on the GPU from the video every frame:
- Each surfel spans the pixel's tangent vectors from neighbouring depth. The shorter one-sided difference is used, clamped at 5x the pixel footprint.
- It is projected with the same EWA Jacobian as the room splats.
- Solid pixels draw as opaque elliptical discs. They write depth with a small cone, so each pixel keeps its own colour.
- The matte edge draws as soft premultiplied Gaussians.

At the lens it is as sharp as the video look. Off-axis it foreshortens like real splats, at 60 fps on the M5. Phones use the depth-band grid.

**Edge matting against the plate.** Within 10 px of the matte edge, pixels that match the plate (max channel difference ramping from 8 to 28) lose alpha. This only applies where the plate was really seen. Window light inside the generous Vision matte no longer floats as white dots on the jaw. Subject PSNR went from 32.20 to 33.50.

**LaMa plate fill.** Allowed by Herb. Big-LaMa runs at 512 px for the never-seen region behind the subject, then is upscaled and blended. At full resolution LaMa smeared the couch; at 512 px the sill, couch back and cushion continue.

**Moving camera (experimental, not shipped).** `hybrid.py` detects window caches made without `--still`. It then:
- reads `poses.npz`;
- builds one world background from the per-window splats, with subject splats removed by a majority vote against matte and depth;
- writes the camera path, so the player places the layer on it.

On the drummer it scored below the drummer-30s stream at the lens, so the clip was not kept:

| | drummer-30s stream | moving hybrid |
|---|---|---|
| PSNR | 23.0 | 19.6 |
| LPIPS | 0.176 | 0.232 |
| Edge flicker | n/a | 0.19 |

There are two reasons. One background for 30 s of handheld footage blurs, as round 3 already found. And the Vision matte flickers on a night street with several people. Making it work needs per-window backgrounds streamed as chunks, and a tracked matte for a chosen subject (SAM 2).

**Second review round.** 11 defects confirmed with adversarial verification, all fixed:
- The plate skips frames where the matte found no subject, and frames whose exposure gain is unusable. A one-frame matte dropout used to paint the person into the plate, and a black frame used to make it NaN.
- `drop_islands` zeroes only the dropped islands.
- The cache check now compares the lens, so a mismatched `--hfov` is caught.
- The colour band is capped at 1920 px, so 4K sources stay inside H.264 level 5.2.
- A clip with no subject fails early with a clear message.
- Moving-camera times come from the posed frames.
- In the player:
  - crossing the 900 px breakpoint no longer rebuilds the clip, and the clock no longer loses its place before metadata arrives;
  - a missing layer video shows the normal error;
  - moving clips pose the subject from the presented video frame (`requestVideoFrameCallback`).

**LaMa:** the first download attempt (a torchscript file from a third-party GitHub release) was refused by the permission check. After Herb gave permission it is used, as described above.

Still open after round 5:
- **The splat subject still reads as a flipbook.** Each moment is its own merged set of splats, so frames crossfade instead of the same splats moving. Round 6 sidesteps this with the hybrid clip kind. The identity-preserving fix is still possible: per window, keep the subject splats from a few key frames, store their positions at every model output time, and fade each splat's opacity in and out around its own source time. The model already returns identity-aligned positions before the voxel merge (`infer.window_frames`).
- Long clips with a moving camera still use the PnP camera chain, not VGGT.
- The crossfade has not been checked on a phone.

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
| Source clips (Herb's Photo Booth clip, DAVIS, public-domain test clips, licences) | `~/dev/splat-clips/` | no |
| Window caches and per-run outputs | `~/dev/MoVieS/out/<name>/` | no |
| DAVIS npz files with ground-truth poses | `~/dev/MoVieS/resources/DAVIS/` | no |
| metalsplat (refinement experiment) | `~/dev/metalsplat` | no |
| Lab report HTML, template and figures | `~/dev/splat-notes/`, published privately at https://claude.ai/artifact/9GhUwdbD7DBowTd3A7UCBF | no (DAVIS imagery stays local) |
| Clip check workflow | `.claude/workflows/splat-video-runcheck.js`: ask Claude to run the `splat-video-runcheck` workflow; pass clip names as args to check others | yes |
| Dev server config for the preview pane | `.claude/launch.json` | yes |

Work on a branch, never `main`. Never commit weights, clips or generated scene data.

### Rebuild the favourites

Generated scenes aren't in git, so these commands recreate them. Run them from the repo root. Each scene's `meta.json` records its source clip, time range and lens, so you can check a rebuild against it.

```bash
tools/splat4d/longclip.sh --video ~/dev/splat-clips/herb-photobooth.mov --start 30 --end 60 --still --window-seconds 1 --hfov 70 --subject-voxel 2 --out public/splats/4d/herb-30s
tools/splat4d/depthvideo.sh --video ~/dev/splat-clips/herb-photobooth.mov --start 30 --end 60 --hfov 70 --out public/splats/4d/herb-depth-30s
tools/splat4d/flipbook.sh --video ~/dev/splat-clips/herb-photobooth.mov --start 32 --end 36 --hfov 70 --fps 12 --subject-voxel 2 --velocity --fresh --out public/splats/4d/herb-flip
tools/splat4d/longclip.sh --video ~/dev/splat-clips/drummer.webm --start 0 --end 30 --holdout --out public/splats/4d/drummer-30s
tools/splat4d/flipbook.sh --npz resources/DAVIS/stroller.npz --subject-voxel 2 --out-times 25 --velocity --out public/splats/4d/stroller-v3
tools/splat4d/flipbook.sh --video ~/dev/splat-clips/lucia-13frames.mov --spread --estimate-poses --hfov 24.17 --subject-voxel 2 --out-times 25 --velocity --out public/splats/4d/lucia-v3
```

| Clip | Build time on the M5 |
|---|---|
| herb-30s | about 18 min |
| drummer-30s | about 9 min |
| the short clips | a few minutes each |

herb-flip, stroller-v3 and lucia-v3 were built before VGGT became the default camera solver. Add `--poses pnp` to reproduce them exactly.

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
