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
  async headers() {
    return [
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
