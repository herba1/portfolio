"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { geist } from "@/app/fonts";
import { LINKS, DEV_LINKS } from "./LINKS";
import { useIsDev } from "./useIsDev";
import { useMobileMenu } from "./MobileMenuContext";
import NavSocialIcon from "./NavSocialIcon";
import posthog from "posthog-js";

/* The mobile link list. Sits fixed behind the page card and is revealed
   when the card scales back. Mobile-only (hidden via CSS above sm).

   Primary/internal routes stack as the big bold list; the external social
   links collapse into a right-aligned icon row pinned near the bottom of
   the visible band (above the pushed-down page card). */
export default function NavMenu({ open, setOpen }) {
  const isDev = useIsDev();
  const router = useRouter();
  const pathname = usePathname();
  const { closeThen } = useMobileMenu();
  const links = isDev ? [...LINKS, ...DEV_LINKS] : LINKS;
  const mainLinks = links.filter((l) => l.primary);
  const socialLinks = links.filter((l) => !l.primary);

  // An in-site route waits for the menu: the card slides back, the scroll
  // returns to where it was, and only then does the router run. Navigating on
  // the tap instead would start the page transition while the card is still
  // mid-slide, and the outgoing snapshot would be taken of a scaled, clipped,
  // pushed-down page (see closeThen in MobileMenuContext).
  //
  // Everything else — the socials, the mail link — opens in a new tab or hands
  // off to the OS. There's no page transition to protect, so those just close
  // the menu and let the browser take the click.
  const onNavigate = (e, link) => {
    posthog.capture("nav_link_clicked", { link: link.name.toLowerCase() });
    if (!link.link.startsWith("/")) {
      setOpen(false);
      return;
    }
    e.preventDefault();
    if (link.link === pathname) {
      setOpen(false);
      return;
    }
    closeThen(() => router.push(link.link));
  };

  return (
    <div
      className={`mobile-menu ${open ? "is-open" : ""} ${geist.className}`}
      aria-hidden={!open}
    >
      <nav className="mobile-menu__list">
        {mainLinks.map((link, i) => {
          const isInternal = link.link.startsWith("/");
          const Component = isInternal ? Link : "a";
          return (
            <Component
              key={link.name}
              href={link.link}
              tabIndex={open ? 0 : -1}
              onClick={(e) => onNavigate(e, link)}
              className={`mobile-menu__link ${link.dev ? "is-dev" : ""}`}
              style={{ "--i": i }}
              {...(!isInternal
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
            >
              {link.name}
            </Component>
          );
        })}
      </nav>

      <div className="mobile-menu__social">
        {socialLinks.map((link, i) => {
          const isMailto = link.link.startsWith("mailto:");
          return (
            <a
              key={link.name}
              href={link.link}
              aria-label={link.name}
              tabIndex={open ? 0 : -1}
              onClick={(e) => onNavigate(e, link)}
              className="mobile-menu__social-link"
              style={{ "--i": mainLinks.length + i }}
              {...(!isMailto
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
            >
              <NavSocialIcon name={link.name} />
            </a>
          );
        })}
      </div>
    </div>
  );
}
