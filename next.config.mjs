import createMDX from '@next/mdx'

/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ['js', 'jsx', 'md', 'mdx'],
  compress: false, // Vercel CDN handles compression; disabling avoids stripping Content-Length
  experimental: {
    viewTransition: true,
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
