export const GITIGNORE_SOURCE = ["/target", "/node_modules", "/web/dist", ".env", "*.log"];

export const FILES = [
  {
    path: "src/main.rs",
    lang: "rust",
    content: `use std::env;

mod cli;
mod search;

fn main() {
    let args: Vec<String> = env::args().collect();
    let config = cli::parse(&args);

    let _todo = "TODO: stream matches instead of collecting them all";
    let matches = search::run(&config);

    for m in matches {
        println!("{}:{}: {}", m.path, m.line, m.text);
    }
}`,
  },
  {
    path: "src/lib.rs",
    lang: "rust",
    content: `pub mod search;
pub mod cli;

pub const VERSION: &str = "0.4.2";

pub fn greeting() -> String {
    format!("scanner v{}", VERSION)
}`,
  },
  {
    path: "src/search/mod.rs",
    lang: "rust",
    content: `pub mod matcher;

use crate::cli::Config;
use matcher::Matcher;

pub struct Hit {
    pub path: String,
    pub line: usize,
    pub text: String,
}

pub fn run(config: &Config) -> Vec<Hit> {
    let matcher = Matcher::new(&config.pattern, config.case_insensitive);
    let mut hits = Vec::new();

    let _fixme = "FIXME: this walks the whole tree even when .gitignore excludes most of it";
    for file in walk(&config.root) {
        for (n, line) in file.lines.iter().enumerate() {
            if matcher.is_match(line) {
                hits.push(Hit { path: file.path.clone(), line: n + 1, text: line.clone() });
            }
        }
    }

    hits
}`,
  },
  {
    path: "src/search/matcher.rs",
    lang: "rust",
    content: `pub struct Matcher {
    needle: String,
    case_insensitive: bool,
}

impl Matcher {
    pub fn new(pattern: &str, case_insensitive: bool) -> Self {
        Matcher { needle: pattern.to_string(), case_insensitive }
    }

    pub fn is_match(&self, line: &str) -> bool {
        if self.case_insensitive {
            line.to_lowercase().contains(&self.needle.to_lowercase())
        } else {
            line.contains(&self.needle)
        }
    }
}

pub const NOTE: &str = "TODO: swap this for a real finite automaton once the naive scan gets slow";`,
  },
  {
    path: "src/cli.rs",
    lang: "rust",
    content: `pub struct Config {
    pub pattern: String,
    pub root: String,
    pub case_insensitive: bool,
    pub hidden: bool,
}

pub fn parse(args: &[String]) -> Config {
    let mut pattern = String::new();
    let mut root = ".".to_string();
    let mut case_insensitive = false;
    let mut hidden = false;

    for arg in &args[1..] {
        match arg.as_str() {
            "-i" => case_insensitive = true,
            "--hidden" => hidden = true,
            other if pattern.is_empty() => pattern = other.to_string(),
            other => root = other.to_string(),
        }
    }

    Config { pattern, root, case_insensitive, hidden }
}`,
  },
  {
    path: "tests/integration_test.rs",
    lang: "rust",
    content: `use scanner::search;
use scanner::cli::Config;

#[test]
fn finds_a_known_line() {
    let config = Config {
        pattern: "error".to_string(),
        root: "fixtures".to_string(),
        case_insensitive: true,
        hidden: false,
    };

    let hits = search::run(&config);
    assert!(!hits.is_empty(), "expected at least one match");
}

pub const NOTE: &str = "TODO: add a fixture for symlink loops before this ships";`,
  },
  {
    path: "web/src/index.js",
    lang: "js",
    content: `import { formatDate } from "./utils/formatDate.js";
import { fetchResults } from "./utils/api.js";

export function renderResults(container, query) {
  const note = "TODO: debounce this once the input fires on every keystroke";
  fetchResults(query)
    .then((results) => {
      container.innerHTML = results
        .map((r) => \`<li>\${r.path} — \${formatDate(r.timestamp)}</li>\`)
        .join("");
    })
    .catch((error) => {
      console.error("search failed:", error);
      container.textContent = "error: could not load results";
    });
}

function highlight(text, term) {
  return text.replace(new RegExp(term, "gi"), (match) => \`<mark>\${match}</mark>\`);
}`,
  },
  {
    path: "web/src/utils/formatDate.js",
    lang: "js",
    content: `export function formatDate(timestamp) {
  const date = new Date(timestamp);
  return date.toISOString().slice(0, 10);
}

const relativeNote = "FIXME: this ignores the user's locale entirely";
export function formatRelative(timestamp) {
  const delta = Date.now() - timestamp;
  if (delta < 60_000) return "just now";
  return \`\${Math.floor(delta / 60_000)}m ago\`;
}`,
  },
  {
    path: "web/src/utils/api.js",
    lang: "js",
    content: `const BASE_URL = "https://api.scanner.dev/v1";

export async function fetchResults(query) {
  const response = await fetch(\`\${BASE_URL}/search?q=\${encodeURIComponent(query)}\`);
  if (!response.ok) {
    throw new Error(\`request failed with status \${response.status}\`);
  }
  return response.json();
}

export function fetchVersion() {
  return fetch(\`\${BASE_URL}/version\`).then((r) => r.json());
}`,
  },
  {
    path: "web/src/styles.css",
    lang: "css",
    content: `:root {
  --accent: #4f46e5;
  --danger: #dc2626;
  --ink: #111114;
}

.badge {
  background: var(--accent);
  color: #ffffff;
}`,
  },
  {
    path: "web/package.json",
    lang: "json",
    content: `{
  "name": "scanner-web",
  "version": "0.4.2",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "chalk": "^5.3.0"
  }
}`,
  },
  {
    path: "Cargo.toml",
    lang: "toml",
    content: `[package]
name = "scanner"
version = "0.4.2"
edition = "2021"

[dependencies]
regex = "1.10"

[[bin]]
name = "scanner"
path = "src/main.rs"`,
  },
  {
    path: "README.md",
    lang: "md",
    content: `# scanner

A small recursive text search tool, built to learn how ripgrep-style
matchers work under the hood.

## Usage

    scanner "TODO" ./src

See https://github.com/BurntSushi/ripgrep for the real thing — this is
a toy reimplementation, not a replacement.

## Status

Early days. Colour output and gitignore support are next.`,
  },
  {
    path: "CHANGELOG.md",
    lang: "md",
    content: `## 0.4.2
- Fix: matcher no longer panics on empty pattern
- Add: --hidden flag for dotfiles

## 0.4.1
- TODO: write proper release notes next time

## 0.4.0
- Initial public version`,
  },
  {
    path: "CONTRIBUTORS.md",
    lang: "md",
    content: `Maintained by:

- Ada Reyes <ada.reyes@example.com>
- Sam Okafor <sam.okafor@example.dev>
- Priya Nair <priya@scanner.dev>

Say hello at team@scanner.dev.`,
  },
  {
    path: "scripts/build.sh",
    lang: "sh",
    content: `#!/usr/bin/env bash
set -euo pipefail

echo "building scanner..."
cargo build --release

# TODO: strip debug symbols before publishing the binary
cp target/release/scanner ./dist/scanner`,
  },
  {
    path: "scripts/deploy.sh",
    lang: "sh",
    content: `#!/usr/bin/env bash
set -euo pipefail

VERSION=$(grep '^version' Cargo.toml | head -n1 | cut -d '"' -f2)
echo "deploying v\${VERSION}..."

scp ./dist/scanner deploy@scanner.dev:/usr/local/bin/scanner`,
  },
  {
    path: ".gitignore",
    lang: "text",
    content: GITIGNORE_SOURCE.join("\n"),
  },
  {
    path: ".env",
    lang: "text",
    content: `API_TOKEN=sk_live_51H8x9K2example
DATABASE_URL=postgres://scanner:secret@localhost:5432/scanner`,
  },
  {
    path: "node_modules/chalk/index.js",
    lang: "js",
    content: `module.exports = function chalk(str) {
  return \`\\u001b[36m\${str}\\u001b[39m\`;
}

const vendorNote = "vendored build output, not part of this project";`,
  },
  {
    path: "target/debug/build.log",
    lang: "text",
    content: `   Compiling scanner v0.4.2
warning: unused variable: \`root\`
error: could not compile \`scanner\` (bin "scanner") due to 1 previous error`,
  },
  {
    path: ".git/HEAD",
    lang: "text",
    content: `ref: refs/heads/main`,
  },
];

