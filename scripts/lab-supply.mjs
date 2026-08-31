import {
  BATCH_FILE,
  IDEAS_FILE,
  MODELS,
  NOTES_FILE,
  SEED_FILE,
  SOURCES_FILE,
  TASTE_SKILL,
  VOTES_FILE,
  args,
  claude,
  effectiveVerdicts,
  fmtRun,
  jaccard,
  listManifests,
  log,
  newId,
  now,
  parseJsonLoose,
  readJson,
  readJsonl,
  readText,
  tasteVersion,
  tokens,
  writeJson,
  writeJsonl,
} from "./lab-lib.mjs";

const opts = args();
const count = Number(opts.count || 3);
const sourcesConfig = readJson(SOURCES_FILE, {});
const focusUi = sourcesConfig.focus === "ui";
const doHarvest = !opts["no-harvest"] && !focusUi;
const doScout = !opts["no-scout"];
const BRIEFS_FILE = SOURCES_FILE.replace(/sources\.json$/, "briefs.json");

const sources = readJson(SOURCES_FILE, {});
const votes = readJsonl(VOTES_FILE);
const notes = readJsonl(NOTES_FILE);
const ideas = readJsonl(IDEAS_FILE);
const manifests = listManifests();
const seed = readJson(SEED_FILE, { loved: [], hated: [] });
const skill = readText(TASTE_SKILL);
const verdicts = effectiveVerdicts(votes);

const liked = manifests.filter((m) => m.status === "liked" || m.status === "shipped");
const rejected = manifests.filter((m) => m.status === "rejected");
const likedTags = new Map();
const rejectedTags = new Map();
for (const m of liked) for (const t of m.tags || []) likedTags.set(t, (likedTags.get(t) || 0) + 1);
for (const m of rejected) for (const t of m.tags || []) rejectedTags.set(t, (rejectedTags.get(t) || 0) + 1);

const builtTokens = manifests.map((m) => tokens(`${m.title} ${m.description} ${(m.tags || []).join(" ")}`));
const ideaTokens = ideas.map((i) => tokens(`${i.title} ${i.summary}`));
const knownUrls = new Set(ideas.map((i) => i.url).filter(Boolean));

const novelty = (text) => {
  const t = tokens(text);
  let max = 0;
  for (const b of builtTokens) max = Math.max(max, jaccard(t, b));
  return 1 - max;
};

const isDuplicate = (text, url) => {
  if (url && knownUrls.has(url)) return true;
  const t = tokens(text);
  return ideaTokens.some((b) => jaccard(t, b) >= 0.6);
};

const added = [];
function addIdea(idea) {
  const text = `${idea.title} ${idea.summary}`;
  if (isDuplicate(text, idea.url)) return false;
  const record = {
    id: newId(),
    ts: now(),
    kind: "harvest",
    usedAt: null,
    license: null,
    media: null,
    ...idea,
  };
  ideas.push(record);
  added.push(record);
  ideaTokens.push(tokens(text));
  if (record.url) knownUrls.add(record.url);
  return true;
}

async function fetchText(url, { timeout = 12000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "herb-lab-supply", ...headers } });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const strip = (html) =>
  String(html || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

function rssItems(xml) {
  const items = [];
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/g) || [];
  for (const block of blocks) {
    const pick = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return m ? strip(m[1]) : "";
    };
    const linkAttr = block.match(/<link[^>]*href="([^"]+)"/);
    const link = linkAttr ? linkAttr[1] : pick("link");
    const thumb = block.match(/<media:thumbnail[^>]*url="([^"]+)"/);
    items.push({
      title: pick("title"),
      url: link,
      summary: (pick("description") || pick("summary") || pick("media:description")).slice(0, 400),
      media: thumb ? thumb[1] : null,
    });
  }
  return items;
}

