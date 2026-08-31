"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import "./taste.css";

const REASONS = ["type", "spacing", "colour", "motion", "hierarchy", "too-much", "too-safe", "off-brief"];
const VIEWPORTS = [1280, 768, 390];
const CHIP_WINDOW_MS = 2200;

const VERDICTS = [
  { key: "dislike", label: "Scrap", hotkey: "X", tone: "dislike", past: "Scrapped" },
  { key: "iterate", label: "Iterate", hotkey: "R", tone: "continue", past: "Rebuilding" },
  { key: "like", label: "Keep", hotkey: "L", tone: "like", past: "Kept" },
  { key: "skip", label: "Skip", hotkey: "S", tone: "skip", past: "Skipped" },
];

async function api(path, init) {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

const fmtTokens = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n || 0));
const fmtClock = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function Kbd({ children }) {
  return <span className="taste-kbd">{children}</span>;
}

function summarise(element) {
  if (!element) return "";
  const c = element.computed || {};
  const bits = [];
  if (element.components?.length) bits.push(element.components[0]);
  bits.push(`<${element.tag}${element.classes?.length ? "." + element.classes.slice(0, 2).join(".") : ""}>`);
  if (element.text) bits.push(`“${element.text.slice(0, 40)}${element.text.length > 40 ? "…" : ""}”`);
  if (c.fontSize) bits.push(`${c.fontSize}/${c.fontWeight}`);
  return bits.join(" · ");
}

