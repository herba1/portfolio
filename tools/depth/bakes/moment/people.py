"""Moment, step 1a: where is the jumper in every frame?

    python3 -I people.py <frames dir> <out.json>

YOLOv10-m (COCO, ONNX from onnx-community/yolov10m) on each whole frame,
letterboxed to 640. The best person box per frame (full-res px) is what the
plate step uses to decide which frames may lend a pixel: a frame may lend
any pixel outside its (padded) box. A median-based background subtraction
does not work here, because the jumper stands in the same column of sky for
most of the clip and the median keeps his ghost.
"""
import sys, os, glob, json
import numpy as np, cv2
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import kit  # noqa: E402

fs = sorted(glob.glob(sys.argv[1] + "/f*.jpg"))
sess = kit.session("yolov10m/model.onnx", threads=3)
out = {}
for f in fs:
    im = cv2.imread(f)[:, :, ::-1]
    H, W = im.shape[:2]
    s = 640 / max(H, W)
    sm = cv2.resize(im, (round(W * s), round(H * s)), interpolation=cv2.INTER_AREA)
    t = np.full((640, 640, 3), 114, np.uint8)
    t[: sm.shape[0], : sm.shape[1]] = sm
    det = sess.run(None, {"images": (t.astype(np.float32) / 255).transpose(2, 0, 1)[None]})[0][0]
    ppl = [d for d in det if int(d[5]) == 0 and d[4] > 0.2]
    n = int(os.path.basename(f)[1:4])
    if ppl:
        # the jumper is the largest confident person
        b = max(ppl, key=lambda d: (d[2] - d[0]) * (d[3] - d[1]) * (d[4] > 0.4))
        out[n] = [float(v / s) for v in b[:4]] + [float(b[4])]
    else:
        out[n] = None
    print(n, out[n] and [round(v) for v in out[n][:4]], flush=True)
json.dump(out, open(sys.argv[2], "w"))
