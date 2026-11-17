# Survey candidate skies: each HDRI seen through the photo's camera at 12 headings.
#   python3 -I survey.py out.jpg sky1.hdr sky2.hdr ...
import sys, os, numpy as np, cv2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cam import *
out = sys.argv[1]
tw, th = 160, 122
d = cam_dirs(tw, th)
rows = []
for fn in sys.argv[2:]:
    eq = load_hdr(fn)
    eq = cv2.resize(eq, (1024, 512), interpolation=cv2.INTER_AREA) if eq.shape[1] > 1024 else eq
    lon, lat, mx = find_sun(eq)
    tiles = []
    for k in range(12):
        yaw = k * 30
        M = cam_to_world_basis(yaw)
        dw = d @ M.T
        im = sample(eq, dw)
        L = im @ LUMW
        ev = np.log2(0.25 / max(np.median(L), 1e-6))
        t = tm(im, ev)[..., ::-1].copy()
        sun = np.array([np.cos(lat) * np.sin(lon), np.sin(lat), np.cos(lat) * np.cos(lon)])
        sc = M.T @ sun  # cam coords
        ang = np.degrees(np.arccos(np.clip(-sc[2], -1, 1)))
        cv2.putText(t, f"{yaw} s{ang:.0f}", (3, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 255), 1)
        tiles.append(t)
    row = np.hstack(tiles)
    lab = np.zeros((14, row.shape[1], 3), np.uint8)
    cv2.putText(lab, f"{os.path.basename(fn)[:40]} sun lon {np.degrees(lon):.0f} lat {np.degrees(lat):.0f} max {mx:.0f}", (3, 11), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1)
    rows += [lab, row]
    print(fn, np.degrees(lon), np.degrees(lat), mx, flush=True)
cv2.imwrite(out, np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 85])