async function harvestGithub() {
  const topics = sources.githubTopics || [];
  if (!topics.length) return;
  const day = Math.floor(Date.now() / 86400000);
  const rotate = [...topics.slice(day % topics.length), ...topics.slice(0, day % topics.length)].slice(0, 4);
  const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const headers = { accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  for (const topic of rotate) {
    const q = encodeURIComponent(`topic:${topic} stars:>${sources.githubMinStars || 40} pushed:>${since}`);
    const body = await fetchText(`https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=8`, { headers });
    const data = body ? JSON.parse(body) : null;
    for (const repo of data?.items || []) {
      addIdea({
        source: "github",
        url: repo.html_url,
        title: repo.full_name,
        summary: repo.description || "",
        tags: [topic, ...(repo.topics || []).slice(0, 4)],
        license: repo.license?.spdx_id || null,
        score: repo.stargazers_count,
      });
    }
  }
  const fc = sources.githubFrontendCandidates;
  if (fc?.topics?.length) {
    const topic = fc.topics[day % fc.topics.length];
    const since30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const q = encodeURIComponent(`topic:${topic} stars:>${fc.minStars || 300} pushed:>${since30}`);
    const body = await fetchText(`https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=15`, { headers });
    const data = body ? JSON.parse(body) : null;
    for (const repo of (data?.items || []).filter((r) => !r.homepage)) {
      addIdea({
        kind: "frontend-for-repo",
        source: "github",
        url: repo.html_url,
        title: `A front end for ${repo.name}`,
        summary: `${repo.description || repo.full_name}. It has no homepage or demo; build a playground page that shows what it does.`,
        tags: ["frontend-for-repo", topic, ...(repo.topics || []).slice(0, 3)],
        license: repo.license?.spdx_id || null,
        score: repo.stargazers_count,
      });
    }
  }
}

async function harvestRss() {
  for (const feed of sources.rss || []) {
    const xml = await fetchText(feed.url);
    if (!xml) continue;
    for (const item of rssItems(xml).slice(0, 10)) {
      if (!item.title) continue;
      addIdea({ source: feed.name, url: item.url, title: item.title, summary: item.summary, tags: feed.tags || [], media: item.media });
    }
  }
  for (const channel of sources.youtube || []) {
    const xml = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel.channelId}`);
    if (!xml) continue;
    for (const item of rssItems(xml).slice(0, 5)) {
      addIdea({ source: `youtube:${channel.name}`, url: item.url, title: item.title, summary: item.summary, tags: ["video", ...(channel.tags || [])], media: item.media });
    }
  }
}

async function harvestHn() {
  const since = Math.floor(Date.now() / 1000) - 7 * 86400;
  for (const term of (sources.hnTerms || []).slice(0, 4)) {
    const body = await fetchText(
      `https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&query=${encodeURIComponent(term)}&numericFilters=created_at_i>${since},points>15&hitsPerPage=8`,
    );
    const data = body ? JSON.parse(body) : null;
    for (const hit of data?.hits || []) {
      addIdea({
        source: "show-hn",
        url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
        title: hit.title.replace(/^Show HN:\s*/i, ""),
        summary: (hit.story_text || "").slice(0, 300),
        tags: [term],
        score: hit.points,
      });
    }
  }
}

async function harvestBluesky() {
  for (const term of (sources.blueskyTerms || []).slice(0, 3)) {
    const body = await fetchText(`https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(term)}&sort=top&limit=8`);
    const data = body ? JSON.parse(body) : null;
    for (const post of data?.posts || []) {
      const text = post.record?.text || "";
      if (text.length < 40) continue;
      const rkey = post.uri.split("/").pop();
      const embed = post.embed || {};
      const media = embed.playlist || embed.images?.[0]?.fullsize || embed.thumbnail || null;
      addIdea({
        source: "bluesky",
        url: `https://bsky.app/profile/${post.author.handle}/post/${rkey}`,
        title: text.split("\n")[0].slice(0, 80),
        summary: text.slice(0, 300),
        tags: [term.replace(/\s+/g, "-"), media && embed.playlist ? "video" : null].filter(Boolean),
        media,
        score: post.likeCount || 0,
      });
    }
  }
}

function ideasFromBriefs() {
  const briefs = readJson(BRIEFS_FILE, []);
  const used = new Set(ideas.map((i) => i.briefId).filter(Boolean));
  const fresh = briefs.filter((b) => !used.has(b.id)).sort(() => Math.random() - 0.5).slice(0, 6);
  for (const b of fresh) addIdea({ kind: "brief", source: "briefs", briefId: b.id, url: null, title: b.title, summary: b.summary, tags: b.tags || ["ui"] });
}

