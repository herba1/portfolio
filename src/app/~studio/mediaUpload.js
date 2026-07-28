// Shared media-drop logic for the studio's code editor and block editor.

const MEDIA_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'heic', 'heif',
  'mp4', 'webm', 'mov', 'ogg',
  'mp3', 'wav', 'aac', 'flac', 'm4a',
])

// Chrome/Finder hand HEIC over with an empty or bogus MIME type, so the
// extension is the reliable signal — check both.
export function isMediaFile(file) {
  if (!file) return false
  const type = file.type || ''
  if (type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/')) return true
  const ext = (file.name || '').split('.').pop()?.toLowerCase()
  return !!ext && MEDIA_EXTS.has(ext)
}

export function snippetForMedia(mediaType, filePath, fileName) {
  const name = fileName.replace(/\.[^.]+$/, '').replace(/-[a-z0-9]+$/, '')
  switch (mediaType) {
    case 'image': return `<BlogImage src="${filePath}" alt="${name}" caption="" />`
    case 'video': return `<Video src="${filePath}" caption="" />`
    case 'audio': return `<Audio src="${filePath}" title="${name}" caption="" />`
    default: return ''
  }
}

// Uploads one file and returns its MDX snippet, or null if it failed.
export async function uploadMedia(file) {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch('/api/studio/upload', { method: 'POST', body: formData })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data || data.error) {
    console.error('Upload failed:', data?.error || res.statusText)
    return null
  }
  return snippetForMedia(data.mediaType, data.path, data.fileName) || null
}

export function mediaFilesFrom(list) {
  return Array.from(list || []).filter(isMediaFile)
}
