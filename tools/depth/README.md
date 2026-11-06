# Depth maps for lab pieces

`depth.py` turns a photo into a relative depth map (white = near) with Depth Anything V2 Small (ONNX).

    pip install onnxruntime pillow numpy
    curl -L -o tools/depth/da2s.onnx https://github.com/fabio-sim/Depth-Anything-ONNX/releases/download/v2.0.0/depth_anything_v2_vits.onnx
    python3 tools/depth/depth.py photo.jpg photo-depth.png

Writes a 16-bit PNG and an 8-bit `-8.png` preview at the photo's resolution. The model file is not committed.
