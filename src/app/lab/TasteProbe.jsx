"use client";

import { useEffect } from "react";

const COMPUTED_KEYS = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "color",
  "backgroundColor",
  "backgroundImage",
  "borderRadius",
  "border",
  "boxShadow",
  "opacity",
  "transform",
  "transition",
  "animation",
  "padding",
  "margin",
  "gap",
  "display",
  "filter",
  "mixBlendMode",
  "cursor",
];

const IGNORED_COMPONENTS = /^(ClientOnly|Fragment|Suspense|Canvas|Provider|Context|Consumer|TasteProbe)$/;

function componentChain(element) {
  let node = element;
  while (node) {
    const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
    if (key) {
      const names = [];
      let fiber = node[key];
      while (fiber && names.length < 4) {
        const type = fiber.type;
        const name = typeof type === "function" ? type.displayName || type.name : typeof type === "object" && type?.render ? type.render.name : null;
        if (name && !IGNORED_COMPONENTS.test(name) && !names.includes(name)) names.push(name);
        fiber = fiber.return;
      }
      return names;
    }
    node = node.parentElement;
  }
  return [];
}

function describe(element) {
  const parts = [];
  let node = element;
  let depth = 0;
  while (node && node.nodeType === 1 && depth < 6 && node !== document.body) {
    let part = node.tagName.toLowerCase();
    if (node.id) {
      parts.unshift(`${part}#${node.id}`);
      break;
    }
    const classes = Array.from(node.classList).slice(0, 2);
    if (classes.length) part += "." + classes.join(".");
    const parent = node.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    node = parent;
    depth += 1;
  }
  return parts.join(" > ");
}

function shortLabel(element) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  const classes = Array.from(element.classList).slice(0, 2).join(".");
  const component = componentChain(element)[0];
  return `${component ? component + " · " : ""}${element.tagName.toLowerCase()}${classes ? "." + classes : ""} · ${Math.round(rect.width)}×${Math.round(rect.height)} · ${style.fontSize}/${style.fontWeight}`;
}

function snapshot(element) {
  const style = window.getComputedStyle(element);
  const computed = {};
  for (const key of COMPUTED_KEYS) computed[key] = style[key];
  const rect = element.getBoundingClientRect();
  const animations = typeof element.getAnimations === "function" ? element.getAnimations().map((a) => a.animationName || a.id || "transition").slice(0, 6) : [];
  const ancestors = [];
  let node = element.parentElement;
  while (node && node !== document.body && ancestors.length < 4) {
    ancestors.push(`${node.tagName.toLowerCase()}${node.classList.length ? "." + Array.from(node.classList).slice(0, 2).join(".") : ""}`);
    node = node.parentElement;
  }
  return {
    selector: describe(element),
    tag: element.tagName.toLowerCase(),
    classes: Array.from(element.classList).slice(0, 10),
    components: componentChain(element),
    text: (element.innerText || element.textContent || "").trim().slice(0, 160),
    html: element.outerHTML.slice(0, 1200),
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
    computed,
    animations,
    ancestors,
    childCount: element.childElementCount,
  };
}

