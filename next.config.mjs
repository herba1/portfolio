import createMDX from '@next/mdx'

/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ['js', 'jsx', 'md', 'mdx'],
  allowedDevOrigins: ['herbfrontend.ngrok.app'],
  // Vercel's CDN compresses at the edge anyway; disabling Next.js-level
  // compression avoids double-encoding and keeps Content-Length intact for
  // binary assets like .splat files (see SplatViewer.jsx for full context).
  compress: false,
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
