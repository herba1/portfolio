import { ViewTransition } from "react";
import { LenisProvider } from "@/context/LenisContext";
import PostHogProvider from "@/context/PostHogProvider";
import Navbar from "./ui/Navigation/Navbar";

import StickyFooter from "./ui/StickyFooter";
import { geist } from "./fonts";
import Loading from "./ui/Loading";
import { description, title } from "./constants";
import ConsoleSig from "./ui/ConsoleSig";
import FooterClock from "./ui/FooterClock";
import AnimatedFavicon from "./ui/AnimatedFavicon";

export const metadata = {
  metadataBase: new URL("https://herb.art"),
  title: {
    default: title,
    template: `%s | ${title}`,
  },
  description: description,
  keywords: [
    "portfolio",
    "design engineer",
    "creative developer",
    "web developer",
    "frontend",
    "fullstack",
    "javascript",
    "react",
    "nextjs",
    "three.js",
    "interactive",
  ],
  authors: [{ name: "Herb" }],
  creator: "Herb",
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
    },
    {
      "@type": "Person",
      "@id": "https://herb.art/#person",
      name: "Herb",
      url: "https://herb.art",
      jobTitle: "Design Engineer",
      sameAs: [
        "https://github.com/herba1",
      ],
    },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="prefetch" href="/splats/herb-scan-clean.splat" as="fetch" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="relative overflow-x-hidden overscroll-none bg-slate-100 tracking-tight antialiased">
        <AnimatedFavicon />
        <ConsoleSig />
        <PostHogProvider>
          <LenisProvider>
            <Navbar
              className="text-dark z-50 font-medium"
              phoneVisible={false}
              ctaVisible={false}
            />
            <ViewTransition name="page-content">
              {children}
            </ViewTransition>
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
