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
    console.warn(`[SplatErrorBoundary] 3D scene failed (attempt ${this.state.retries + 1}/${MAX_RETRIES + 1}):`, msg);

    if (this.state.retries < MAX_RETRIES) {
      // Retry after a short delay — Vercel CDN often succeeds on subsequent requests
      setTimeout(() => {
        this.setState((s) => ({ hasError: false, retries: s.retries + 1 }));
      }, 1500);
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
