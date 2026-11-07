"""Moment, step 1: stabilise the clip, find the jumper in every frame, and
build a clean background plate from real pixels.

    python3 -I plate.py <frames dir> <work dir> [--a 78 --b 90]

The GoPro sits on the ground and drifts about 2 px over the clip as the
jumper lands, so every frame is first registered to the middle frame by
phase correlation on the hotel facade (translation only, sub-pixel).

What must be replaced is the jumper's SAM matte (sam/m<n>.png) at A, the
middle frame and B, grown 9 px. Which frames may lend a pixel is decided by
YOLO person boxes (people.py), padded: generous, but the jumper stands in the
same column of sky for most of the clip, so a median background would keep
his ghost.

The plate is the middle frame, and wherever the jumper covers it in the
middle frame, or in either shutter frame, the pixel comes from the
temporally nearest frame in which that pixel is clear. Every pixel the
jumper crosses between the two shutter presses is therefore a real
photograph of what was behind him, not an inpainting. Pixels he never
leaves are reported (and handed to fill.py if any).

Writes: stab/f<n>.png for the frames used, plate.png, hole.png (pixels no
frame could clear), fg<n>.png masks, shifts.json.
"""
import argparse, glob, json, os
import numpy as np
import cv2

ap = argparse.ArgumentParser()
ap.add_argument("frames")
ap.add_argument("work")
ap.add_argument("--a", type=int, default=78)
ap.add_argument("--b", type=int, default=90)
ap.add_argument("--lo", type=int, default=24)
ap.add_argument("--hi", type=int, default=120)
ap.add_argument("--boxes", default=None)
args = ap.parse_args()
args.boxes = args.boxes or args.work + "/boxes.json"
os.makedirs(args.work + "/stab", exist_ok=True)

A, B = args.a, args.b
MID = (A + B) // 2
ids = list(range(args.lo, args.hi + 1))
path = lambda n: f"{args.frames}/f{n:03d}.jpg"

ref = cv2.imread(path(MID), 0).astype(np.float32)
x0, x1, y0, y1 = 1000, 1560, 300, 900  # hotel facade, never crossed by the jumper
win = cv2.createHanningWindow((x1 - x0, y1 - y0), cv2.CV_32F)
shifts = {}
frames = {}
for n in ids:
    im = cv2.imread(path(n))
    g = im.mean(2).astype(np.float32)
    (dx, dy), _ = cv2.phaseCorrelate(ref[y0:y1, x0:x1], g[y0:y1, x0:x1], win)
    M = np.float32([[1, 0, -dx], [0, 1, -dy]])
    frames[n] = cv2.warpAffine(im, M, (im.shape[1], im.shape[0]), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REFLECT)
    shifts[n] = [round(dx, 3), round(dy, 3)]
H, W = frames[MID].shape[:2]
print("registered", len(ids), "frames; max shift", max(abs(v[0]) + abs(v[1]) for v in shifts.values()))

# who may lend which pixel: a frame lends anything outside its padded
# person box (people.py)
boxes = json.load(open(args.boxes))
masks = {}
for n in ids:
    m = np.zeros((H, W), np.uint8)
    b = boxes.get(str(n))
    if b:
        p = 28
        m[max(0, int(b[1]) - p) : int(b[3]) + p, max(0, int(b[0]) - p) : int(b[2]) + p] = 1
    masks[n] = m
# what has to be replaced: the jumper's SAM mattes at A, MID and B, grown a
# little past his edge (motion blur, the matte's own soft edge)
grow = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (19, 19))
for n in (A, MID, B):
    sam = cv2.imread(f"{args.work}/sam/m{n:03d}.png", 0) > 127
    masks[n] = cv2.dilate(sam.astype(np.uint8), grow)
    cv2.imwrite(f"{args.work}/fg{n}.png", masks[n] * 255)

# plate: the middle frame, with what the jumper covers at A, MID or B taken
# from the nearest frame in which it is clear
cover = (masks[A] | masks[MID] | masks[B]).astype(bool)
plate = frames[MID].copy()
todo = cover.copy()
order = sorted(ids, key=lambda n: (abs(n - MID), n))
used = np.full((H, W), -1, np.int16)
for n in order:
    if not todo.any():
        break
    if n in (A, MID, B):
        continue
    ok = todo & (masks[n] == 0)
    plate[ok] = frames[n][ok]
    used[ok] = n
    todo &= ~ok
# soften the seams between borrowed and native pixels (the sky moved a little)
seam = cv2.GaussianBlur(cover.astype(np.float32), (0, 0), 6)[..., None]
plate = (plate.astype(np.float32) * np.clip(seam * 1.5, 0, 1) + frames[MID].astype(np.float32) * (1 - np.clip(seam * 1.5, 0, 1)))
plate = np.where(cover[..., None], plate, frames[MID]).astype(np.uint8)
print("covered", round(cover.mean(), 4), "unrecovered", int(todo.sum()), "px; frames used", sorted(set(used[used >= 0].ravel().tolist()))[:40])
cv2.imwrite(f"{args.work}/plate.png", plate)
cv2.imwrite(f"{args.work}/hole.png", todo.astype(np.uint8) * 255)
for n in range(A, B + 1):
    cv2.imwrite(f"{args.work}/stab/f{n:03d}.png", frames[n])
json.dump({"a": A, "b": B, "mid": MID, "shifts": shifts}, open(f"{args.work}/shifts.json", "w"), indent=1)
