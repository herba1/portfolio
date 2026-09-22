import { ViewTransition } from "react";
import { LenisProvider } from "@/context/LenisContext";
import PostHogProvider from "@/context/PostHogProvider";
import Navbar from "./ui/Navigation/Navbar";
import { MobileMenuProvider } from "./ui/Navigation/MobileMenuContext";
import MobileMenuShell from "./ui/Navigation/MobileMenuShell";
import DevPalette from "./ui/Navigation/DevPalette";
import TypeInspector from "./ui/TypeInspector";
import ZenMode from "./ui/ZenMode";

import StickyFooter from "./ui/StickyFooter";
import { geist, inter, mono } from "./fonts";
import Loading from "./ui/Loading";
import {
  author,
  defaultTitle,
  description,
  profiles,
  siteUrl,
  title,
  xHandle,
} from "./constants";
import { FEEDS } from "@/lib/seo";
import { JsonLd, siteGraph } from "@/lib/jsonld";
import ConsoleSig from "./ui/ConsoleSig";
import FooterClock from "./ui/FooterClock";
import AnimatedFavicon from "./ui/AnimatedFavicon";
import ReactScan from "./ui/ReactScan";
// Emoji intro splash disabled — re-enable by restoring this import and the
// <IntroSplash /> mount in the body below. Component files are still in ./ui.
// import IntroSplash from "./ui/IntroSplash";

// Site-wide defaults. Routes override these through lib/seo.js#pageMetadata,
// which carries a full card per page — a page-level `openGraph`, `twitter`
// or `alternates` replaces the block here rather than merging into it.
export const metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: defaultTitle,
    template: `%s | ${title}`,
  },
  description,
  applicationName: title,
  keywords: [
    "Herbart Hernandez",
    "Herb",
    "herb.art",
    "design engineer",
    "CrowdVolt",
    "New York",
    "portfolio",
    "creative developer",
    "front-end engineer",
    "interaction design",
    "motion design",
    "typography",
    "React",
    "Next.js",
    "Three.js",
    "WebGL",
    "shaders",
    "Gaussian splatting",
    "interactive experiments",
  ],
  authors: [{ name: author, url: siteUrl }],
  creator: author,
  publisher: author,
  category: "technology",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  alternates: {
    canonical: "./",
    types: FEEDS,
  },
  // No title/description/url here on purpose: Next back-fills a card from a
  // page's own title and description only when the root leaves those absent,
  // so a route that sets just `title` still gets its own card, never the
  // home page's. Routes using lib/seo.js carry a complete card regardless.
  openGraph: {
    siteName: title,
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    site: xHandle,
    creator: xHandle,
  },
  appleWebApp: {
    capable: true,
    title,
    statusBarStyle: "default",
  },
  // Snippet limits on the generic tag as well as Google's, so Bing/Copilot
  // and the AI engines that read the generic tag get them too. Never add
  // `noarchive` or `nocache` here: Bing has no robots.txt training token
  // and reads those two to drop a site from Copilot answers instead.
  robots: {
    index: true,
    follow: true,
    "max-video-preview": -1,
    "max-image-preview": "large",
    "max-snippet": -1,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  // Search Console / Bing Webmaster ownership tags, only when the tokens are
  // set in the environment (Vercel project settings). Nothing renders otherwise.
  verification: {
    ...(process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
      ? { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION }
      : {}),
    ...(process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION
      ? { other: { "msvalidate.01": process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION } }
      : {}),
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-visual",
  // `--neutral-50`, the page surface — the same literal the manifest carries.
  themeColor: "#f1f5f9",
  colorScheme: "light",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${mono.variable} ${inter.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Geist Sans + Geist Mono are self-hosted by next/font at build
            time — no third-party font host, no preconnect, no FOUT. */}
        {/* Splat loads on scroll via dynamic import — no prefetch needed */}
        {/* WebSite + Person + Organization, once. Pages add their own nodes
            and point back at these by @id (see lib/jsonld.js). */}
        <JsonLd data={siteGraph()} />
        {/* rel="me": the IndieWeb/Mastodon way of saying these profiles and
            this site are the same person. Cheap, and it lets identity
            verification (and anyone reconciling entities) tie them together. */}
        {profiles.map((href) => (
          <link key={href} rel="me" href={href} />
        ))}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(sessionStorage.getItem("herb:chrome-hidden")==="1")document.documentElement.dataset.chrome="off"}catch(e){}`,
          }}
        />
      </head>
      {/* No global `tracking-*` here — a single letter-spacing value cannot be
          correct at more than one size. The type scale sets tracking per size;
          the inherited default for untagged text is set on `body` in globals.css. */}
      <body className="relative overflow-x-hidden overscroll-none bg-surface antialiased">
        <ReactScan />
        <AnimatedFavicon />
        <ConsoleSig />
        <PostHogProvider>
          <LenisProvider>
            <MobileMenuProvider>
              <Navbar
                className="text-ink z-[var(--z-index-nav)] font-medium"
                phoneVisible={false}
                ctaVisible={false}
              />
              <MobileMenuShell>
                <ViewTransition name="page-content">
                  {children}
                </ViewTransition>
              </MobileMenuShell>
              <ZenMode />
            </MobileMenuProvider>
            {/* <Loading>
              <div className="relative z-0">
                <Navbar
                  className="text-ink sm:text-light z-[var(--z-index-nav)] font-medium sm:font-normal sm:mix-blend-difference"
                  phoneVisible={false}
                  ctaVisible={false}
                ></Navbar>
                {children}
              </div>
            </Loading> */}
          </LenisProvider>
        </PostHogProvider>
        <FooterClock />
        <DevPalette />
        <TypeInspector />
      </body>
    </html>
  );
}
