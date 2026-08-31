const PROBE_STRINGS = [
  "AVAWTaToWaYo fi ffl fj",
  "0123456789 1/2 0O",
  "Hamburgefonstiv & Quartz",
];

export function probeFeatureEffects(element, tags) {
  if (!element || typeof document === "undefined") return new Set();

  const computed = getComputedStyle(element);
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "position:fixed;left:-99999px;top:0;white-space:pre;pointer-events:none;contain:strict;";
  host.style.fontFamily = computed.fontFamily;
  host.style.fontWeight = computed.fontWeight;
  host.style.fontStyle = computed.fontStyle;
  host.style.fontStretch = computed.fontStretch;
  host.style.fontSize = "64px";
  host.style.fontVariationSettings = computed.fontVariationSettings;
  document.body.appendChild(host);

  const measure = (settings) =>
    PROBE_STRINGS.map((text) => {
      const span = document.createElement("span");
      span.textContent = text;
      span.style.fontFeatureSettings = settings;
      span.style.fontKerning = "normal";
      host.appendChild(span);
      const width = span.getBoundingClientRect().width;
      span.remove();
      return width;
    });

  const baseline = measure('"kern" 1');
  const effective = new Set();

  for (const tag of tags) {
    const on = measure(`"kern" 1, "${tag}" 1`);
    const off = measure(`"kern" 1, "${tag}" 0`);
    const changes = on.some(
      (w, i) => Math.abs(w - off[i]) > 0.05 || Math.abs(w - baseline[i]) > 0.05,
    );
    if (changes) effective.add(tag);
  }

  host.remove();
  return effective;
}

export function measureKernPairs(element, pairs) {
  if (!element || typeof document === "undefined") return [];

  const computed = getComputedStyle(element);
  const size = 100;
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "position:fixed;left:-99999px;top:0;white-space:pre;pointer-events:none;contain:strict;";
  host.style.fontFamily = computed.fontFamily;
  host.style.fontWeight = computed.fontWeight;
  host.style.fontStyle = computed.fontStyle;
  host.style.fontSize = `${size}px`;
  host.style.fontVariationSettings = computed.fontVariationSettings;
  host.style.letterSpacing = "normal";
  document.body.appendChild(host);

  const widthOf = (text, kerning) => {
    const span = document.createElement("span");
    span.textContent = text;
    span.style.fontKerning = kerning;
    span.style.fontFeatureSettings = kerning === "none" ? '"kern" 0' : '"kern" 1';
    host.appendChild(span);
    const width = span.getBoundingClientRect().width;
    span.remove();
    return width;
  };

  const results = pairs.map((pair) => {
    const kerned = widthOf(pair, "normal");
    const flat = widthOf(pair, "none");
    return {
      pair,
      kerned,
      flat,
      deltaEm: (kerned - flat) / size,
    };
  });

  host.remove();
  return results.sort((a, b) => a.deltaEm - b.deltaEm);
}

export function measureAdvances(element, text) {
  if (!element || !text || typeof document === "undefined") return [];

  const computed = getComputedStyle(element);
  const size = 96;
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "position:fixed;left:-99999px;top:0;white-space:pre;pointer-events:none;contain:strict;";
  host.style.fontFamily = computed.fontFamily;
  host.style.fontWeight = computed.fontWeight;
  host.style.fontStyle = computed.fontStyle;
  host.style.fontSize = `${size}px`;
  host.style.fontVariationSettings = computed.fontVariationSettings;
  host.style.fontFeatureSettings = computed.fontFeatureSettings;
  host.style.letterSpacing = "normal";
  document.body.appendChild(host);

  const line = document.createElement("span");
  line.textContent = text;
  host.appendChild(line);

  const node = line.firstChild;
  const range = document.createRange();
  const chars = Array.from(text);
  const out = [];
  let index = 0;

  for (const char of chars) {
    range.setStart(node, index);
    range.setEnd(node, index + char.length);
    const rect = range.getBoundingClientRect();
    out.push({ char, advance: rect.width / size, left: rect.left });
    index += char.length;
  }

  const origin = out.length ? out[0].left : 0;
  const normalised = out.map((entry, i) => ({
    char: entry.char,
    advance: entry.advance,
    offset: (entry.left - origin) / size,
    sidebearing:
      i === 0 ? 0 : (entry.left - out[i - 1].left) / size - out[i - 1].advance,
  }));

  host.remove();
  return normalised;
}