function ideasFromNotes() {
  const existing = new Set(ideas.map((i) => i.noteId).filter(Boolean));
  for (const note of notes) {
    if (existing.has(note.id)) continue;
    if (!/^idea:|\b(build|make)\s+(me\s+)?(a|an|the|something|one)\b/i.test(note.text)) continue;
    addIdea({ kind: "note", source: "herb", noteId: note.id, url: null, title: note.text.slice(0, 80), summary: note.text, tags: note.slug ? ["from-note", note.slug] : ["from-note"] });
  }
}

function ideasFromLiked() {
  const hasChild = new Set(manifests.map((m) => m.parentSlug).filter(Boolean));
  const pendingEvolve = new Set(ideas.filter((i) => i.kind === "evolve" && !i.usedAt).map((i) => i.parentSlug));
  let auto = 0;
  for (const m of liked) {
    if (hasChild.has(m.slug) || pendingEvolve.has(m.slug) || auto >= 1) continue;
    const vote = verdicts.get(m.slug);
    addIdea({ kind: "evolve", source: "taste", parentSlug: m.slug, url: null, title: `Evolve ${m.title}`, summary: m.description, tags: m.tags || [], reasons: vote?.reasons || [], auto: true });
    auto += 1;
  }
  const pendingCross = ideas.some((i) => i.kind === "cross" && !i.usedAt);
  if (liked.length >= 2 && !pendingCross) {
    const [a, b] = [...liked].sort(() => Math.random() - 0.5);
    addIdea({
      kind: "cross",
      source: "taste",
      parents: [a.slug, b.slug],
      url: null,
      title: `${a.title} × ${b.title}`,
      summary: `Combine the strongest idea of "${a.title}" (${a.description}) with the strongest idea of "${b.title}" (${b.description}).`,
      tags: [...new Set([...(a.tags || []), ...(b.tags || [])])].slice(0, 6),
    });
  }
}

async function scout() {
  const recentLikes = liked.slice(0, 8).map((m) => `- ${m.title}: ${m.description} [${(m.tags || []).join(", ")}]`).join("\n");
  const recentNotes = notes.slice(-8).map((n) => `- ${n.text}${n.distilled ? ` (rule: ${n.distilled})` : ""}`).join("\n");
  const prompt = [
    focusUi
      ? "Find 5 fresh, specific ideas for real interface components and product UI micro-interactions for herb.art (Next.js, React, motion, Tailwind). Think Mobbin screens, 21st.dev components, Linear, Family, Arc, Vercel, Rauno Freiberg and Emil Kowalski's work: controls, pickers, menus, tables, composers, sheets, HUDs. No abstract visuals, no shaders, no generative art. Each idea must be one component or one flow an agent can build as a single page with realistic content."
      : "Find 5 fresh, specific ideas for small interactive front-end experiments for herb.art (Next.js, React Three Fiber, GSAP, motion, Tailwind, WebGL shaders). Each idea must be something one agent can build as a single page in one session.",
    `Look at these sites and at recent posts on X/Twitter and Bluesky about UI motion, shaders, and product interfaces: ${(sources.scoutSites || []).join(", ")}. If a Mobbin search tool is available, use it to find 2 screens or flows with a striking interaction and describe the mechanic.`,
    "Prefer motion, interaction and rendering ideas over static layouts. Include video-first inspiration (a clip of an interaction) when you find one; put the clip or post URL in url and the image or video URL in media.",
    "Avoid anything already built or already tried:",
    manifests.map((m) => `- ${m.title}`).join("\n") || "- nothing yet",
    "",
    "Herb's inspiration lives in skills named polymarket-skill, grokbot-skill, agentation-showcase-animations, agentation-svg-animation and creative-shader: dense data UI, one-house-curve page motion, self-playing product demos, icon motion. Ideas should sit in that world.",
    "",
    "Herb's taste skill:",
    skill || "(none yet)",
    "",
    recentLikes ? `Recently liked:\n${recentLikes}` : "",
    recentNotes ? `Recent notes from Herb:\n${recentNotes}` : "",
    seed.loved.length ? `Links Herb loves:\n${seed.loved.map((e) => `- ${e.url} ${e.note}`).join("\n")}` : "",
    seed.hated.length ? `Links Herb hates:\n${seed.hated.map((e) => `- ${e.url} ${e.note}`).join("\n")}` : "",
    "",
    "Return only JSON: an array of objects {title, summary, url, source, tags, media, why}. summary is two sentences describing the mechanic precisely. why says which of Herb's preferences it serves.",
  ].join("\n");
  const out = await claude({
    prompt,
    model: MODELS.scout,
    maxTurns: 30,
    budgetUsd: 1.5,
    allowedTools: "WebSearch,WebFetch,mcp__mobbin__search_screens,mcp__mobbin__search_flows,mcp__mobbin__search_sections",
    permissionMode: "dontAsk",
    jsonSchema: {
      type: "object",
      properties: {
        ideas: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              summary: { type: "string" },
              url: { type: "string" },
              source: { type: "string" },
              tags: { type: "array", items: { type: "string" } },
              media: { type: "string" },
              why: { type: "string" },
            },
            required: ["title", "summary", "source", "tags"],
          },
        },
      },
      required: ["ideas"],
    },
    timeoutMs: 12 * 60 * 1000,
  });
  const list = out.structured?.ideas || parseJsonLoose(out.result)?.ideas || parseJsonLoose(out.result);
  if (!Array.isArray(list)) {
    log("scout returned nothing usable", out.stderr.slice(0, 200));
    return;
  }
  for (const idea of list) {
    addIdea({ kind: "scout", source: idea.source || "scout", url: idea.url || null, title: idea.title, summary: idea.summary, tags: idea.tags || [], media: idea.media || null, why: idea.why || "" });
  }
  log(`scout · ${fmtRun(out)}`);
}

