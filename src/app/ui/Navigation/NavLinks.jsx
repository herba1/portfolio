"use client";

import { useState, useCallback } from "react";
import LinkMask from "../LinkMask";
import MailIcon from "./MailIcon";
import { LINKS, DEV_LINKS } from "./LINKS";
import { useIsDev } from "./useIsDev";

export default function NavLinks({className=""}) {

  const isDev = useIsDev();
  const allLinks = isDev ? [...LINKS, ...DEV_LINKS] : LINKS;
  const primaryLinks = allLinks.filter((l) => l.primary);
  const secondaryLinks = allLinks.filter((l) => !l.primary);
  const [open, setOpen] = useState(false);

  const toggle = useCallback(() => setOpen((o) => !o), []);

  return (
    <div className={`hidden sm:flex text-center items-center ${className}`}>
      {/* Expanding links — clip reveals leftward */}
      <div className={`nav__contact-group ${open ? "is-open" : ""}`}>
        <div className="nav__contact-links">
          {secondaryLinks.map((link, i) => (
            <span key={link.name} className="nav__link--secondary" style={{ "--link-i": i }}>
              <LinkMask text={link.name} href={link.link} textClassName={link.dev ? "text-amber-600" : ""} />
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={toggle}
          className="nav__toggle-btn relative cursor-pointer appearance-none bg-transparent border-none p-0 flex items-center justify-center ml-4 md:ml-6"
          aria-label="Toggle contact links"
        >
          <MailIcon open={open} />
        </button>
      </div>

      <ul className="flex items-center">
        {primaryLinks.map((link) => (
          <li key={link.name} className="ml-4 md:ml-6">
            <LinkMask text={link.name} href={link.link} textClassName={link.dev ? "text-amber-600" : ""} />
          </li>
        ))}
      </ul>
    </div>
  );
}