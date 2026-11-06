import json, subprocess, sys, urllib.parse, os
out = sys.argv[1]
queries = sys.argv[2:]
res = json.load(open(out)) if os.path.exists(out) else {}
import time
for q in queries:
    params = {"action":"query","format":"json","generator":"search","gsrnamespace":"6","gsrlimit":"50",
              "gsrsearch": q + " filetype:bitmap filew:>3000",
              "prop":"imageinfo","iiprop":"url|size|extmetadata","iiurlwidth":"400",
              "iiextmetadatafilter":"LicenseShortName|Artist|ImageDescription|Credit|UsageTerms"}
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params)
    d=None
    for att in range(5):
        time.sleep(4+att*12)
        raw = subprocess.run(["curl","-sS","-A","PortfolioLabCuration/0.1 (one-off script curating CC-licensed photos)",url],capture_output=True).stdout
        try: d = json.loads(raw); break
        except Exception: print("retry", q, att, flush=True)
    if d is None: continue
    for p in d.get("query",{}).get("pages",{}).values():
        ii = p.get("imageinfo",[{}])[0]
        md = ii.get("extmetadata",{})
        res[p["title"]] = dict(title=p["title"], q=q, w=ii.get("width"), h=ii.get("height"), url=ii.get("url"),
            thumb=ii.get("thumburl"), page=ii.get("descriptionurl"),
            lic=md.get("LicenseShortName",{}).get("value"), artist=md.get("Artist",{}).get("value"))
    json.dump(res, open(out,"w"), indent=1)
    print(q, len(d.get("query",{}).get("pages",{})), flush=True)
json.dump(res, open(out,"w"), indent=1)
print(len(res))
