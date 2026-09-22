// Tell IndexNow (Bing, Yandex, Naver, Seznam, DuckDuckGo via Bing) that the
// site changed, so a deploy is crawled in minutes instead of whenever the
// next scheduled visit lands. Google does not take part; it reads the sitemap.
//
// The key is public by design: IndexNow proves ownership by fetching
// https://herb.art/<key>.txt and checking it contains the key, so the file
// lives in public/ and the value lives here. Rotating it means changing both.
//
// Usage: node scripts/indexnow.mjs            (submits every sitemap URL)
//        node scripts/indexnow.mjs /bio /fish (submits just those paths)
// Run by .github/workflows/indexnow.yml after each production deployment.

const SITE = "https://herb.art"
const KEY = "d2498866a7bcdb9c2415f53065c22dcb"
const ENDPOINT = "https://api.indexnow.org/indexnow"

async function urlsFromSitemap() {
  const res = await fetch(`${SITE}/sitemap.xml`, { headers: { "user-agent": "herb.art indexnow" } })
  if (!res.ok) throw new Error(`sitemap fetch failed: ${res.status}`)
  const xml = await res.text()
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1].trim())
    .filter((u) => u.startsWith(SITE))
}

const args = process.argv.slice(2)
const urlList = args.length ? args.map((p) => (p.startsWith("http") ? p : `${SITE}${p}`)) : await urlsFromSitemap()

if (!urlList.length) {
  console.error("indexnow: nothing to submit")
  process.exit(1)
}

const res = await fetch(ENDPOINT, {
  method: "POST",
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({
    host: "herb.art",
    key: KEY,
    keyLocation: `${SITE}/${KEY}.txt`,
    urlList,
  }),
})

// 200 = accepted, 202 = accepted and the key will be validated shortly.
console.log(`indexnow: ${res.status} for ${urlList.length} url(s)`)
if (![200, 202].includes(res.status)) {
  console.error(await res.text())
  process.exit(1)
}
