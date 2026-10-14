// The file formats lymux can view. This list is shared by the main process (which only lets the renderer read files of
// these kinds), the CLI, and the renderer, which loads the renderer class from
// src/renderer/src/viewer/renderers/<kind>.ts the first time a file of that kind opens.
//
// Adding a format: write renderers/<kind>.ts (a default-exported FileRenderer subclass, see viewer/renderer.ts) and add
// one line below.

export interface Format {
  /** Also the renderer's file name: renderers/<kind>.ts. Saved in sessions, so never rename one. */
  kind: string
  /** Shown in the pane header: "report.pdf · PDF". */
  label: string
  /** Lower case, without the dot. */
  extensions: string[]
  /** Above this, the pane offers the default app instead of rendering. */
  maxBytes: number
  /** Re-render when the file changes on disk. */
  liveReload: boolean
}

const MB = 1024 * 1024

export const FORMATS: Format[] = [
  { kind: 'markdown', label: 'Markdown', extensions: ['md', 'markdown'], maxBytes: 25 * MB, liveReload: true },
  { kind: 'pdf', label: 'PDF', extensions: ['pdf'], maxBytes: 50 * MB, liveReload: true },
  { kind: 'sheet', label: 'Spreadsheet', extensions: ['xlsx', 'xls', 'ods', 'csv', 'tsv'], maxBytes: 25 * MB, liveReload: true },
  { kind: 'image', label: 'Image', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'], maxBytes: 25 * MB, liveReload: true }
]

export const extname = (path: string): string => {
  const m = (path.split('/').pop() ?? '').match(/\.([^.]+)$/)
  return m ? m[1].toLowerCase() : ''
}

export const formatOf = (kind: string): Format | undefined => FORMATS.find((f) => f.kind === kind)

/** The format a path's extension says it is. */
export const formatFor = (path: string): Format | undefined => {
  const ext = extname(path)
  return FORMATS.find((f) => f.extensions.includes(ext))
}

/** ".md, .pdf, ..." for error messages and help. */
export const supportedExtensions = (): string => FORMATS.flatMap((f) => f.extensions.map((e) => '.' + e)).join(' ')
