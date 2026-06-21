import { description, title } from './constants'

export default function manifest() {
  return {
    name: 'herb.art — Herb, design engineer',
    short_name: title,
    description,
    start_url: '/',
    display: 'standalone',
    background_color: '#f1f5f9',
    theme_color: '#f1f5f9',
    icons: [
      {
        src: '/favicon.ico',
        sizes: 'any',
        type: 'image/x-icon',
      },
    ],
  }
}
