"use client";

import { Component } from "react";

// One piece failing — most often a WebGL context the browser refused, after
// its GPU process crashed — leaves its tile empty instead of taking the whole
// index down with it.
export default class PieceBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.warn(`[experiments] ${this.props.slug} failed to render:`, error.message);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
