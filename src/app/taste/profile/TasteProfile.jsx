"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import "../taste.css";

async function api(path, init) {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function Stat({ label, value }) {
  return (
    <div className="card flex flex-col gap-1 p-4">
      <span className="text-ink text-title-sm tabular-nums">{value}</span>
      <span className="text-ink-secondary text-ui-lg">{label}</span>
    </div>
  );
}

export default function TasteProfile({ existing }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(() => api("/api/taste/profile").then(setData).catch((err) => setError(err.message)), []);

  useEffect(() => {
    let alive = true;
    api("/api/taste/profile")
      .then((data) => {
        if (alive) setData(data);
      })
      .catch((err) => {
        if (alive) setError(err.message);
      });
    return () => {
      alive = false;
    };
  }, []);

  const seed = useCallback(
    async (bucket, entry) => {
      try {
        await api("/api/taste/seed", { method: "POST", body: JSON.stringify({ bucket, ...entry }) });
        setUrl("");
        setNote("");
        load();
      } catch (err) {
        setError(err.message);
      }
    },
    [load],
  );

  const unseed = useCallback(
    async (target) => {
      await api(`/api/taste/seed?url=${encodeURIComponent(target)}`, { method: "DELETE" });
      load();
    },
    [load],
  );

  if (!data) {
    return (
      <div className="taste bg-surface min-h-dvh">
        <main className="mx-auto max-w-3xl px-4 pt-20 md:px-6">
          <p className="text-ink-secondary text-body">{error || "Loading…"}</p>
        </main>
      </div>
    );
  }

  const { counts, affinity, consistency, seed: seeds } = data;
  const seededUrls = new Map([...seeds.loved.map((e) => [e.url, "loved"]), ...seeds.hated.map((e) => [e.url, "hated"])]);
  const consistencyLabel = consistency.total ? `${Math.round((consistency.agree / consistency.total) * 100)}%` : "—";
  const stage = counts.verdicts < 10 ? "cold start" : counts.verdicts < 50 ? "forming" : counts.verdicts < 200 ? "stable" : "settled";

  return (
    <div className="taste bg-surface min-h-dvh">
      <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 pt-20 pb-16 md:px-6">
        <header className="flex items-baseline justify-between gap-4">
          <h1 className="text-ink text-title-sm">Taste profile</h1>
          <Link href="/taste" className="text-ink text-ui-lg hover:text-accent">
            Back to judging
          </Link>
        </header>

        {error ? <p className="text-negative-ink text-ui-lg">{error}</p> : null}

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label={`verdicts · ${stage}`} value={counts.verdicts} />
          <Stat label="pointed elements" value={counts.points} />
          <Stat label="taste version" value={`v${data.tasteVersion}`} />
          <Stat label={`self-consistency · ${consistency.total} checks`} value={consistencyLabel} />
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-ink text-heading">Reason affinity</h2>
          <p className="text-ink-secondary text-ui-lg">
            Each chip: how often it explained a like or love versus a dislike or hate. Median decision time{" "}
            {data.medianMs ? `${(data.medianMs / 1000).toFixed(1)}s` : "—"}.
          </p>
          <ul className="flex flex-col gap-2">
            {Object.entries(affinity).map(([reason, row]) => {
              const pos = row.like + row.love;
              const neg = row.dislike + row.hate;
              const total = pos + neg;
              return (
                <li key={reason} className="grid grid-cols-[96px_1fr_64px] items-center gap-4">
                  <span className="text-ink text-ui-lg">{reason}</span>
                  <div className="taste-bar">
                    {total ? (
                      <>
                        <span style={{ width: `${(pos / total) * 100}%`, background: "var(--color-positive)" }} />
                        <span style={{ width: `${(neg / total) * 100}%`, background: "var(--color-negative)" }} />
                      </>
                    ) : null}
                  </div>
                  <span className="text-ink-secondary text-ui-lg tabular-nums">
                    {pos} · {neg}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-ink text-heading">Seed</h2>
          <p className="text-ink-secondary text-ui-lg">
            Links you love or hate, plus the existing experiments. The first taste skill is written from these.
          </p>
          <div className="flex flex-col gap-2">
            <input
              className="taste-textarea"
              style={{ minHeight: 36 }}
              placeholder="https://… or /route"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <input
              className="taste-textarea"
              style={{ minHeight: 36 }}
              placeholder="What about it (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex gap-2">
              <button type="button" className="taste-verdict flex-1" data-tone="like" data-armed="true" onClick={() => seed("loved", { url, note })} disabled={!url.trim()}>
                Love
              </button>
              <button type="button" className="taste-verdict flex-1" data-tone="dislike" data-armed="true" onClick={() => seed("hated", { url, note })} disabled={!url.trim()}>
                Hate
              </button>
            </div>
          </div>
          <ul className="flex flex-col gap-2">
            {existing.map((item) => {
              const state = seededUrls.get(item.slug);
              return (
                <li key={item.slug} className="border-line flex items-center justify-between gap-4 border-t pt-2">
                  <span className="text-ink text-ui-lg">
                    {item.title} <span className="text-ink-secondary">{item.slug}</span>
                  </span>
                  <span className="flex gap-1">
                    <button type="button" className="taste-chip" data-on={state === "loved"} onClick={() => seed("loved", { url: item.slug, note: "" })}>
                      love
                    </button>
                    <button type="button" className="taste-chip" data-on={state === "hated"} onClick={() => seed("hated", { url: item.slug, note: "" })}>
                      hate
                    </button>
                  </span>
                </li>
              );
            })}
            {[...seeds.loved.map((e) => ({ ...e, bucket: "loved" })), ...seeds.hated.map((e) => ({ ...e, bucket: "hated" }))]
              .filter((e) => !existing.some((x) => x.slug === e.url))
              .map((e) => (
                <li key={e.url} className="border-line flex items-center justify-between gap-4 border-t pt-2">
                  <span className="text-ink text-ui-lg min-w-0 break-all">
                    {e.bucket === "loved" ? "Love" : "Hate"} · {e.url}
                    {e.note ? <span className="text-ink-secondary"> · {e.note}</span> : null}
                  </span>
                  <button type="button" className="taste-chip" onClick={() => unseed(e.url)}>
                    remove
                  </button>
                </li>
              ))}
          </ul>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-ink text-heading">Taste skill v{data.tasteVersion}</h2>
          <p className="text-ink-secondary text-ui-lg">
            Rewritten every 25 votes by <code>npm run lab:learn</code>. Previous versions: {data.history.length ? data.history.join(", ") : "none yet"}.
          </p>
          <pre className="card taste-pre text-ink p-4">{data.skill || "No taste skill yet. Seed a few links, then run npm run lab:learn -- --force."}</pre>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-ink text-heading">Pointed elements</h2>
          <ul className="flex flex-col gap-2">
            {data.recentPoints.length ? (
              data.recentPoints.map((p) => (
                <li key={p.id} className="border-line flex flex-col gap-1 border-t pt-2">
                  <span className="text-ink text-ui-lg">
                    {p.verdict === "love" ? "Love" : "Hate"} · {p.title} · &lt;{p.point.tag}&gt; {p.point.text ? `“${p.point.text.slice(0, 60)}”` : ""}
                  </span>
                  <span className="text-ink-secondary text-ui">
                    {p.point.computed.fontSize} / {p.point.computed.fontWeight} · {p.point.computed.color} on {p.point.computed.backgroundColor}
                    {p.reasons.length ? ` · ${p.reasons.join(", ")}` : ""}
                    {p.note ? ` · ${p.note}` : ""}
                  </span>
                </li>
              ))
            ) : (
              <li className="text-ink-secondary text-ui-lg">None yet. Press P while judging, then click.</li>
            )}
          </ul>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-ink text-heading">Notes to the agent</h2>
          <ul className="flex flex-col gap-2">
            {data.notes.length ? (
              data.notes.map((n) => (
                <li key={n.id} className="border-line flex flex-col gap-1 border-t pt-2">
                  <span className="text-ink text-ui-lg">
                    {n.slug ? `[${n.slug}] ` : ""}
                    {n.text}
                  </span>
                  {n.reply ? <span className="text-ink-secondary text-ui-lg">{n.reply}</span> : null}
                  {n.distilled ? <span className="text-accent-ink text-ui">Rule: {n.distilled}</span> : null}
                </li>
              ))
            ) : (
              <li className="text-ink-secondary text-ui-lg">None yet.</li>
            )}
          </ul>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-ink text-heading">Recent verdicts</h2>
          <ul className="flex flex-col gap-1">
            {data.recentVerdicts.map((v) => (
              <li key={v.id} className="text-ui-lg flex justify-between gap-4">
                <span className="text-ink">
                  {v.title}
                  {v.recheck ? " · recheck" : ""}
                </span>
                <span className="text-ink-secondary">
                  {v.verdict}
                  {v.reasons.length ? ` · ${v.reasons.join(", ")}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