const PRIORITY = focusUi
  ? { evolve: 3, note: 2.5, brief: 2.2, scout: 2.1, cross: 2, "frontend-for-repo": 0.1, harvest: 0.1 }
  : { evolve: 3, note: 2.5, brief: 1.5, cross: 2, scout: 1.8, "frontend-for-repo": 1.2, harvest: 1 };

function score(idea) {
  const base = PRIORITY[idea.kind] ?? 1;
  const nov = novelty(`${idea.title} ${idea.summary}`);
  const tags = idea.tags || [];
  const affinity = tags.reduce((acc, t) => acc + (likedTags.get(t) || 0) - (rejectedTags.get(t) || 0), 0) / Math.max(1, tags.length);
  const ageDays = (Date.now() - new Date(idea.ts).getTime()) / 86400000;
  const fresh = ageDays < 3 ? 0.3 : ageDays > 30 ? -0.5 : 0;
  return base + nov + Math.max(-1, Math.min(1, affinity)) * 0.5 + fresh;
}

ideasFromLiked();
ideasFromNotes();
if (focusUi) ideasFromBriefs();
if (doHarvest) {
  log("harvesting…");
  await Promise.all([harvestGithub(), harvestRss(), harvestHn(), harvestBluesky()]);
}
if (doScout) {
  log("scouting with an agent…");
  await scout();
}
log(`${added.length} new idea(s), ${ideas.length} total`);

const pool = ideas.filter((i) => !i.usedAt).map((i) => ({ idea: i, score: score(i) })).sort((a, b) => b.score - a.score);
const picked = [];
const perKind = {};
const perSource = {};
for (const { idea, score: s } of pool) {
  if (picked.length >= count) break;
  const kindCap = idea.kind === "evolve" ? Math.max(1, Math.floor(count / 2)) : idea.kind === "harvest" || idea.kind === "brief" || idea.kind === "scout" ? count : 1;
  if ((perKind[idea.kind] || 0) >= kindCap) continue;
  if (idea.kind === "harvest" && (perSource[idea.source] || 0) >= 1) continue;
  perKind[idea.kind] = (perKind[idea.kind] || 0) + 1;
  perSource[idea.source] = (perSource[idea.source] || 0) + 1;
  picked.push({ ...idea, score: Number(s.toFixed(2)) });
}

const stamp = now();
for (const p of picked) {
  const target = ideas.find((i) => i.id === p.id);
  if (target) target.usedAt = stamp;
}
writeJsonl(IDEAS_FILE, ideas);
writeJson(BATCH_FILE, { createdAt: stamp, tasteVersion: tasteVersion(), ideas: picked });

for (const p of picked) log(`pick ${p.score}  ${p.kind.padEnd(8)} ${p.title}`);
if (!picked.length) log("no ideas to build; add a note in /taste or run with harvest enabled");
