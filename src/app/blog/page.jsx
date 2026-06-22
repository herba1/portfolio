import { posts } from '@/app/(blog)/posts'
import BlogPostLink from './BlogPostLink'
import BlogImageFan from './BlogImageFan'

export const metadata = {
  title: 'Writing',
  description: 'Thoughts on web development, creative coding, and design.',
  alternates: {
    canonical: '/blog',
  },
  openGraph: {
    type: 'website',
    title: 'Writing',
    description: 'Thoughts on web development, creative coding, and design.',
    url: 'https://herb.art/blog',
  },
}

export default function BlogIndex() {
  const publishedPosts = posts
    .filter((post) => post.published)
    .sort((a, b) => new Date(b.date) - new Date(a.date))

  return (
    <div className="bg-slate-100 min-h-dvh">
      <main className="mx-auto max-w-3xl px-4 pt-24 pb-16 md:px-6">
        <h1
          className={`text-dark mb-8 text-4xl font-bold tracking-tighter md:text-6xl`}
        >
          {[...'Writing'].map((ch, i) => {
            const s = (v) => Math.sin(v * 127.1 + 311.7) * 43758.5453 % 1
            const order = [4, 1, 5, 0, 6, 2, 3]
            return (
              <span
                key={i}
                className="blog-ch"
                style={{
                  '--ch-d': `${(0.15 + order[i] * 0.04).toFixed(3)}s`,
                  '--ch-r': (s(i) * 16 - 8).toFixed(1),
                }}
              >
                {ch}
              </span>
            )
          })}
        </h1>
        {publishedPosts.length === 0 ? (
          <p className="text-dark/50">No posts yet. Check back soon.</p>
        ) : (
          <ul className="flex flex-col gap-6">
            {publishedPosts.map((post, i) => (
              <li
                key={post.slug}
                className="blog-list-item"
                style={{ animationDelay: `${0.2 + i * 0.08}s` }}
              >
                <BlogPostLink slug={post.slug}>
                  <article className="border-dark/10 flex items-center justify-between gap-6 border-b pb-6 transition-transform duration-300 ease-out-quart group-hover:translate-x-1">
                    <div className="min-w-0 flex-1">
                      <time className="tracking-body-base text-dark/50 text-sm">
                        {new Date(post.date).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </time>
                      <h2 className="tracking-body-base text-dark mt-1 text-xl font-semibold transition-colors group-hover:text-blue-500 md:text-2xl">
                        {post.title}
                      </h2>
                      <p className="text-dark/70 tracking-body-base mt-2">
                        {post.description}
                      </p>
                      {post.tags && (
                        <div className="mt-3 flex gap-2">
                          {post.tags.map((tag) => (
                            <span
                              key={tag}
                              className="text-dark/50 bg-dark/5 rounded px-2 py-0.5 text-xs"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <BlogImageFan images={post.images} />
                  </article>
                </BlogPostLink>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
