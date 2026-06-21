"use client";

import { createContext, useContext, useEffect, useState } from "react";

const MobileMenuContext = createContext(null);

export function MobileMenuProvider({ children }) {
  const [open, setOpen] = useState(false);

  // Scroll lock while open. position:fixed + restore so it holds on iOS
  // Safari and the card keeps showing the current scroll offset.
  useEffect(() => {
    if (!open) return;
    const scrollY = window.scrollY;
    const body = document.body;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  const toggle = () => setOpen((o) => !o);
  const close = () => setOpen(false);

  return (
    <MobileMenuContext.Provider value={{ open, setOpen, toggle, close }}>
      {children}
    </MobileMenuContext.Provider>
  );
}

export const useMobileMenu = () => useContext(MobileMenuContext);
