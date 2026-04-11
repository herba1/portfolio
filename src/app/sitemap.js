import { posts } from './(blog)/posts'

export default function sitemap() {
  const blogEntries = posts
    .filter((post) => post.published)
    .map((post) => ({
      url: `https://herb.art/${post.slug}`,
      lastModified: new Date(post.date),
      changeFrequency: 'monthly',
      priority: 0.7,
    }))

  return [
    {
      url: 'https://herb.art',
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 1,
    },
    {
      url: 'https://herb.art/blog',
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: 'https://herb.art/experience',
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    ...blogEntries,
  ]
}
