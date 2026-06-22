import { ViewTransition } from "react";
import { LenisProvider } from "@/context/LenisContext";
import PostHogProvider from "@/context/PostHogProvider";
import Navbar from "./ui/Navigation/Navbar";
import { MobileMenuProvider } from "./ui/Navigation/MobileMenuContext";
import MobileMenuShell from "./ui/Navigation/MobileMenuShell";

import StickyFooter from "./ui/StickyFooter";
import { geist } from "./fonts";
import Loading from "./ui/Loading";
import { author, description, title } from "./constants";
import ConsoleSig from "./ui/ConsoleSig";
import FooterClock from "./ui/FooterClock";
import AnimatedFavicon from "./ui/AnimatedFavicon";
import IntroSplash from "./ui/IntroSplash";

export const metadata = {
  metadataBase: new URL("https://herb.art"),
  title: {
    default: title,
    template: `%s | ${title}`,
  },
  description: description,
  applicationName: "herb.art",
  keywords: [
    "Herb",
    "portfolio",
    "design engineer",
    "creative developer",
    "creative technologist",
    "web developer",
    "frontend",
    "fullstack",
    "javascript",
    "react",
    "nextjs",
    "three.js",
    "webgl",
    "gaussian splatting",
    "interactive",
    "motion design",
  ],
  authors: [{ name: author, url: "https://herb.art" }],
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
  },
  openGraph: {
    title: title,
    description: description,
    url: "https://herb.art",
    siteName: "herb.art",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: title,
    description: description,
    site: "@herb_dev",
    creator: "@herb_dev",
  },
  appleWebApp: {
    capable: true,
    title: "herb.art",
    statusBarStyle: "default",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-visual",
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": "https://herb.art/#website",
      url: "https://herb.art",
      name: "herb.art",
      description: description,
      inLanguage: "en-US",
      publisher: { "@id": "https://herb.art/#person" },
    },
    {
      "@type": "Person",
      "@id": "https://herb.art/#person",
      name: author,
      url: "https://herb.art",
      image: "https://herb.art/opengraph-image.png",
      jobTitle: "Design Engineer",
      description: description,
      knowsAbout: [
        "Web Development",
        "Creative Coding",
        "Design Engineering",
        "React",
        "Next.js",
        "Three.js",
        "WebGL",
        "Motion Design",
      ],
      email: "mailto:hi@herb.art",
      sameAs: [
        "https://github.com/herba1",
        "https://x.com/herb_dev",
        "https://linkedin.com/in/herbart-hernandez",
      ],
    },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${geist.variable}`}>
      <head>
        {/* Adobe Fonts (Typekit). Preconnect warms the CSS host + the font
            host (p.typekit.net serves the actual woff2 via CORS). The
            `precedence` prop opts the stylesheet into React's resource
            manager so Next preloads, hoists, and dedupes it. */}
        <link rel="preconnect" href="https://use.typekit.net" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://p.typekit.net" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://use.typekit.net/psc2klr.css" precedence="default" />
        {/* Splat loads on scroll via dynamic import — no prefetch needed */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="relative overflow-x-hidden overscroll-none bg-slate-100 tracking-tight antialiased">
        <AnimatedFavicon />
        <ConsoleSig />
        <IntroSplash />
        <PostHogProvider>
          <LenisProvider>
            <MobileMenuProvider>
              <Navbar
                className="text-dark z-50 font-medium"
                phoneVisible={false}
                ctaVisible={false}
              />
              <MobileMenuShell>
                <ViewTransition name="page-content">
                  {children}
                </ViewTransition>
              </MobileMenuShell>
            </MobileMenuProvider>
            {/* <Loading>
              <div className="relative z-0">
                <Navbar
                  className="text-dark sm:text-light z-50 font-medium sm:font-normal sm:mix-blend-difference"
                  phoneVisible={false}
                  ctaVisible={false}
                ></Navbar>
                {children}
              </div>
            </Loading> */}
          </LenisProvider>
        </PostHogProvider>
        <FooterClock />
      </body>
    </html>
  );
}