export default function TasteDeck({ tasteVersion }) {
  const [queue, setQueue] = useState(null);
  const [index, setIndex] = useState(0);
  const [viewport, setViewport] = useState(VIEWPORTS[0]);
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const [pending, setPending] = useState(null);
  const [preReasons, setPreReasons] = useState([]);
  const [history, setHistory] = useState([]);
  const [pointing, setPointing] = useState(false);
  const [picked, setPicked] = useState(null);
  const [notes, setNotes] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [draft, setDraft] = useState("");
  const [asking, setAsking] = useState(false);
  const [lastAction, setLastAction] = useState(null);
  const [error, setError] = useState(null);
  const [build, setBuild] = useState({ running: false, tail: [], live: null, queue: [], recent: [] });
  const [ideaDraft, setIdeaDraft] = useState("");
  const [clock, setClock] = useState(0);

  const stageRef = useRef(null);
  const frameRef = useRef(null);
  const noteRef = useRef(null);
  const pointNoteRef = useRef(null);
  const shownAt = useRef(0);
  const timerRef = useRef(null);
  const pendingRef = useRef(null);
  const sessionRef = useRef("");
  const positionRef = useRef({ slug: null, index: 0 });

  const items = queue?.items || [];
  const current = items[index] || null;
  const next = items[index + 1] || null;

  useEffect(() => {
    positionRef.current = { slug: current?.slug || null, index };
  }, [current, index]);

  const advance = useCallback((to) => {
    window.clearTimeout(timerRef.current);
    pendingRef.current = null;
    shownAt.current = Date.now();
    setIndex(to);
    setPending(null);
    setPreReasons([]);
    setPicked(null);
    setPointing(false);
  }, []);

  const reloadQueue = useCallback(() => {
    api("/api/taste/queue")
      .then((data) => {
        const { slug, index: was } = positionRef.current;
        const found = data.items.findIndex((i) => i.slug === slug);
        setQueue(data);
        setIndex(found >= 0 ? found : Math.max(0, Math.min(was, data.items.length - 1)));
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    sessionRef.current = Math.random().toString(36).slice(2, 10);
    shownAt.current = Date.now();
    let alive = true;
    api("/api/taste/queue")
      .then((data) => {
        if (alive) setQueue(data);
      })
      .catch((err) => {
        if (alive) setError(err.message);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setClock(Date.now()), 1000);
    const first = window.setTimeout(() => setClock(Date.now()), 0);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(first);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let wasRunning = false;
    let lastLabel = null;
    const poll = () =>
      api("/api/taste/run")
        .then((data) => {
          if (!alive) return;
          setBuild(data);
          if (wasRunning && !data.running) {
            setLastAction(`Finished ${lastLabel || "build"} — added to your queue, use → to reach it`);
            reloadQueue();
          }
          wasRunning = data.running;
          if (data.running) lastLabel = data.live?.label;
        })
        .catch(() => {});
    poll();
    const id = window.setInterval(poll, 5000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [reloadQueue]);

  useEffect(() => {
    if (!stageRef.current) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      setStage({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!current) return undefined;
    let alive = true;
    api(`/api/taste/note?slug=${current.slug}`)
      .then((data) => {
        if (!alive) return;
        setNotes(data.notes || []);
        setFeedback(data.feedback || []);
      })
      .catch(() => {
        if (!alive) return;
        setNotes([]);
        setFeedback([]);
      });
    return () => {
      alive = false;
    };
  }, [current]);

  useEffect(() => {
    if (picked && pointNoteRef.current) pointNoteRef.current.focus();
  }, [picked]);

  const scale = stage.width ? Math.min(1, stage.width / viewport) : 1;
  const frameHeight = stage.height ? stage.height / scale : 800;

  const postToFrame = useCallback((message) => {
    const win = frameRef.current?.contentWindow;
    if (win) win.postMessage(message, window.location.origin);
  }, []);

  const startBuild = useCallback(async (body, label) => {
    try {
      const data = await api("/api/taste/run", { method: "POST", body: JSON.stringify(body) });
      setBuild(data);
      setLastAction(data.queued ? `${label} — queued behind ${data.live?.label}` : `${label} — running, about 4 min`);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const commit = useCallback(
    async (verdict, reasons) => {
      window.clearTimeout(timerRef.current);
      pendingRef.current = null;
      setPending(null);
      if (!current) return;
      const item = current;
      const at = index;
      try {
        const data = await api("/api/taste/vote", {
          method: "POST",
          body: JSON.stringify({
            kind: "verdict",
            slug: item.slug,
            verdict,
            reasons,
            msToDecide: Date.now() - shownAt.current,
            viewport,
            recheck: Boolean(item.recheck),
            tasteVersion,
            session: sessionRef.current,
          }),
        });
        setHistory((h) => [...h, { id: data.record.id, index: at, item }]);
        advance(at + 1);
        const past = VERDICTS.find((v) => v.key === verdict)?.past || verdict;
        if (verdict === "iterate") {
          const pins = feedback.filter((f) => f.kind === "point").length;
          await startBuild({ mode: "iterate", slug: item.slug }, `Rebuilding ${item.title} from ${pins} pin${pins === 1 ? "" : "s"} and ${notes.length} note${notes.length === 1 ? "" : "s"}`);
        } else {
          setLastAction(`${past} ${item.title}${reasons.length ? " · " + reasons.join(", ") : ""}`);
        }
      } catch (err) {
        setError(err.message);
      }
    },
    [current, index, viewport, tasteVersion, advance, startBuild, feedback, notes],
  );

  const arm = useCallback(
    (verdict) => {
      if (!current) return;
      if (verdict === "skip" || verdict === "iterate") {
        commit(verdict, pendingRef.current?.reasons || preReasons);
        return;
      }
      const reasons = pendingRef.current?.verdict === verdict ? pendingRef.current.reasons : preReasons;
      const nextPending = { verdict, reasons, since: Date.now() };
      pendingRef.current = nextPending;
      setPending(nextPending);
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => commit(verdict, pendingRef.current?.reasons || []), CHIP_WINDOW_MS);
    },
    [current, preReasons, commit],
  );

  const toggleReason = useCallback(
    (reason) => {
      if (picked) {
        setPicked((p) => ({
          ...p,
          reasons: p.reasons.includes(reason) ? p.reasons.filter((r) => r !== reason) : [...p.reasons, reason],
        }));
        return;
      }
      if (pendingRef.current) {
        const prev = pendingRef.current.reasons;
        const reasons = prev.includes(reason) ? prev.filter((r) => r !== reason) : [...prev, reason];
        const nextPending = { ...pendingRef.current, reasons, since: Date.now() };
        pendingRef.current = nextPending;
        setPending(nextPending);
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => commit(nextPending.verdict, pendingRef.current?.reasons || []), CHIP_WINDOW_MS);
        return;
      }
      setPreReasons((prev) => (prev.includes(reason) ? prev.filter((r) => r !== reason) : [...prev, reason]));
    },
    [picked, commit],
  );

  const undo = useCallback(async () => {
    const last = history[history.length - 1];
    if (!last) return;
    try {
      await api(`/api/taste/vote?id=${last.id}`, { method: "DELETE" });
      setHistory((h) => h.slice(0, -1));
      advance(last.index);
      setLastAction(`Undid the verdict on ${last.item.title}`);
    } catch (err) {
      setError(err.message);
    }
  }, [history, advance]);

  const togglePoint = useCallback(() => {
    setPointing((on) => {
      postToFrame({ type: "taste:point", on: !on });
      return !on;
    });
  }, [postToFrame]);

  const savePoint = useCallback(
    async (verdictOverride) => {
      const verdict = verdictOverride || picked?.verdict;
      if (!picked || !verdict || !current) return;
      try {
        const data = await api("/api/taste/vote", {
          method: "POST",
          body: JSON.stringify({
            kind: "point",
            slug: current.slug,
            verdict,
            reasons: picked.reasons,
            note: picked.note,
            viewport,
            tasteVersion,
            point: picked.element,
          }),
        });
        const n = feedback.filter((f) => f.kind === "point").length + 1;
        setFeedback((f) => [{ ...data.record }, ...f]);
        postToFrame({ type: "taste:mark", n, verdict });
        setLastAction(`Pin #${n} saved · ${verdict} · ${summarise(picked.element)}`);
        setPicked(null);
        setPointing(true);
        postToFrame({ type: "taste:point", on: true });
      } catch (err) {
        setError(err.message);
      }
    },
    [picked, current, viewport, tasteVersion, feedback, postToFrame],
  );

  const submitNote = useCallback(
    async (ask) => {
      const text = draft.trim();
      if (!text) return;
      setDraft("");
      const body = JSON.stringify({ text, slug: current?.slug || null, tasteVersion });
      try {
        if (ask) {
          setAsking(true);
          setLastAction("Asking the agent…");
          const data = await api("/api/taste/chat", { method: "POST", body });
          setNotes((n) => [data.note, ...n]);
          setLastAction(data.note.distilled ? `Agent replied and kept a rule: ${data.note.distilled}` : "Agent replied");
        } else {
          const data = await api("/api/taste/note", { method: "POST", body });
          setNotes((n) => [data.note, ...n]);
          setLastAction("Note saved");
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setAsking(false);
      }
    },
    [draft, current, tasteVersion],
  );

  const handleKey = useCallback(
    (key, { shiftKey = false, preventDefault = () => {} } = {}) => {
      const k = key.toLowerCase();
      if (picked) {
        if (k === "l") setPicked((p) => ({ ...p, verdict: "love" }));
        else if (k === "x") setPicked((p) => ({ ...p, verdict: "hate" }));
        else if (/^[1-8]$/.test(k)) toggleReason(REASONS[Number(k) - 1]);
        else if (k === "enter") savePoint(shiftKey ? "love" : picked.verdict || "hate");
        else if (k === "escape") setPicked(null);
        return;
      }
      if (k === "z") {
        preventDefault();
        undo();
        return;
      }
      if (!current) return;
      if (/^[1-8]$/.test(k)) {
        toggleReason(REASONS[Number(k) - 1]);
        return;
      }
      if (k === "x") arm("dislike");
      else if (k === "r") arm("iterate");
      else if (k === "l") arm("like");
      else if (k === "s") arm("skip");
      else if (k === "enter" && pendingRef.current) commit(pendingRef.current.verdict, pendingRef.current.reasons);
      else if (k === "arrowright" || k === "j") advance(Math.min(items.length - 1, index + 1));
      else if (k === "arrowleft" || k === "k") advance(Math.max(0, index - 1));
      else if (k === "d") setViewport((v) => VIEWPORTS[(VIEWPORTS.indexOf(v) + 1) % VIEWPORTS.length]);
      else if (k === "p") togglePoint();
      else if (k === "n") {
        preventDefault();
        noteRef.current?.focus();
      } else if (k === "escape" && pointing) togglePoint();
    },
    [picked, current, pointing, arm, commit, undo, toggleReason, togglePoint, savePoint, advance, items.length, index],
  );

  useEffect(() => {
    const onKey = (event) => {
      const tag = document.activeElement?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") {
        if (event.key === "Escape") document.activeElement.blur();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      handleKey(event.key, { shiftKey: event.shiftKey, preventDefault: () => event.preventDefault() });
    };
    const onMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "taste:picked") {
        setPicked({ element: data.element, verdict: null, reasons: [], note: "" });
        setPointing(false);
        postToFrame({ type: "taste:point", on: false });
      }
      if (data.type === "taste:point-off") setPointing(false);
      if (data.type === "taste:ready" && pointing) postToFrame({ type: "taste:point", on: true });
      if (data.type === "taste:key" && typeof data.key === "string") handleKey(data.key, { shiftKey: Boolean(data.shiftKey) });
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("message", onMessage);
    };
  }, [handleKey, pointing, postToFrame]);

  const activeReasons = picked ? picked.reasons : pending ? pending.reasons : preReasons;
  const pins = feedback.filter((f) => f.kind === "point");
  const elapsed = build.running && build.live?.startedAt && clock ? fmtClock(Math.max(0, clock - new Date(build.live.startedAt).getTime())) : "0:00";
  const lineage = current?.lineage || [];
  const finished = queue && !current;

  const nowHeading = current
    ? `${index + 1} of ${items.length} · ${current.title}`
    : build.running
      ? `Waiting for ${build.live?.label} · ${elapsed}`
      : queue
        ? "Nothing to judge"
        : "Loading…";

  return (
    <div className="taste bg-surface min-h-dvh">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-4 pt-20 pb-8 md:px-6">
        {error ? (
          <p className="text-negative-ink bg-negative-tint text-ui-lg rounded-md px-3 py-2">
            {error}{" "}
            <button type="button" className="font-strong" onClick={() => setError(null)}>
              dismiss
            </button>
          </p>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_352px]">
          <section className="flex flex-col gap-2">
            <div className="text-ui-lg flex items-center justify-between">
              <div className="flex items-center gap-2">
                {VIEWPORTS.map((width) => (
                  <button key={width} type="button" className="taste-chip" data-on={viewport === width} onClick={() => setViewport(width)}>
                    {width}
                  </button>
                ))}
              </div>
              <button type="button" className="taste-chip" data-on={pointing} onClick={togglePoint}>
                <Kbd>P</Kbd> {pointing ? "click a part · ↑↓ bigger/smaller · Esc" : "pin a part"}
              </button>
            </div>
            <div ref={stageRef} className="taste-stage h-[76vh] min-h-[480px]">
              {current ? (
                <iframe
                  key={`${current.slug}-${current.iteration || 0}`}
                  ref={frameRef}
                  title={current.title}
                  src={`/lab/${current.slug}?taste=1`}
                  className="taste-frame"
                  style={{ width: viewport, height: frameHeight, transform: `scale(${scale})` }}
                  onLoad={() => {
                    shownAt.current = Date.now();
                    if (pointing) postToFrame({ type: "taste:point", on: true });
                  }}
                />
              ) : (
                <div className="text-ink text-title-sm flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                  <span>{nowHeading}</span>
                  <span className="text-ink-secondary text-body">
                    {build.running ? "It lands here when done." : finished ? "Build something below." : ""}
                  </span>
                </div>
              )}
              {next ? (
                <iframe
                  key={`preload-${next.slug}`}
                  title="preload"
                  src={`/lab/${next.slug}?taste=1`}
                  className="taste-frame"
                  style={{ width: 4, height: 4, opacity: 0, pointerEvents: "none" }}
                  tabIndex={-1}
                />
              ) : null}
            </div>
            {pending ? <div className="taste-countdown" style={{ "--taste-window": `${CHIP_WINDOW_MS}ms` }} key={pending.since} /> : <div className="h-[2px]" />}
          </section>

          <aside className="flex flex-col gap-4">
            <div className="card flex flex-col gap-2 p-4">
              <h1 className="text-ink text-heading">{nowHeading}</h1>
              {items.length > 1 ? (
                <div className="flex flex-wrap gap-2">
                  {items.map((item, i) => (
                    <button key={item.slug} type="button" className="taste-chip" data-on={i === index} onClick={() => advance(i)}>
                      {i + 1} {item.title}
                    </button>
                  ))}
                </div>
              ) : null}
              {current ? (
                <p className="text-ink-secondary text-ui-lg">
                  {lineage.length > 1 ? lineage.map((l, i) => (i === lineage.length - 1 ? "this" : l.title)).join(" → ") + " · " : ""}
                  {current.iteration ? `rebuilt ${current.iteration}× · ` : "first version · "}
                  {current.recheck ? "consistency check · " : ""}
                  {current.status}
                </p>
              ) : null}
              {current?.changelog?.length ? (
                <p className="text-ink text-ui-lg">Last rebuild: {current.changelog[current.changelog.length - 1].summary.split("\n").find((l) => /^\s*1\./.test(l)) || current.changelog[current.changelog.length - 1].summary.split("\n")[0]}</p>
              ) : null}
              {build.running ? (
                <p className="text-accent-ink text-ui-lg tabular-nums">
                  Running {build.live?.label} · {elapsed}
                  {build.building?.length ? ` · now on ${build.building.map((b) => b.title).join(", ")}` : ""}
                  {build.queue?.length ? ` · then ${build.queue.join(", ")}` : ""}
                </p>
              ) : null}
              {lastAction ? <p className="text-ink text-ui-lg">Last: {lastAction}</p> : null}
            </div>

            {picked ? (
              <div className="card flex flex-col gap-2 p-4">
                <h3 className="text-ink text-heading-sm">
                  Pin #{pins.length + 1} · {summarise(picked.element)}
                </h3>
                <input
                  ref={pointNoteRef}
                  className="taste-textarea"
                  style={{ minHeight: 36 }}
                  placeholder="What's wrong or right with it"
                  value={picked.note}
                  onChange={(e) => setPicked((p) => ({ ...p, note: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      savePoint(e.shiftKey ? "love" : picked.verdict || "hate");
                    }
                    if (e.key === "Escape") setPicked(null);
                  }}
                />
                <div className="flex gap-2">
                  <button type="button" className="taste-verdict flex-1" data-tone="dislike" data-armed={picked.verdict !== "love"} onClick={() => savePoint("hate")}>
                    <Kbd>↵</Kbd> Hate
                  </button>
                  <button type="button" className="taste-verdict flex-1" data-tone="like" data-armed={picked.verdict === "love"} onClick={() => savePoint("love")}>
                    <Kbd>⇧↵</Kbd> Love
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {VERDICTS.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    className="taste-verdict"
                    data-tone={v.tone}
                    data-armed={pending?.verdict === v.key}
                    disabled={!current}
                    onClick={() => arm(v.key)}
                  >
                    <Kbd>{v.hotkey}</Kbd> {v.label}
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {REASONS.map((reason, i) => (
                <button key={reason} type="button" className="taste-chip" data-on={activeReasons.includes(reason)} onClick={() => toggleReason(reason)}>
                  <Kbd>{i + 1}</Kbd> {reason}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-2">
              <textarea
                ref={noteRef}
                className="taste-textarea"
                placeholder="Note · Enter saves · ⌘Enter asks the agent"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitNote(e.metaKey || e.ctrlKey);
                  }
                }}
              />
              {pins.length || notes.length ? (
                <ul className="flex flex-col gap-2">
                  {pins.map((f, i, all) => (
                    <li key={f.id} className="border-line flex flex-col border-t pt-2">
                      <span className="text-ink text-ui-lg">
                        #{all.length - i} {f.verdict === "love" ? "Love" : "Hate"} · {summarise(f.point)}
                      </span>
                      {f.note ? <span className="text-ink-secondary text-ui-lg">{f.note}</span> : null}
                    </li>
                  ))}
                  {notes.slice(0, 4).map((note) => (
                    <li key={note.id} className="border-line flex flex-col border-t pt-2">
                      <span className="text-ink text-ui-lg">Note · {note.text}</span>
                      {note.reply ? <span className="text-ink-secondary text-ui-lg">{note.reply}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <button type="button" className="taste-verdict" disabled={build.running} onClick={() => startBuild({ mode: "batch", count: 3 }, "Building 3 new candidates")}>
                  Build 3 new
                </button>
                <input
                  className="taste-textarea flex-1"
                  style={{ minHeight: 36 }}
                  placeholder="One idea · Enter builds it"
                  value={ideaDraft}
                  onChange={(e) => setIdeaDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && ideaDraft.trim().length >= 8) {
                      e.preventDefault();
                      startBuild({ mode: "idea", idea: ideaDraft.trim() }, `Building “${ideaDraft.trim().slice(0, 40)}”`);
                      setIdeaDraft("");
                      e.target.blur();
                    }
                  }}
                />
              </div>
              {build.running && !current ? <pre className="taste-pre text-ink-secondary max-h-32 overflow-auto">{build.tail.slice(-6).join("\n")}</pre> : null}
              <ul className="flex flex-col">
                {(build.recent || []).map((e) => (
                  <li key={`${e.at}-${e.text}`} className="text-ink-secondary text-ui-lg flex gap-2 tabular-nums">
                    <span>{fmtTime(e.at)}</span>
                    <span className="text-ink">{e.text}</span>
                  </li>
                ))}
              </ul>
              <p className="text-ink-secondary text-ui tabular-nums">
                Today {build.usage?.runs || 0} runs · {build.usage?.minutes || 0} min · {fmtTokens((build.usage?.input || 0) + (build.usage?.output || 0))} tokens · Max plan · taste v{tasteVersion} ·{" "}
                <Link href="/taste/profile" className="text-ink hover:text-accent">
                  profile
                </Link>
              </p>
            </div>

            <p className="text-ink-secondary text-ui">
              <Kbd>←</Kbd><Kbd>→</Kbd> switch · <Kbd>Z</Kbd> undo · <Kbd>D</Kbd> width · <Kbd>N</Kbd> note · <Kbd>Esc</Kbd> cancel
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
