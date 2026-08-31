export const INSPECTED_PROPS = [
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "font-stretch",
  "font-optical-sizing",
  "font-variation-settings",
  "font-feature-settings",
  "font-kerning",
  "font-synthesis",
  "font-variant-ligatures",
  "font-variant-numeric",
  "font-variant-caps",
  "font-variant-position",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "text-align",
  "text-indent",
  "text-transform",
  "text-wrap",
  "white-space",
  "hyphens",
  "hanging-punctuation",
  "text-decoration-line",
  "text-decoration-style",
  "text-decoration-color",
  "text-decoration-thickness",
  "text-underline-offset",
  "text-shadow",
  "text-rendering",
  "-webkit-font-smoothing",
  "paint-order",
  "color",
  "opacity",
  "mix-blend-mode",
  "max-width",
  "writing-mode",
  "direction",
  "vertical-align",
  "overflow-wrap",
  "word-break",
];

const NUMERIC_UNITS = new Set(["px", "em", "ratio", "%", "ch"]);

export const parseNumber = (value) => {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
};

export function readControlValue(control, computed, el) {
  const raw = computed.getPropertyValue(control.prop);
  if (!NUMERIC_UNITS.has(control.unit)) return raw.trim();

  const fontSize = parseNumber(computed.fontSize) || 16;
  const px = parseNumber(raw);

  if (control.unit === "px") return px;
  if (control.unit === "ratio") {
    if (raw === "normal") return 1.2;
    return px === null ? null : round(px / fontSize, 3);
  }
  if (control.unit === "em") {
    if (raw === "normal") return 0;
    return px === null ? null : round(px / fontSize, 4);
  }
  if (control.unit === "ch") {
    if (raw === "none") return null;
    const ch = measureCh(el, computed);
    return px === null || !ch ? null : round(px / ch, 1);
  }
  if (control.unit === "%") {
    if (raw === "normal" || raw === "100%") return 100;
    return px === null ? null : round(px, 1);
  }
  return px;
}

export function formatControlValue(control, value) {
  if (value === "" || value === null || value === undefined) return "";
  if (control.unit === "px") return `${value}px`;
  if (control.unit === "em") return `${value}em`;
  if (control.unit === "ch") return `${value}ch`;
  if (control.unit === "%") return `${value}%`;
  if (control.unit === "ratio") return `${value}`;
  return `${value}`;
}

