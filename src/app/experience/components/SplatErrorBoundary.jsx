"use client";

import { Component } from "react";

export default class SplatErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.warn("[SplatErrorBoundary] 3D scene failed to load:", error?.message);
  }

  render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}
