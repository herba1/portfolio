"use client";

import { Component } from "react";

const MAX_RETRIES = 2;

export default class SplatErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, retries: 0 };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    const msg = error?.message || String(error);
    const attempt = this.state.retries + 1;
    const componentStack = info?.componentStack?.split("\n").slice(0, 4).join("\n");
    console.error(
      `[SplatErrorBoundary] 3D scene failed (attempt ${attempt}/${MAX_RETRIES + 1}):\n` +
      `  error: ${msg}\n` +
      `  type: ${error?.constructor?.name || typeof error}\n` +
      `  stack: ${componentStack || "n/a"}`
    );

    if (this.state.retries < MAX_RETRIES) {
      setTimeout(() => {
        console.log(`[SplatErrorBoundary] retrying (${attempt + 1}/${MAX_RETRIES + 1})…`);
        this.setState((s) => ({ hasError: false, retries: s.retries + 1 }));
      }, 1500);
    } else {
      console.error("[SplatErrorBoundary] all retries exhausted, giving up");
    }
  }

  render() {
    if (this.state.hasError && this.state.retries >= MAX_RETRIES) {
      return null;
    }
    if (this.state.hasError) {
      // Waiting for retry timer
      return null;
    }
    // Key forces full remount on retry so the Splat loader re-fetches
    return (
      <div key={this.state.retries}>
        {this.props.children}
      </div>
    );
  }
}
