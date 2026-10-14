// POSIX path helpers and image types shared by the main process, the CLI and the renderer (which has no node:path).

/** MIME types for images: blobs need one for SVG to render, and Markdown may show these from its folder. */
export const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml'
}
export const IMAGE_LIMIT = 25 * 1024 * 1024

export const basename = (path: string): string => path.replace(/\/+$/, '').split('/').pop() ?? ''

export const dirname = (path: string): string => {
  const i = path.replace(/\/+$/, '').lastIndexOf('/')
  return i > 0 ? path.slice(0, i) : '/'
}

/** Resolve `rel` against directory `base` (both POSIX), folding `.` and `..`. */
export function resolvePath(base: string, rel: string): string {
  const parts: string[] = []
  for (const part of (rel.startsWith('/') ? rel : `${base}/${rel}`).split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  return '/' + parts.join('/')
}

/** `~/x` for paths under home, for messages and titles. */
export const tildify = (path: string, home: string): string =>
  home && home !== '/' && (path === home || path.startsWith(home + '/')) ? '~' + path.slice(home.length) : path
