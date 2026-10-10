"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import "./taste.css";

const REASONS = ["type", "spacing", "colour", "motion", "hierarchy", "too-much", "too-safe", "off-brief"];
const VIEWPORTS = [1280, 768, 390];
const CHIP_WINDOW_MS = 2200;

const VERDICTS = [
  { key: "dislike", label: "Remove", hotkey: "X", tone: "dislike", past: "Removed" },
  { key: "like", label: "Keep", hotkey: "L", tone: "like", past: "Kept" },
];

async function api(path, init) {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

const BATCH_KEY = "herb:taste:review";
const DRAFTS_KEY = "herb:taste:drafts";
const GENERAL = { slug: "", title: "General" };

const ITERATE_RULES = [
  "For every piece under Iterate: edit only inside its own src/app/lab/<slug>/ folder, follow .claude/skills/lab-build/SKILL.md and .claude/skills/taste/SKILL.md, keep its experiment.json status as is, and run node scripts/lab-gate.mjs <slug> until it prints PASS.",
  'When a piece is done, add 1 to "iteration" in its experiment.json, set "iteratedAt" to the current ISO time, and append { "iteration", "at", "summary" } to "changelog" so it comes back to /taste for a fresh verdict.',
  "The pieces are independent, so work on them in parallel if you can.",
];

function mergeEntry(batch, item, change, at) {
  const index = batch.findIndex((e) => e.slug === item.slug);
  const base =
    index >= 0
      ? batch[index]
      : { slug: item.slug, title: item.title, iteratedAt: item.iteratedAt || null, since: at, verdict: null, reasons: [], hates: 0, loves: 0, notes: 0, texts: [] };
  const patch = typeof change === "function" ? change(base) : change;
  const entry = { ...base, ...patch };
  return index >= 0 ? batch.map((e, i) => (i === index ? entry : e)) : [...batch, entry];
}

const isEmpty = (e) => !e.verdict && !e.reasons?.length && !e.hates && !e.loves && !e.notes && !e.texts?.length;
const signature = (e) => JSON.stringify({ ...e, since: null });

function pinLine(f, i, tag) {
  const where = f.point?.selector ? ` (selector: ${f.point.selector})` : "";
  const why = f.reasons?.length ? ` · ${f.reasons.join(", ")}` : "";
  return `${i + 1}. ${f.verdict === "love" ? "Love" : "Hate"} · ${summarise(f.point)}${where}${why}${f.note ? ` — "${f.note}"` : ""}${tag(f.ts)}`;
}

function feedbackLines(entry, feedback, notes) {
  const tag = (ts) => (entry.iteratedAt && ts && ts < entry.iteratedAt ? " (from an earlier review: confirm it is really fixed)" : "");
  const lines = [];
  const pins = feedback.filter((f) => f.kind === "point");
  if (pins.length) {
    lines.push("Pinned elements:");
    pins
      .slice()
      .reverse()
      .forEach((f, i) => lines.push(pinLine(f, i, tag)));
  }
  if (notes.length) {
    lines.push("Notes:");
    notes
      .slice()
      .reverse()
      .forEach((note) => lines.push(`- ${note.text}${tag(note.ts)}`));
  }
  return lines;
}

function sessionFeedback(section) {
  const since = section.entry.since || "";
  return {
    pins: section.feedback.filter((f) => f.kind === "point" && f.ts >= since),
    notes: section.notes.filter((n) => n.ts >= since),
  };
}

function reviewPrompt(sections) {
  const general = sections.filter((s) => !s.entry.slug && s.entry.texts?.length);
  const pieces = sections.filter((s) => s.entry.slug);
  const needsWork = (s) =>
    s.entry.verdict === "like" ? s.entry.hates > 0 || s.entry.notes > 0 : s.entry.reasons.length > 0 || s.entry.hates > 0 || s.entry.loves > 0 || s.entry.notes > 0;
  const removed = pieces.filter((s) => s.entry.verdict === "dislike");
  const iterate = pieces.filter((s) => s.entry.verdict !== "dislike" && needsWork(s));
  const keptAsIs = pieces.filter((s) => s.entry.verdict === "like" && !needsWork(s));
  const count = removed.length + iterate.length + keptAsIs.length;
  const lines = [`My review of ${count} lab piece${count === 1 ? "" : "s"} from /taste. Work through every section.`, ""];
  if (general.length) {
    lines.push("# General notes");
    general.forEach((s) => s.entry.texts.forEach((text) => lines.push(`- ${text}`)));
    lines.push("");
  }
  if (removed.length) {
    lines.push("# Remove");
    removed.forEach((s) => {
      lines.push(`- ${s.entry.title} · src/app/lab/${s.entry.slug}/${s.entry.reasons.length ? ` · ${s.entry.reasons.join(", ")}` : ""}`);
      const now = sessionFeedback(s);
      now.pins.forEach((f, i) => lines.push(`  ${pinLine(f, i, () => "")}`));
      now.notes.forEach((n) => lines.push(`  - ${n.text}`));
    });
    lines.push(
      "Copy each folder into taste/archive/<slug>/, delete it from src/app/lab, then run node scripts/lab-registry.mjs once.",
      "Read the reasons, pins and notes on the removed pieces and fold any lasting lesson into the Hates in .claude/skills/taste/SKILL.md.",
      "",
    );
  }
  if (iterate.length) {
    lines.push("# Iterate");
    iterate.forEach((s) => {
      const kept = s.entry.verdict === "like";
      lines.push("", `## ${s.entry.title} · src/app/lab/${s.entry.slug}/ (route /lab/${s.entry.slug}) · ${kept ? "kept, improve it" : "no verdict yet, improve it"}`);
      lines.push("Address every item; keep everything I did not mention, and keep every Love exactly as it is.");
      if (s.entry.reasons.length) lines.push(`${kept ? "Tagged" : "What's off"}: ${s.entry.reasons.join(", ")}.`);
      lines.push(...feedbackLines(s.entry, s.feedback, s.notes));
    });
    lines.push("", ...ITERATE_RULES, "");
  }
  if (keptAsIs.length) {
    lines.push("# Kept as is", "No changes needed:");
    keptAsIs.forEach((s) => {
      lines.push(`- ${s.entry.title}${s.entry.reasons.length ? ` · tagged ${s.entry.reasons.join(", ")}` : ""}`);
      sessionFeedback(s).pins.forEach((f, i) => lines.push(`  ${pinLine(f, i, () => "")}`));
    });
  }
  return { text: lines.join("\n").trim(), count: count + general.length };
}

function describeEntry(entry) {
  const pins = (entry.hates || 0) + (entry.loves || 0);
  const notes = (entry.notes || 0) + (entry.texts?.length || 0);
  const bits = [entry.verdict === "like" ? "kept" : entry.verdict === "dislike" ? "removed" : null];
  if (pins) bits.push(`${pins} pin${pins === 1 ? "" : "s"}`);
  if (notes) bits.push(`${notes} note${notes === 1 ? "" : "s"}`);
  if (!pins && !notes && entry.reasons?.length) bits.push(entry.reasons.join(", "));
  return `${entry.title} ${bits.filter(Boolean).join(", ")}`.trim();
}

const ideaPrompt = (idea) =>
  `Build a new lab experiment for herb.art: ${idea}\n\nUse the lab-build contract (.claude/skills/lab-build/SKILL.md) and the taste skill (.claude/skills/taste/SKILL.md). Create it under src/app/lab/<slug>/ with an experiment.json of status "candidate", and run node scripts/lab-gate.mjs <slug> until it prints PASS.`;

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
    document.body.append(field);
    field.focus();
    field.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    field.remove();
    return copied;
  }
}

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
  const [drafts, setDrafts] = useState({});
  const [lastAction, setLastAction] = useState(null);
  const [error, setError] = useState(null);
  const [handoff, setHandoff] = useState(null);
  const [ideaDraft, setIdeaDraft] = useState("");
  const [batch, setBatch] = useState([]);
  const [copyState, setCopyState] = useState(null);
  const copyTimer = useRef(null);
  const batchRestored = useRef(false);

  const stageRef = useRef(null);
  const frameRef = useRef(null);
  const noteRef = useRef(null);
  const pointNoteRef = useRef(null);
  const shownAt = useRef(0);
  const timerRef = useRef(null);
  const pendingRef = useRef(null);
  const sessionRef = useRef("");
  const positionRef = useRef({ slug: null, index: 0 });

  const items = useMemo(() => queue?.items || [], [queue]);
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
    let alive = true;
    Promise.resolve().then(() => {
      if (!alive) return;
      try {
        const saved = JSON.parse(window.localStorage.getItem(BATCH_KEY) || "[]");
        if (Array.isArray(saved)) setBatch(saved.filter((e) => e && typeof e.slug === "string" && !isEmpty(e)));
        const savedDrafts = JSON.parse(window.localStorage.getItem(DRAFTS_KEY) || "{}");
        if (savedDrafts && typeof savedDrafts === "object") setDrafts(savedDrafts);
      } catch {}
      batchRestored.current = true;
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!batchRestored.current) return;
    try {
      window.localStorage.setItem(BATCH_KEY, JSON.stringify(batch));
    } catch {}
  }, [batch]);

  useEffect(() => {
    if (!batchRestored.current) return;
    try {
      window.localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
    } catch {}
  }, [drafts]);

  const touch = useCallback((item, change, at = new Date().toISOString()) => {
    setBatch((b) => mergeEntry(b, item, change, at).filter((e) => !isEmpty(e)));
  }, []);

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

  const handOff = useCallback(async (label, text) => {
    setHandoff({ label, text });
    const copied = await copyText(text);
    setLastAction(copied ? `Copied ${label} — paste it to Claude` : `Couldn't reach the clipboard — use Copy on ${label}`);
    setCopyState(copied ? "copied" : "failed");
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopyState(null), 2600);
    return copied;
  }, []);

  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  const commit = useCallback(
    async (verdict, reasons, { stay = false } = {}) => {
      window.clearTimeout(timerRef.current);
      pendingRef.current = null;
      setPending(null);
      if (!current) return false;
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
        touch(item, { verdict, reasons });
        if (!stay) advance(at + 1);
        const past = VERDICTS.find((v) => v.key === verdict)?.past || verdict;
        setLastAction(`${past} ${item.title}${reasons.length ? " · " + reasons.join(", ") : ""}`);
        return true;
      } catch (err) {
        setError(err.message);
        return false;
      }
    },
    [current, index, viewport, tasteVersion, advance, touch],
  );

  const settleArmed = useCallback(() => {
    const armed = pendingRef.current;
    if (armed) return commit(armed.verdict, armed.reasons, { stay: true });
    return Promise.resolve(true);
  }, [commit]);

  const saveNote = useCallback(
    async (slug, raw) => {
      const text = raw.trim();
      if (!text) return null;
      const startedAt = new Date().toISOString();
      const data = await api("/api/taste/note", { method: "POST", body: JSON.stringify({ text, slug: slug || null, tasteVersion }) });
      setDrafts((d) => {
        const rest = { ...d };
        delete rest[slug];
        return rest;
      });
      if (slug && slug === current?.slug) setNotes((n) => [data.note, ...n]);
      const item = slug ? items.find((i) => i.slug === slug) || { slug, title: slug } : GENERAL;
      const change = slug ? (entry) => ({ notes: (entry.notes || 0) + 1 }) : (entry) => ({ texts: [...(entry.texts || []), text] });
      touch(item, change, startedAt);
      return { item, change };
    },
    [current, items, tasteVersion, touch],
  );

  const copyReview = useCallback(async () => {
    const armed = pendingRef.current;
    const stamp = new Date().toISOString();
    let entries = batch;
    if (armed && current) {
      const saved = await commit(armed.verdict, armed.reasons, { stay: true });
      if (!saved) return;
      entries = mergeEntry(entries, current, { verdict: armed.verdict, reasons: armed.reasons }, stamp);
    }
    try {
      for (const [slug, text] of Object.entries(drafts)) {
        const saved = await saveNote(slug, text);
        if (saved) entries = mergeEntry(entries, saved.item, saved.change, stamp);
      }
    } catch (err) {
      setError(err.message);
      return;
    }
    entries = entries.filter((e) => !isEmpty(e));
    if (!entries.length) {
      setLastAction("Nothing to copy yet: keep, remove, pin or note a piece first");
      return;
    }
    try {
      const sections = await Promise.all(
        entries.map(async (entry) => {
          if (!entry.slug) return { entry, feedback: [], notes: [] };
          const data = await api(`/api/taste/note?slug=${entry.slug}`);
          return { entry, feedback: data.feedback || [], notes: data.notes || [] };
        }),
      );
      const { text, count } = reviewPrompt(sections);
      if (!count) {
        setLastAction("Nothing to copy yet: keep, remove, pin or note a piece first");
        return;
      }
      const copied = await handOff(`the review of ${count} item${count === 1 ? "" : "s"}`, text);
      if (!copied) return;
      const sent = new Set(entries.map(signature));
      setBatch((b) => b.filter((e) => !sent.has(signature(e))));
      setHistory([]);
    } catch (err) {
      setError(err.message);
    }
  }, [batch, current, commit, handOff, drafts, saveNote]);

  const arm = useCallback(
    (verdict) => {
      if (!current) return;
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
      const reasons = preReasons.includes(reason) ? preReasons.filter((r) => r !== reason) : [...preReasons, reason];
      setPreReasons(reasons);
      if (current) touch(current, { reasons });
    },
    [picked, commit, preReasons, current, touch],
  );

  const undo = useCallback(async () => {
    const last = history[history.length - 1];
    if (!last) return;
    try {
      await api(`/api/taste/vote?id=${last.id}`, { method: "DELETE" });
      setHistory((h) => h.slice(0, -1));
      touch(last.item, { verdict: null });
      advance(last.index);
      setLastAction(`Undid the verdict on ${last.item.title}`);
    } catch (err) {
      setError(err.message);
    }
  }, [history, advance, touch]);

  const togglePoint = useCallback(() => {
    if (!pointing) settleArmed();
    postToFrame({ type: "taste:point", on: !pointing });
    setPointing(!pointing);
  }, [pointing, postToFrame, settleArmed]);

  const savePoint = useCallback(
    async (verdictOverride) => {
      const verdict = verdictOverride || picked?.verdict;
      if (!picked || !verdict || !current) return;
      try {
        const startedAt = new Date().toISOString();
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
        const counter = verdict === "love" ? "loves" : "hates";
        touch(current, (entry) => ({ [counter]: (entry[counter] || 0) + 1 }), startedAt);
        postToFrame({ type: "taste:mark", n, verdict });
        setLastAction(`Pin #${n} saved · ${verdict} · ${summarise(picked.element)}`);
        setPicked(null);
        setPointing(true);
        postToFrame({ type: "taste:point", on: true });
      } catch (err) {
        setError(err.message);
      }
    },
    [picked, current, viewport, tasteVersion, feedback, postToFrame, touch],
  );

  const draftKey = current?.slug || "";
  const draft = drafts[draftKey] || "";

  const submitNote = useCallback(async () => {
    try {
      const saved = await saveNote(draftKey, drafts[draftKey] || "");
      if (saved) setLastAction(`Comment saved on ${saved.item.title} — it goes into the review copy`);
    } catch (err) {
      setError(err.message);
    }
  }, [draftKey, drafts, saveNote]);

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
      if (k === "c") {
        copyReview();
        return;
      }
      if (!current) return;
      if (/^[1-8]$/.test(k)) {
        toggleReason(REASONS[Number(k) - 1]);
        return;
      }
      if (k === "x") arm("dislike");
      else if (k === "l") arm("like");
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
    [picked, current, pointing, arm, commit, copyReview, undo, toggleReason, togglePoint, savePoint, advance, items.length, index],
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
        settleArmed();
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
  }, [handleKey, pointing, postToFrame, settleArmed]);

  const activeReasons = picked ? picked.reasons : pending ? pending.reasons : preReasons;
  const pins = feedback.filter((f) => f.kind === "point");
  const finished = queue && !current;

  const nowHeading = current ? `${index + 1} of ${items.length} · ${current.title}` : queue ? "Nothing to judge" : "Loading…";

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
            <div className="text-ui-lg flex items-center gap-2">
              {VIEWPORTS.map((width) => (
                <button key={width} type="button" className="taste-chip" data-on={viewport === width} onClick={() => setViewport(width)}>
                  {width}
                </button>
              ))}
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
                    {finished ? (batch.length ? "Press C to copy your review and paste it to Claude." : "Copy an idea prompt below and paste it to Claude.") : ""}
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
              {current?.changelog?.length ? (
                <p className="text-ink text-ui-lg">Last rebuild: {current.changelog[current.changelog.length - 1].summary.split("\n").find((l) => /^\s*1\./.test(l)) || current.changelog[current.changelog.length - 1].summary.split("\n")[0]}</p>
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
                <button type="button" className="taste-verdict col-span-2" data-tone="continue" data-armed={pointing} disabled={!current} onClick={togglePoint}>
                  <Kbd>P</Kbd> {pointing ? "Click a part · ↑↓ bigger/smaller · Esc" : "Point at a part"}
                </button>
                <button type="button" className="taste-verdict col-span-2" data-tone="continue" data-armed={batch.length > 0} onClick={copyReview}>
                  <Kbd>C</Kbd>{" "}
                  {copyState === "copied"
                    ? "Copied · paste it to Claude"
                    : copyState === "failed"
                      ? "Copy failed · use Copy below"
                      : `Copy review${batch.length ? ` · ${batch.length} piece${batch.length === 1 ? "" : "s"}` : ""}`}
                </button>
                {batch.length ? (
                  <p className="text-ink-secondary text-ui col-span-2">
                    {batch.map(describeEntry).join(" · ")} ·{" "}
                    <button type="button" className="text-ink hover:text-accent" onClick={() => {
                        if (window.confirm("Clear everything in this review without copying it?")) setBatch([]);
                      }}>
                      clear
                    </button>
                  </p>
                ) : null}
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
                onFocus={settleArmed}
                className="taste-textarea"
                placeholder={current ? `Comment on ${current.title} · it stays with this piece` : "General comment · it goes into the review copy"}
                value={draft}
                onChange={(e) => {
                  const value = e.target.value;
                  setDrafts((d) => ({ ...d, [draftKey]: value }));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitNote();
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

            {handoff ? (
              <div className="card flex flex-col gap-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-ink text-heading-sm">Paste to Claude</h3>
                  <button type="button" className="taste-chip" onClick={() => handOff(handoff.label, handoff.text)}>
                    Copy
                  </button>
                </div>
                <pre className="taste-pre text-ink-secondary max-h-48 overflow-auto whitespace-pre-wrap">{handoff.text}</pre>
              </div>
            ) : null}

            <div className="flex flex-col gap-2">
              <input
                className="taste-textarea"
                style={{ minHeight: 36 }}
                placeholder="One idea · Enter copies a build prompt"
                value={ideaDraft}
                onChange={(e) => setIdeaDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && ideaDraft.trim().length >= 8) {
                    e.preventDefault();
                    handOff(`the “${ideaDraft.trim().slice(0, 40)}” build prompt`, ideaPrompt(ideaDraft.trim()));
                    setIdeaDraft("");
                    e.target.blur();
                  }
                }}
              />
              <p className="text-ink-secondary text-ui">
                taste v{tasteVersion} ·{" "}
                <button type="button" className="text-ink hover:text-accent" onClick={reloadQueue}>
                  reload
                </button>{" "}
                ·{" "}
                <Link href="/taste/profile" className="text-ink hover:text-accent">
                  profile
                </Link>
              </p>
            </div>

            <p className="text-ink-secondary text-ui">
              <Kbd>←</Kbd><Kbd>→</Kbd> switch · <Kbd>C</Kbd> copy prompt · <Kbd>Z</Kbd> undo · <Kbd>D</Kbd> width · <Kbd>N</Kbd> note · <Kbd>Esc</Kbd> cancel
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
