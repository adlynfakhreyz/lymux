import { watch, type FSWatcher } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, resolve, sep } from 'node:path'
import { shell, type WebContents } from 'electron'
import { IMAGE_LIMIT, IMAGE_TYPES, tildify } from '../shared/files'
import { extname, formatFor, supportedExtensions } from '../shared/formats'
import type { FileInfo } from '../shared/types'

// Read-only file access for viewer panes. The renderer may only read files it opened through `open` (a supported
// format, checked here), plus images inside the folder of an opened Markdown file, so a compromised page cannot read
// ~/.ssh. Every format can be watched; whether a change re-renders is the format's liveReload.

const CHANGE_DEBOUNCE_MS = 200

const opened = new Set<string>()
/** Real paths of folders holding an opened Markdown file: its images may be read. */
const markdownDirs = new Set<string>()

const show = (path: string): string => tildify(path, homedir())

/** Validate and allow a file. Errors carry a message meant for the pane and the CLI. */
export async function openFile(path: string): Promise<FileInfo> {
  const abs = resolve(path)
  const format = formatFor(abs)
  if (!format) throw new Error(`Unsupported file type: ${show(abs)} (lymux views ${supportedExtensions()})`)
  let st
  try {
    st = await stat(abs)
  } catch {
    throw new Error(`File not found: ${show(abs)}`)
  }
  if (!st.isFile()) throw new Error(`Not a file: ${show(abs)}`)
  opened.add(abs)
  if (format.kind === 'markdown') markdownDirs.add(await realpath(dirname(abs)))
  return { path: abs, kind: format.kind, size: st.size, mtime: st.mtimeMs }
}

async function imageAllowed(abs: string): Promise<boolean> {
  if (!IMAGE_TYPES[extname(abs)]) return false
  const real = await realpath(abs)
  return [...markdownDirs].some((dir) => real.startsWith(dir === sep ? dir : dir + sep))
}

export async function readAllowed(path: string): Promise<Buffer> {
  const abs = resolve(path)
  const format = formatFor(abs)
  const allowed = opened.has(abs) || (await imageAllowed(abs).catch(() => false))
  if (!allowed) throw new Error(`Not allowed to read ${show(abs)}`)
  let st
  try {
    st = await stat(abs)
  } catch {
    throw new Error(`File not found: ${show(abs)}`)
  }
  if (st.size > (format && opened.has(abs) ? format.maxBytes : IMAGE_LIMIT)) throw new Error(`Too large to show: ${show(abs)}`)
  return readFile(abs)
}

export async function openExternal(path: string): Promise<void> {
  const abs = resolve(path)
  if (!opened.has(abs)) throw new Error(`Not allowed to open ${show(abs)}`)
  const error = await shell.openPath(abs)
  if (error) throw new Error(error)
}

export async function openLink(url: string): Promise<void> {
  if (/^https?:\/\//i.test(url)) await shell.openExternal(url)
}

interface Watch {
  watcher: FSWatcher | null
  count: number
  timer?: NodeJS.Timeout
}
const watches = new Map<string, Watch>()

/**
 * Watch the file's folder rather than the file: editors and agents often write a new file and rename it over the old
 * one, which ends a watch on the old inode. It also notices a missing file appearing.
 */
export function watchFile(path: string, target: () => WebContents | null): void {
  const abs = resolve(path)
  const existing = watches.get(abs)
  if (existing) {
    existing.count++
    return
  }
  const w: Watch = { watcher: null, count: 1 }
  watches.set(abs, w)
  try {
    w.watcher = watch(dirname(abs), (_event, name) => {
      if (name !== basename(abs)) return
      clearTimeout(w.timer)
      w.timer = setTimeout(() => target()?.send('file:changed', abs), CHANGE_DEBOUNCE_MS)
    })
    w.watcher.on('error', () => w.watcher?.close())
  } catch {
    // The folder is gone too; reload from the pane still works.
  }
}

export function unwatchFile(path: string): void {
  const abs = resolve(path)
  const w = watches.get(abs)
  if (!w || --w.count > 0) return
  clearTimeout(w.timer)
  w.watcher?.close()
  watches.delete(abs)
}

export function unwatchAll(): void {
  for (const path of [...watches.keys()]) {
    const w = watches.get(path)
    if (w) w.count = 1
    unwatchFile(path)
  }
}
