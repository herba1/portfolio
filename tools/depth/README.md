# Depth maps for lab pieces

`depth.py` turns a photo into a relative depth map (white = near) with Depth Anything V2 Small (ONNX).

    pip install onnxruntime pillow numpy
    curl -L -o tools/depth/da2s.onnx https://github.com/fabio-sim/Depth-Anything-ONNX/releases/download/v2.0.0/depth_anything_v2_vits.onnx
    python3 tools/depth/depth.py photo.jpg photo-depth.png

Writes a 16-bit PNG and an 8-bit `-8.png` preview at the photo's resolution. The model file is not committed.

`depth_hr.py` is the sharper version (same model, same outputs: 16-bit PNG + `-8.png`, white = near). It runs an aspect-correct global pass, then overlapping 518 tiles at 2x and 4x that are robustly aligned (scale, shift, tilt) to the coarser pass and feather-blended, then snaps depth edges to photo edges. No tile seams, no hair halos; about a minute for a 24 MP photo on 4 cores.

    python3 tools/depth/depth_hr.py photo.jpg photo-depth.png   # --levels 2,4  --no-refine
