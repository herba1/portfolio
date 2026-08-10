"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMobileMenu } from "./Navigation/MobileMenuContext";
import { geist } from "@/app/fonts";

const STORAGE_KEY = "herb:chrome-hidden";
const HINT_MS = 2600;

const isTypingTarget = (el) =>
  !!el &&
  (el.isContentEditable ||
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT");

const isTogglePress = (e) =>
  ((e.metaKey || e.ctrlKey) && !e.altKey && e.code === "Period") ||
  (e.altKey && !e.metaKey && !e.ctrlKey && e.code === "KeyH");

export default function ZenMode() {
  const menu = useMobileMenu();
  const [hidden, setHidden] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return sessionStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [hintVisible, setHintVisible] = useState(false);
  const [shortcut, setShortcut] = useState("⌘ .");
  const hintTimer = useRef(null);

  useEffect(() => {
    if (!/mac|iphone|ipad/i.test(navigator.userAgent)) setShortcut("Ctrl .");
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (hidden) root.dataset.chrome = "off";
    else delete root.dataset.chrome;
    try {
      sessionStorage.setItem(STORAGE_KEY, hidden ? "1" : "0");
    } catch {}
    window.dispatchEvent(
      new CustomEvent("chromevisibilitychange", { detail: { hidden } }),
    );
  }, [hidden]);

  const showHint = useCallback(() => {
    setHintVisible(true);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => {
      hintTimer.current = null;
      setHintVisible(false);
    }, HINT_MS);
  }, []);

  const apply = useCallback(
    (next) => {
      setHidden(next);
      if (next) {
        menu?.close?.();
        showHint();
      } else {
        if (hintTimer.current) clearTimeout(hintTimer.current);
        hintTimer.current = null;
        setHintVisible(false);
      }
    },
    [menu, showHint],
  );

  useEffect(() => {
    const onKeyDown = (e) => {
      if (isTypingTarget(e.target)) return;
      if (isTogglePress(e)) {
        e.preventDefault();
        apply(!hidden);
        return;
      }
      if (hidden && e.key === "Escape") {
        e.preventDefault();
        apply(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [apply, hidden]);

  useEffect(
    () => () => {
      if (hintTimer.current) clearTimeout(hintTimer.current);
      delete document.documentElement.dataset.chrome;
    },
    [],
  );

  if (!hintVisible) return null;

  return (
    <div className={`chrome-hint ${geist.className}`} role="status">
      Interface hidden — press {shortcut} to bring it back
    </div>
  );
}