export const FILE_TYPES = [
  { key: "all", label: "All", ext: null },
  { key: "rust", label: "Rust", ext: "rs" },
  { key: "js", label: "JS", ext: "js" },
  { key: "md", label: "Markdown", ext: "md" },
  { key: "toml", label: "TOML", ext: "toml" },
  { key: "sh", label: "Shell", ext: "sh" },
];

export const PRESETS = [
  { label: "TODO / FIXME", pattern: "TODO|FIXME", mode: "regex", caseMode: "sensitive", wholeWord: false, fileType: "all" },
  { label: "Function definitions", pattern: "\\b(fn|function) \\w+\\(", mode: "regex", caseMode: "smart", wholeWord: false, fileType: "all" },
  { label: "Email addresses", pattern: "[\\w.+-]+@[\\w.-]+\\.\\w+", mode: "regex", caseMode: "smart", wholeWord: false, fileType: "all" },
  { label: "Semver versions", pattern: "\\d+\\.\\d+\\.\\d+", mode: "regex", caseMode: "smart", wholeWord: false, fileType: "all" },
  { label: "Hex colors", pattern: "#[0-9a-fA-F]{6}\\b", mode: "regex", caseMode: "smart", wholeWord: false, fileType: "all" },
  { label: "console calls", pattern: "console\\.(log|error|warn)", mode: "regex", caseMode: "smart", wholeWord: false, fileType: "js" },
];

