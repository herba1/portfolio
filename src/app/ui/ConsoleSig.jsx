"use client";

import { useEffect } from "react";

export default function ConsoleSig() {
  useEffect(() => {
    const styles = {
      header: [
        "font-size: 14px",
        "font-family: monospace",
        "color: #1a1a1a",
        "line-height: 1.6",
      ].join(";"),
      name: [
        "font-size: 20px",
        "font-weight: 700",
        "font-family: system-ui, -apple-system, sans-serif",
        "color: #e2e8f0",
        "letter-spacing: -0.02em",
      ].join(";"),
      role: [
        "font-size: 12px",
        "font-family: monospace",
        "color: #94a3b8",
        "letter-spacing: 0.04em",
      ].join(";"),
      link: [
        "font-size: 11px",
        "font-family: monospace",
        "color: #60a5fa",
      ].join(";"),
      dim: [
        "font-size: 11px",
        "font-family: monospace",
        "color: #64748b",
      ].join(";"),
    };

    console.log(
      `%c\n` +
      `%cherb%c\n` +
      `%cdesign engineer @ crowdvolt%c\n\n` +
      `%c→ %chttps://herb.art%c\n` +
      `%c→ %chttps://github.com/herba1%c\n` +
      `%c→ %chi@herb.art%c\n`,
      styles.header,
      styles.name, "",
      styles.role, "",
      styles.dim, styles.link, "",
      styles.dim, styles.link, "",
      styles.dim, styles.link, "",
    );
  }, []);

  return null;
}