export default function TasteProbe() {
  useEffect(() => {
    const embedded = window.parent !== window;
    const flagged = new URLSearchParams(window.location.search).get("taste") === "1";
    if (!embedded && !flagged) return undefined;

    const previousChrome = document.documentElement.dataset.chrome;
    document.documentElement.dataset.tastePreview = "1";
    document.documentElement.dataset.chrome = "off";

    let active = false;
    let base = null;
    let depth = 0;
    let target = null;
    const marks = [];

    const layer = document.createElement("div");
    layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483646";
    const outline = document.createElement("div");
    outline.style.cssText = "position:fixed;pointer-events:none;border:2px solid #1f4fd8;border-radius:2px;box-shadow:0 0 0 2px rgba(255,255,255,.85);display:none";
    const tip = document.createElement("div");
    tip.style.cssText =
      "position:fixed;pointer-events:none;display:none;max-width:60vw;padding:4px 8px;border-radius:4px;background:#171717;color:#fff;font:500 11px/16px ui-monospace,Menlo,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
    layer.append(outline, tip);
    document.body.appendChild(layer);

    const post = (message) => {
      if (embedded) window.parent.postMessage(message, window.location.origin);
    };

    const resolveTarget = () => {
      let node = base;
      for (let i = 0; i < depth && node && node.parentElement && node.parentElement !== document.body; i += 1) node = node.parentElement;
      return node;
    };

    const paint = () => {
      target = active ? resolveTarget() : null;
      if (!target || target === document.body || target === document.documentElement) {
        outline.style.display = "none";
        tip.style.display = "none";
        return;
      }
      const rect = target.getBoundingClientRect();
      outline.style.display = "block";
      outline.style.left = `${rect.left}px`;
      outline.style.top = `${rect.top}px`;
      outline.style.width = `${rect.width}px`;
      outline.style.height = `${rect.height}px`;
      tip.textContent = `${shortLabel(target)}${depth ? ` · ↑${depth}` : ""}`;
      tip.style.display = "block";
      const above = rect.top > 28;
      tip.style.left = `${Math.max(4, Math.min(rect.left, window.innerWidth - 320))}px`;
      tip.style.top = `${above ? rect.top - 24 : rect.bottom + 4}px`;
    };

    const placeMarks = () => {
      for (const mark of marks) {
        if (!mark.element.isConnected) {
          mark.pin.style.display = "none";
          continue;
        }
        const rect = mark.element.getBoundingClientRect();
        mark.pin.style.display = "flex";
        mark.pin.style.left = `${rect.left - 8}px`;
        mark.pin.style.top = `${rect.top - 8}px`;
      }
    };

    const addMark = (element, n, verdict) => {
      const pin = document.createElement("div");
      pin.textContent = String(n);
      pin.style.cssText = `position:fixed;display:flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:999px;background:${verdict === "love" ? "#1e7a4a" : "#b42318"};color:#fff;font:600 11px/1 ui-sans-serif,system-ui;box-shadow:0 0 0 2px #fff;pointer-events:none`;
      layer.appendChild(pin);
      marks.push({ element, pin, n });
      placeMarks();
    };

    const onMove = (event) => {
      if (!active) return;
      if (event.target !== base) {
        base = event.target;
        depth = 0;
      }
      paint();
    };

    const onClick = (event) => {
      if (!active) return;
      event.preventDefault();
      event.stopPropagation();
      const picked = target || event.target;
      if (!picked || picked === layer) return;
      post({ type: "taste:picked", element: snapshot(picked) });
      marks.pendingElement = picked;
    };

    const onKey = (event) => {
      const tag = event.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (active && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        depth = Math.max(0, Math.min(8, depth + (event.key === "ArrowUp" ? 1 : -1)));
        paint();
        return;
      }
      if (event.key === "Escape" && active) {
        active = false;
        paint();
        post({ type: "taste:point-off" });
        return;
      }
      if (event.metaKey || event.ctrlKey) return;
      post({ type: "taste:key", key: event.key, shiftKey: event.shiftKey });
    };

    const onMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "taste:point") {
        active = Boolean(data.on);
        document.documentElement.style.cursor = active ? "crosshair" : "";
        paint();
      }
      if (data.type === "taste:mark" && marks.pendingElement) {
        addMark(marks.pendingElement, data.n, data.verdict);
        marks.pendingElement = null;
      }
      if (data.type === "taste:unmark") {
        const last = marks.pop();
        if (last) last.pin.remove();
      }
      if (data.type === "taste:ping") post({ type: "taste:ready" });
    };

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", placeMarks, true);
    window.addEventListener("resize", placeMarks);
    window.addEventListener("message", onMessage);
    post({ type: "taste:ready" });

    return () => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", placeMarks, true);
      window.removeEventListener("resize", placeMarks);
      window.removeEventListener("message", onMessage);
      layer.remove();
      document.documentElement.style.cursor = "";
      delete document.documentElement.dataset.tastePreview;
      if (previousChrome === undefined) delete document.documentElement.dataset.chrome;
      else document.documentElement.dataset.chrome = previousChrome;
    };
  }, []);

  return null;
}
