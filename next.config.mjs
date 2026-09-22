import createMDX from '@next/mdx'

/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ['js', 'jsx', 'md', 'mdx'],
  allowedDevOrigins: ['herbfrontend.ngrok.app'],
  // Vercel's CDN compresses at the edge anyway; disabling Next.js-level
  // compression avoids double-encoding and keeps Content-Length intact for
  // binary assets like .splat files (see SplatViewer.jsx for full context).
  compress: false,
  // heic-convert pulls in a large wasm build of libheif — keep it out of the
  // bundle and let Node require it at runtime (studio upload route only).
  serverExternalPackages: ['heic-convert'],
  images: {
    // Spotify serves album art from i.scdn.co and artist portraits from either
    // that or the newer image-cdn-*.spotifycdn.com hosts, depending on when the
    // image was uploaded. next/image refuses any host it hasn't been told about.
    remotePatterns: [
      { protocol: 'https', hostname: 'i.scdn.co' },
      { protocol: 'https', hostname: '**.spotifycdn.com' },
    ],
  },
  experimental: {
    viewTransition: true,
    optimizePackageImports: ['lucide-react', 'motion', 'gsap'],
  },
  // Crawlers that get their <head> metadata blocking instead of streamed.
  // Setting this REPLACES Next's default list, so the default (Google, Bing,
  // the social unfurlers…) is repeated here, then the AI crawlers and
  // fetchers are added: none of them run JavaScript, and several read only
  // what is inside <head> when the response first arrives.
  htmlLimitedBots:
    /[\w-]+-Google|Google-[\w-]+|Chrome-Lighthouse|Slurp|DuckDuckBot|baiduspider|yandex|sogou|bitlybot|tumblr|vkShare|quora link preview|redditbot|ia_archiver|Bingbot|BingPreview|applebot|facebookexternalhit|facebookcatalog|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|SkypeUriPreview|Yeti|googleweblight|GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-SearchBot|Claude-User|PerplexityBot|Perplexity-User|DuckAssistBot|Amazonbot|Amzn-SearchBot|Amzn-User|CCBot|MistralAI|Meta-External|Meta-WebIndexer|YouBot|Bluesky|Mastodon|Telegram/i,
  async headers() {
    return [
      {
        // Card scans are content-addressed by hand (card-01…12) and never
        // change in place, so they can be cached for good. Without this the
        // browser revalidates every one of them on a repeat visit.
        source: '/psa/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/splats/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ]
  },
}

const withMDX = createMDX({
  options: {
    remarkPlugins: ['remark-gfm'],
    rehypePlugins: [
      ['rehype-pretty-code', { theme: 'github-dark', keepBackground: true }],
    ],
  },
})

export default withMDX(nextConfig)
