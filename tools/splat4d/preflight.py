import argparse
import json
import math
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from inputs import cover_resize, decode_frame, focal_35mm, probe, video_stream

WIDTH = 518
GOOD_PARALLAX_PX = 20.0
FAIR_PARALLAX_PX = 8.0


def frame_at(video, t, size):
    image, _ = cover_resize(decode_frame(video, t), size)
    return cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2GRAY)


def parallax(a, b):
    sift = cv2.SIFT_create(nfeatures=3000)
    kp_a, des_a = sift.detectAndCompute(a, None)
    kp_b, des_b = sift.detectAndCompute(b, None)
    if des_a is None or des_b is None:
        return None
    pairs = [m for m, n in (p for p in cv2.BFMatcher().knnMatch(des_a, des_b, k=2) if len(p) == 2) if m.distance < 0.75 * n.distance]
    if len(pairs) < 30:
        return None
    src = np.float32([kp_a[m.queryIdx].pt for m in pairs])
    dst = np.float32([kp_b[m.trainIdx].pt for m in pairs])
    H, _ = cv2.findHomography(src, dst, cv2.LMEDS)
    F, mask = cv2.findFundamentalMat(src, dst, cv2.FM_RANSAC, 1.5, 0.999)
    if H is None or F is None:
        return None
    inliers = mask.ravel().astype(bool)
    warped = cv2.perspectiveTransform(src[inliers][None], H)[0]
    residual = np.linalg.norm(warped - dst[inliers], axis=1)
    return float(np.median(residual)), float(np.percentile(residual, 90)), int(inliers.sum())


def main():
    parser = argparse.ArgumentParser(description="Check a clip before spending GPU time on it")
    parser.add_argument("video")
    parser.add_argument("--start", type=float, default=0.0)
    parser.add_argument("--end", type=float, default=None)
    args = parser.parse_args()

    info = probe(args.video)
    stream = video_stream(info)
    duration = float(info["format"].get("duration") or stream.get("duration"))
    end = min(args.end if args.end is not None else duration, duration - 0.1)
    width, height = int(stream["width"]), int(stream["height"])
    rotation = next((int(d.get("rotation", 0)) for d in stream.get("side_data_list", []) if "rotation" in d), 0)
    if abs(rotation) in (90, 270):
        width, height = height, width
    long_side = max(width, height)
    size = (WIDTH, round(WIDTH * height / width / 14) * 14) if width >= height else (round(WIDTH * width / height / 14) * 14, WIDTH)

    report, verdicts = {}, []
    transfer = stream.get("color_transfer", "")
    report["hdr"] = transfer in ("arib-std-b67", "smpte2084")
    verdicts.append(("red" if report["hdr"] else "green", f"HDR {'on (' + transfer + ')' if report['hdr'] else 'off'}"))
    f35 = focal_35mm(info)
    report["focal_35mm"] = f35
    if f35:
        hfov = math.degrees(2 * math.atan(long_side / math.hypot(width, height) * 21.635 / f35))
        report["hfov"] = round(hfov, 1)
        verdicts.append(("green", f"lens metadata found: {f35:g} mm equivalent, about {hfov:.0f} deg across"))
    else:
        verdicts.append(("amber", "no lens metadata: pass --hfov (iPhone 1x is about 65-70 deg across the long side)"))
    fps_text = stream.get("avg_frame_rate", "0/1")
    numerator, _, denominator = fps_text.partition("/")
    fps = float(numerator) / float(denominator or 1) if float(numerator or 0) else 0.0
    report["fps"] = round(fps, 2)
    report["audio"] = any(s.get("codec_type") == "audio" for s in info["streams"])
    verdicts.append(("green" if report["audio"] else "amber", "audio track present" if report["audio"] else "no audio track"))

    times = np.linspace(args.start, end, 7)
    frames = [frame_at(args.video, t, size) for t in times]
    brightness = [float(f.mean()) for f in frames]
    report["exposure_drift"] = round(max(brightness) - min(brightness), 1)
    verdicts.append(("green" if report["exposure_drift"] < 20 else "amber", f"exposure drift {report['exposure_drift']:.0f}/255 across the clip"))

    spans = []
    for gap in (1, 2, 3):
        for i in range(0, len(frames) - gap):
            measured = parallax(frames[i], frames[i + gap])
            if measured:
                spans.append((times[i + gap] - times[i], *measured))
    if spans:
        p90 = max(s[2] for s in spans)
        median = float(np.median([s[1] for s in spans]))
        report["parallax_px"] = {"median": round(median, 1), "p90_max": round(p90, 1)}
        level = "green" if p90 >= GOOD_PARALLAX_PX else "amber" if p90 >= FAIR_PARALLAX_PX else "red"
        meaning = {"green": "real sideways camera travel: good 3D range", "amber": "a little travel: modest range",
                   "red": "almost no travel (tripod or pure pan): 3D range will be small"}[level]
        verdicts.append((level, f"off-plane parallax p90 {p90:.0f} px at {size[0]} px wide: {meaning}"))
    else:
        verdicts.append(("red", "could not match features between frames (too dark, blurry or featureless)"))

    for level, text in verdicts:
        print(f"[{level:5}] {text}")
    worst = "red" if any(v[0] == "red" for v in verdicts) else "amber" if any(v[0] == "amber" for v in verdicts) else "green"
    print(f"overall: {worst}")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
