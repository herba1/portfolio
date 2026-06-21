export default function robots() {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/_next/", "/~studio"],
      },
    ],
    sitemap: "https://herb.art/sitemap.xml",
  };
}
