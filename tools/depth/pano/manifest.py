import json, sys
from PIL import Image
S = json.load(open('/tmp/claude-0/imgs-scripts/spec.json'))
A = json.load(open('/tmp/claude-0/imgs/ph/hdris.json'))
notes = json.load(open('/tmp/claude-0/imgs-scripts/notes.json'))
keep = [l.strip() for l in open('/tmp/claude-0/imgs-scripts/keep.txt') if l.strip()]
out = []
for slug in keep:
    e = next(x for x in S if x["slug"]==slug); a = A[e["src"]]
    w,h = Image.open(f"/tmp/claude-0/imgs/picks/{slug}.jpg").size
    out.append(dict(slug=slug, file=f"{slug}.jpg", depth=f"{slug}-depth.png", depth_preview=f"{slug}-depth-8.png", linear_hdr=f"{slug}-linear.hdr",
      source_page=f"https://polyhaven.com/a/{e['src']}", source_asset=e["src"],
      direct_url=f"https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/16k/{e['src']}_16k.hdr",
      author=", ".join(a.get("authors",{}).keys()), licence="CC0 1.0 (Poly Haven)",
      width=w, height=h,
      derivation=f"rectilinear view reprojected from the 16k equirect HDRI: yaw {e['yaw']}, pitch {e['pitch']} (negative = looking up), hfov {e['hfov']} deg; soft film grade (Hable shoulder, warm halation, lifted cool blacks, deep-blue saturation), ev {e['ev']}",
      why=notes[slug]["why"], suits=notes[slug]["suits"]))
json.dump(out, open('/tmp/claude-0/imgs/picks/manifest.json','w'), indent=1)
print(len(out))
