export const FONT_FAMILIES = [
  { label: "Inherit", value: "" },
  { label: "Geist Sans", value: "var(--font-sans)" },
  { label: "Geist Mono", value: "var(--font-mono)" },
  { label: "Inter", value: "var(--font-inter)" },
  { label: "System UI", value: "system-ui" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Times", value: '"Times New Roman", serif' },
  { label: "Courier", value: '"Courier New", monospace' },
];

export const STYLE_CONTROLS = [
  {
    prop: "font-size",
    label: "Size",
    type: "range",
    unit: "px",
    min: 8,
    max: 72,
    step: 0.25,
  },
  {
    prop: "font-weight",
    label: "Weight",
    type: "range",
    unit: "",
    min: 100,
    max: 900,
    step: 5,
  },
  {
    prop: "line-height",
    label: "Line height",
    type: "range",
    unit: "ratio",
    min: 0.9,
    max: 2.2,
    step: 0.01,
  },
  {
    prop: "letter-spacing",
    label: "Tracking",
    type: "range",
    unit: "em",
    min: -0.06,
    max: 0.12,
    step: 0.0005,
  },
  {
    prop: "word-spacing",
    label: "Word spacing",
    type: "range",
    unit: "em",
    min: -0.15,
    max: 0.5,
    step: 0.005,
  },
  {
    prop: "font-stretch",
    label: "Width",
    type: "range",
    unit: "%",
    min: 75,
    max: 125,
    step: 0.5,
  },
  {
    prop: "font-family",
    label: "Family",
    type: "select",
    options: FONT_FAMILIES,
  },
  {
    prop: "font-style",
    label: "Style",
    type: "select",
    options: [
      { label: "Normal", value: "normal" },
      { label: "Italic", value: "italic" },
      { label: "Oblique 10deg", value: "oblique 10deg" },
    ],
  },
  {
    prop: "font-optical-sizing",
    label: "Optical sizing",
    type: "select",
    options: [
      { label: "Auto", value: "auto" },
      { label: "None", value: "none" },
    ],
  },
  {
    prop: "font-variation-settings",
    label: "Variations",
    type: "text",
    placeholder: '"opsz" 20, "slnt" -6',
  },
  {
    prop: "font-synthesis",
    label: "Synthesis",
    type: "select",
    options: [
      { label: "None", value: "none" },
      { label: "Weight", value: "weight" },
      { label: "Style", value: "style" },
      { label: "Weight + style", value: "weight style" },
    ],
  },
];

export const TEXT_CONTROLS = [
  {
    prop: "color",
    label: "Colour",
    type: "color",
  },
  {
    prop: "opacity",
    label: "Opacity",
    type: "range",
    unit: "",
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    prop: "text-align",
    label: "Align",
    type: "select",
    options: [
      { label: "Start", value: "start" },
      { label: "Left", value: "left" },
      { label: "Center", value: "center" },
      { label: "Right", value: "right" },
      { label: "Justify", value: "justify" },
    ],
  },
  {
    prop: "text-wrap",
    label: "Wrap",
    type: "select",
    options: [
      { label: "Wrap", value: "wrap" },
      { label: "Balance", value: "balance" },
      { label: "Pretty", value: "pretty" },
      { label: "Stable", value: "stable" },
      { label: "Nowrap", value: "nowrap" },
    ],
  },
  {
    prop: "max-width",
    label: "Measure",
    type: "range",
    unit: "ch",
    min: 20,
    max: 90,
    step: 0.5,
  },
  {
    prop: "text-indent",
    label: "Indent",
    type: "range",
    unit: "em",
    min: -2,
    max: 4,
    step: 0.05,
  },
  {
    prop: "text-transform",
    label: "Transform",
    type: "select",
    options: [
      { label: "None", value: "none" },
      { label: "Uppercase", value: "uppercase" },
      { label: "Lowercase", value: "lowercase" },
      { label: "Capitalize", value: "capitalize" },
    ],
  },
  {
    prop: "white-space",
    label: "White space",
    type: "select",
    options: [
      { label: "Normal", value: "normal" },
      { label: "Nowrap", value: "nowrap" },
      { label: "Pre", value: "pre" },
      { label: "Pre-wrap", value: "pre-wrap" },
      { label: "Pre-line", value: "pre-line" },
      { label: "Balance", value: "break-spaces" },
    ],
  },
  {
    prop: "text-decoration-line",
    label: "Decoration",
    type: "select",
    options: [
      { label: "None", value: "none" },
      { label: "Underline", value: "underline" },
      { label: "Overline", value: "overline" },
      { label: "Line through", value: "line-through" },
    ],
  },
  {
    prop: "text-decoration-thickness",
    label: "Rule weight",
    type: "range",
    unit: "em",
    min: 0.01,
    max: 0.15,
    step: 0.0025,
  },
  {
    prop: "text-underline-offset",
    label: "Rule offset",
    type: "range",
    unit: "em",
    min: -0.1,
    max: 0.35,
    step: 0.005,
  },
  {
    prop: "text-decoration-color",
    label: "Rule colour",
    type: "color",
  },
  {
    prop: "hanging-punctuation",
    label: "Hanging punct",
    type: "select",
    options: [
      { label: "None", value: "none" },
      { label: "First", value: "first" },
      { label: "Last", value: "last" },
      { label: "First + last", value: "first last" },
    ],
  },
  {
    prop: "text-shadow",
    label: "Shadow",
    type: "text",
    placeholder: "0 1px 0 #0002",
  },
  {
    prop: "-webkit-font-smoothing",
    label: "Smoothing",
    type: "select",
    options: [
      { label: "Auto", value: "auto" },
      { label: "Antialiased", value: "antialiased" },
      { label: "Subpixel", value: "subpixel-antialiased" },
      { label: "None", value: "none" },
    ],
  },
  {
    prop: "text-rendering",
    label: "Rendering",
    type: "select",
    options: [
      { label: "Auto", value: "auto" },
      { label: "Optimize legibility", value: "optimizeLegibility" },
      { label: "Optimize speed", value: "optimizeSpeed" },
      { label: "Geometric precision", value: "geometricPrecision" },
    ],
  },
  {
    prop: "paint-order",
    label: "Paint order",
    type: "select",
    options: [
      { label: "Normal", value: "normal" },
      { label: "Stroke first", value: "stroke fill" },
    ],
  },
];

export const FEATURE_SELECTS = [
  {
    prop: "font-kerning",
    label: "Kerning",
    type: "select",
    options: [
      { label: "Auto", value: "auto" },
      { label: "Normal", value: "normal" },
      { label: "None", value: "none" },
    ],
  },
  {
    prop: "font-variant-ligatures",
    label: "Ligatures",
    type: "select",
    options: [
      { label: "Normal", value: "normal" },
      { label: "None", value: "none" },
      { label: "Common", value: "common-ligatures" },
      { label: "No common", value: "no-common-ligatures" },
      { label: "Discretionary", value: "discretionary-ligatures" },
      { label: "Contextual", value: "contextual" },
      { label: "No contextual", value: "no-contextual" },
    ],
  },
  {
    prop: "font-variant-numeric",
    label: "Numerals",
    type: "select",
    options: [
      { label: "Normal", value: "normal" },
      { label: "Tabular", value: "tabular-nums" },
      { label: "Proportional", value: "proportional-nums" },
      { label: "Oldstyle", value: "oldstyle-nums" },
      { label: "Lining", value: "lining-nums" },
      { label: "Slashed zero", value: "slashed-zero" },
      { label: "Tabular + slashed", value: "tabular-nums slashed-zero" },
      { label: "Diagonal fractions", value: "diagonal-fractions" },
    ],
  },
  {
    prop: "font-variant-caps",
    label: "Caps",
    type: "select",
    options: [
      { label: "Normal", value: "normal" },
      { label: "Small caps", value: "small-caps" },
      { label: "All small caps", value: "all-small-caps" },
      { label: "Petite caps", value: "petite-caps" },
      { label: "Titling", value: "titling-caps" },
      { label: "Unicase", value: "unicase" },
    ],
  },
  {
    prop: "font-variant-position",
    label: "Position",
    type: "select",
    options: [
      { label: "Normal", value: "normal" },
      { label: "Super", value: "super" },
      { label: "Sub", value: "sub" },
    ],
  },
];

const range = (prefix, count) =>
  Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(2, "0")}`);

export const FEATURE_GROUPS = [
  {
    label: "Ligatures & context",
    tags: ["kern", "liga", "clig", "calt", "dlig", "hlig", "rlig"],
  },
  {
    label: "Numerals",
    tags: ["tnum", "pnum", "lnum", "onum", "zero", "frac", "afrc", "ordn", "nalt"],
  },
  {
    label: "Case & position",
    tags: ["case", "cpsp", "smcp", "c2sc", "sups", "subs", "titl", "unic"],
  },
  {
    label: "Alternates",
    tags: ["aalt", "salt", "swsh", "hist", "ss20"],
  },
  {
    label: "Stylistic sets",
    tags: range("ss", 11),
  },
  {
    label: "Character variants",
    tags: range("cv", 14),
  },
];

export const TRACKING_K_PRESETS = [
  { label: "Geist", value: 0.043, note: "Inherits the Inter constant" },
  { label: "Inter", value: 0.043, note: "Measured, benji.org and family.co" },
  { label: "Honk Sans", value: 0.081, note: "Measured, honk.me" },
  { label: "Plex Serif", value: 0.02, note: "Measured, agentation.com" },
  { label: "Flat", value: 0, note: "No optical correction" },
];

export const WEIGHT_STOPS = [
  { value: 430, note: "Serif italic emphasis" },
  { value: 440, note: "14px meta" },
  { value: 460, note: "Body" },
  { value: 490, note: "13px body" },
  { value: 520, note: "11px caption" },
  { value: 560, note: "Subsection heading" },
  { value: 600, note: "Section heading, strong" },
  { value: 620, note: "Dense label" },
];

export const TYPE_STEPS = [
  { label: "Page title", size: 19, weight: 500, leading: 0, tracking: -0.3 },
  { label: "Section", size: 15, weight: 600, leading: 0, tracking: -0.13 },
  { label: "Subsection", size: 14, weight: 560, leading: 20, tracking: -0.09 },
  { label: "Article title", size: 14, weight: 500, leading: 20, tracking: -0.09 },
  { label: "Body", size: 14, weight: 460, leading: 20, tracking: -0.09 },
  { label: "Dense", size: 13, weight: 500, leading: 18, tracking: -0.04 },
  { label: "Meta", size: 12, weight: 460, leading: 16, tracking: 0 },
  { label: "Micro", size: 11, weight: 460, leading: 14, tracking: 0.04 },
];

export const SPECIMEN_SIZES = [11, 12, 13, 14, 15, 17, 19, 24, 32, 44, 64, 88];
export const SPECIMEN_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

export const KERNING_PAIRS = [
  "AV", "AW", "AT", "AY", "Av", "Aw", "Ay",
  "FA", "LT", "LV", "LY", "PA", "Ta", "Te",
  "To", "Tr", "Tu", "Tw", "Ty", "VA", "Va",
  "Ve", "Vo", "WA", "Wa", "We", "Wo", "Ya",
  "Ye", "Yo", "r.", "y.", "f)", "1.", "7,",
];

export const GLYPH_ROWS = [
  "ABCDEFGHIJKLM",
  "NOPQRSTUVWXYZ",
  "abcdefghijklm",
  "nopqrstuvwxyz",
  "0123456789",
  "!?&@#$%^*()[]{}",
  ".,;:'\"“”‘’—–-",
  "+×÷=<>≤≥±≈∞",
  "→←↑↓↔⁄|\\/",
  "áàâäãåéèêëíìîïóòôöõúùûü",
];

export const PANGRAM = "The quick brown fox jumps over the lazy dog";