function measureCh(el, computed) {
  const probe = document.createElement("span");
  probe.textContent = "0";
  probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${computed.font || ""};`;
  if (!computed.font) {
    probe.style.fontFamily = computed.fontFamily;
    probe.style.fontSize = computed.fontSize;
    probe.style.fontWeight = computed.fontWeight;
  }
  el.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width;
}

export const round = (n, places = 2) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

const LINE_HEIGHT_ANCHORS = [
  [10, 1.4],
  [12, 1.333],
  [13, 1.231],
  [14, 1.428],
  [16, 1.5],
  [18, 1.5],
  [20, 1.25],
  [24, 1.208],
  [32, 1.156],
  [40, 1.1],
  [64, 1.02],
];

export const TRACKING_PIVOT = 12;
export const TRACKING_K_DEFAULT = 0.043;

export const trackingLawPx = (size, k = TRACKING_K_DEFAULT) =>
  -k * (size - TRACKING_PIVOT);

export const trackingLawEm = (size, k = TRACKING_K_DEFAULT) =>
  size > 0 ? trackingLawPx(size, k) / size : 0;

export const solveTrackingK = (size, trackingPx) =>
  size === TRACKING_PIVOT ? null : -trackingPx / (size - TRACKING_PIVOT);

function interpolate(anchors, x) {
  const last = anchors[anchors.length - 1];
  if (x <= anchors[0][0]) return anchors[0][1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i += 1) {
    const [x1, y1] = anchors[i];
    if (x <= x1) {
      const [x0, y0] = anchors[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return last[1];
}

export const curveLineHeight = (size) => round(interpolate(LINE_HEIGHT_ANCHORS, size), 3);

export const curveTracking = (size, k = TRACKING_K_DEFAULT) =>
  size < 20
    ? { value: round(trackingLawPx(size, k), 2), unit: "px" }
    : { value: round(trackingLawEm(size, k), 4), unit: "em" };

export function linkedCompanions(element, nextSize, mode, k = TRACKING_K_DEFAULT) {
  if (!element || mode === "free") return null;
  const to = Number.parseFloat(nextSize);
  if (!Number.isFinite(to) || to <= 0) return null;

  if (mode === "curve") {
    const tracking = curveTracking(to, k);
    return {
      "line-height": `${curveLineHeight(to)}`,
      "letter-spacing": `${tracking.value}${tracking.unit}`,
    };
  }

  const computed = getComputedStyle(element);
  const from = parseNumber(computed.fontSize) || 16;
  const lineHeight = parseNumber(computed.lineHeight);
  const tracking = parseNumber(computed.letterSpacing) || 0;

  return {
    "line-height": Number.isFinite(lineHeight)
      ? `${round(lineHeight / from, 4)}`
      : undefined,
    "letter-spacing": `${round(tracking / from, 4)}em`,
  };
}

export function composeFeatureSettings(features) {
  const entries = Object.entries(features).filter(([, v]) => v === 1 || v === 0);
  if (!entries.length) return "";
  return entries.map(([tag, v]) => `"${tag}" ${v}`).join(", ");
}

export function parseFeatureSettings(value) {
  const out = {};
  if (!value || value === "normal") return out;
  for (const chunk of value.split(",")) {
    const match = chunk.trim().match(/^["']([a-z0-9]{4})["']\s*(\d+)?$/i);
    if (!match) continue;
    out[match[1]] = match[2] === undefined ? 1 : Number(match[2]) ? 1 : 0;
  }
  return out;
}

export function applyOverrides(el, overrides, memory) {
  if (!el) return;
  for (const prop of Object.keys(memory)) {
    if (prop in overrides) continue;
    const original = memory[prop];
    if (original) el.style.setProperty(prop, original);
    else el.style.removeProperty(prop);
    delete memory[prop];
  }
  for (const [prop, value] of Object.entries(overrides)) {
    if (!(prop in memory)) memory[prop] = el.style.getPropertyValue(prop);
    if (value === "" || value === null || value === undefined) {
      el.style.removeProperty(prop);
    } else {
      el.style.setProperty(prop, value, "important");
    }
  }
}

export function restoreOverrides(el, memory) {
  if (!el) return;
  for (const [prop, original] of Object.entries(memory)) {
    if (original) el.style.setProperty(prop, original);
    else el.style.removeProperty(prop);
  }
}

export function cssPath(el) {
  if (!el || el === document.body) return "body";
  const parts = [];
  let node = el;
  let depth = 0;
  while (node && node.nodeType === 1 && node !== document.body && depth < 8) {
    if (node.id) {
      parts.unshift(`#${node.id}`);
      break;
    }
    let part = node.tagName.toLowerCase();
    const classes = Array.from(node.classList)
      .filter((c) => !c.startsWith("ti-") && !/^\d/.test(c))
      .slice(0, 3);
    if (classes.length) part += `.${classes.join(".")}`;
    const parent = node.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (c) => c.tagName === node.tagName,
      );
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    node = parent;
    depth += 1;
  }
  return parts.join(" > ");
}

export function elementLabel(el) {
  if (!el) return "";
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : "";
  const cls = Array.from(el.classList)
    .filter((c) => !c.startsWith("ti-"))
    .slice(0, 2)
    .map((c) => `.${c}`)
    .join("");
  return `${tag}${id}${cls}`;
}

export function ownText(el) {
  if (!el) return "";
  return (el.textContent || "").replace(/\s+/g, " ").trim();
}

export function resolvedFontFamily(computed) {
  const stack = computed.fontFamily.split(",").map((f) => f.trim().replace(/^["']|["']$/g, ""));
  if (!document.fonts || !document.fonts.check) return stack[0] || "";
  for (const family of stack) {
    try {
      if (document.fonts.check(`${computed.fontSize} "${family}"`)) return family;
    } catch {}
  }
  return stack[0] || "";
}

export function computedSnapshot(el) {
  const computed = getComputedStyle(el);
  const out = {};
  for (const prop of INSPECTED_PROPS) out[prop] = computed.getPropertyValue(prop).trim();
  return out;
}

export function overridesToCss(selector, overrides) {
  const body = Object.entries(overrides)
    .filter(([, v]) => v !== "" && v !== null && v !== undefined)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");
  return `${selector} {\n${body}\n}`;
}