export const DEFAULT_PARAMS = {
  pattern: "TODO|FIXME",
  mode: "regex",
  caseMode: "sensitive",
  wholeWord: false,
  invert: false,
  context: 1,
  hidden: false,
  noIgnore: false,
  fileType: "all",
};

function escapeRegExp(source) {
  return source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesGitignore(path) {
  const segments = path.split("/");
  if (segments.includes(".git")) return true;
  return GITIGNORE_SOURCE.some((rule) => {
    if (rule.startsWith("/")) {
      const prefix = rule.slice(1);
      return path === prefix || path.startsWith(`${prefix}/`);
    }
    if (rule.startsWith("*.")) {
      return path.endsWith(rule.slice(1));
    }
    return path === rule || path.endsWith(`/${rule}`);
  });
}

function isHidden(path) {
  return path.split("/").some((segment) => segment.startsWith("."));
}

export function buildRegex({ pattern, mode, caseMode, wholeWord }) {
  if (!pattern) return { regex: null, error: null };
  const body = mode === "fixed" ? escapeRegExp(pattern) : pattern;
  const wrapped = wholeWord ? `\\b(?:${body})\\b` : body;
  const insensitive =
    caseMode === "insensitive" || (caseMode === "smart" && pattern === pattern.toLowerCase());
  try {
    return { regex: new RegExp(wrapped, insensitive ? "giu" : "gu"), error: null };
  } catch (error) {
    return { regex: null, error: error.message };
  }
}

export function buildCommand(params) {
  const flags = [];
  if (params.caseMode === "insensitive") flags.push("-i");
  if (params.caseMode === "sensitive") flags.push("-s");
  if (params.mode === "fixed") flags.push("-F");
  if (params.wholeWord) flags.push("-w");
  if (params.invert) flags.push("-v");
  if (params.context > 0) flags.push(`-C ${params.context}`);
  if (params.hidden) flags.push("--hidden");
  if (params.noIgnore) flags.push("--no-ignore");
  if (params.fileType !== "all") flags.push(`-t ${params.fileType}`);
  const safePattern = params.pattern.replace(/"/g, '\\"');
  return ["rg", ...flags, `"${safePattern}"`].join(" ");
}

function findMatches(line, regex) {
  if (!regex) return [];
  const ranges = [];
  regex.lastIndex = 0;
  let match = regex.exec(line);
  let guard = 0;
  while (match && guard < 200) {
    ranges.push([match.index, match.index + match[0].length]);
    regex.lastIndex = match[0].length === 0 ? regex.lastIndex + 1 : regex.lastIndex;
    match = regex.exec(line);
    guard += 1;
  }
  return ranges;
}

export function runSearch(params) {
  const started = performance.now();
  const { regex, error } = buildRegex(params);

  const stats = { totalFiles: FILES.length, searched: 0, matchedFiles: 0, matches: 0 };
  const groups = [];

  if (!error && regex) {
    for (const file of FILES) {
      const excluded =
        (!params.noIgnore && matchesGitignore(file.path)) ||
        (!params.hidden && isHidden(file.path)) ||
        (params.fileType !== "all" && file.lang !== params.fileType);
      if (excluded) continue;

      stats.searched += 1;
      const lines = file.content.split("\n");
      const hitIndices = [];
      const matchesByLine = new Map();

      lines.forEach((line, index) => {
        const ranges = findMatches(line, regex);
        const isHit = params.invert ? ranges.length === 0 : ranges.length > 0;
        if (isHit) {
          hitIndices.push(index);
          matchesByLine.set(index, params.invert ? [] : ranges);
        }
      });

      if (hitIndices.length === 0) continue;
      stats.matchedFiles += 1;
      stats.matches += hitIndices.length;

      const blocks = [];
      let current = null;
      for (const hitIndex of hitIndices) {
        const from = Math.max(0, hitIndex - params.context);
        const to = Math.min(lines.length - 1, hitIndex + params.context);
        if (current && from <= current.to + 1) {
          current.to = Math.max(current.to, to);
        } else {
          current = { from, to };
          blocks.push(current);
        }
      }

      groups.push({
        path: file.path,
        lang: file.lang,
        hitCount: hitIndices.length,
        blocks: blocks.map((block) => ({
          lines: Array.from({ length: block.to - block.from + 1 }, (_, offset) => {
            const index = block.from + offset;
            return {
              number: index + 1,
              content: lines[index],
              isHit: matchesByLine.has(index),
              ranges: matchesByLine.get(index) ?? [],
            };
          }),
        })),
      });
    }
  }

  stats.elapsedMs = performance.now() - started;
  return { groups, stats, error };
}
