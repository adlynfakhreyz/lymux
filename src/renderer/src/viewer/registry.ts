import type { ControlParams } from '../../../shared/control'
import { formatOf } from '../../../shared/formats'
import type { PaneView } from '../../../shared/types'
import { loadRenderer, type FileRenderer, type ViewerHost } from './renderer'

/**
 * One viewer per pane id, kept outside React like the terminal registry: splitting re-parents panes and re-mounts
 * their components, and the rendered DOM and scroll position survive that here. Adding a format needs no change here:
 * see src/shared/formats.ts and renderer.ts.
 */

export interface ViewerState {
  loading: boolean
  error: string | null
  /** The error is the size limit: the pane offers the default app instead. */
  tooLarge: boolean
  /** Renderer-provided header text (e.g. a page counter). */
  status: string
}

interface Viewer {
  view: PaneView
  /** The scroller, kept alive and moved between mounts. */
  element: HTMLDivElement
  content: HTMLDivElement
  renderer: FileRenderer | null
  state: ViewerState
  zoom: number
  scroll: { top: number; left: number }
  /** Bumped by each load, so a slow load never overwrites a newer one. */
  gen: number
  /** The latest load, for `lymux read` on a viewer that is still loading. */
  loading: Promise<void>
  listeners: Set<() => void>
  /** Set while mounted: a relative link asks the layout to show another file in this pane. */
  onNavigate: ((path: string) => void) | null
  resizeObserver: ResizeObserver
  /** When the pane last had focus, for `lymux open --reuse`. */
  focusedAt: number
}

export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 3
const ZOOM_STEP = 0.1

/** The next zoom factor after a step in or out, or 1 for a reset. */
export function stepZoom(zoom: number, delta: number | 'reset'): number {
  if (delta === 'reset') return 1
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom + delta * ZOOM_STEP)) * 100) / 100
}

const api = window.lymux
const viewers = new Map<string, Viewer>()

api.file.onChanged((path) => {
  for (const v of viewers.values()) {
    // Not loaded (missing, or failed): any change may be the file appearing, so try again.
    if (v.view.path === path && (!v.renderer || v.state.error || formatOf(v.view.kind)?.liveReload)) reload(v)
  }
})

function setState(v: Viewer, patch: Partial<ViewerState>): void {
  v.state = { ...v.state, ...patch }
  v.listeners.forEach((cb) => cb())
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

function hostFor(v: Viewer): ViewerHost {
  return {
    scroller: v.element,
    read: (path) => api.file.read(path),
    navigate: (path) => v.onNavigate?.(path),
    setStatus: (status) => setState(v, { status })
  }
}

function reload(v: Viewer): Promise<void> {
  v.loading = load(v)
  return v.loading
}

async function load(v: Viewer): Promise<void> {
  const gen = ++v.gen
  const view = v.view
  setState(v, { loading: true })
  try {
    const format = formatOf(view.kind)
    if (!format) throw new Error(`Unsupported file type: ${view.path}`)
    const info = await api.file.open(view.path)
    if (gen !== v.gen) return
    if (info.size > format.maxBytes) {
      const mb = (info.size / 1024 / 1024).toFixed(1)
      setState(v, { loading: false, error: `Too large to show here (${mb} MB).`, tooLarge: true })
      return
    }
    const [bytes, Renderer] = await Promise.all([api.file.read(view.path), loadRenderer(view.kind)])
    if (gen !== v.gen) return
    if (!v.renderer) {
      v.renderer = new Renderer(hostFor(v))
      v.renderer.mount(v.content, { path: view.path, kind: view.kind })
      v.renderer.setZoom(v.zoom)
    }
    await v.renderer.update(bytes)
    if (gen !== v.gen) return
    restoreScroll(v)
    setState(v, { loading: false, error: null, tooLarge: false })
  } catch (err) {
    if (gen === v.gen) setState(v, { loading: false, error: message(err), tooLarge: false })
  }
}

function restoreScroll(v: Viewer): void {
  if (!v.element.isConnected) return
  v.element.scrollTop = v.scroll.top
  v.element.scrollLeft = v.scroll.left
}

function create(id: string, view: PaneView): Viewer {
  const element = document.createElement('div')
  element.className = 'viewer-scroll'
  // Focusable, so arrow keys and PageDown scroll the focused viewer.
  element.tabIndex = -1
  const content = document.createElement('div')
  content.className = 'viewer-content'
  element.appendChild(content)
  const v: Viewer = {
    view,
    element,
    content,
    renderer: null,
    state: { loading: true, error: null, tooLarge: false, status: '' },
    zoom: view.zoom ?? 1,
    scroll: { top: 0, left: 0 },
    gen: 0,
    loading: Promise.resolve(),
    listeners: new Set(),
    onNavigate: null,
    resizeObserver: new ResizeObserver(() => v.renderer?.resize()),
    focusedAt: 0
  }
  // Detaching an element drops its scroll offset, so remember it while it is on screen.
  element.addEventListener('scroll', () => {
    if (element.isConnected) v.scroll = { top: element.scrollTop, left: element.scrollLeft }
  })
  v.resizeObserver.observe(element)
  viewers.set(id, v)
  api.file.watch(view.path)
  void reload(v)
  return v
}

/** The pane's viewer, created (and loading) on first use, also for panes not on screen. */
function getViewer(id: string, view: PaneView): Viewer {
  return viewers.get(id) ?? create(id, view)
}

function disposeRenderer(v: Viewer): void {
  v.renderer?.dispose()
  v.renderer = null
  v.content.replaceChildren()
}

/** Mount the viewer's DOM in `parent` and keep it showing `view` (a relative link may have changed the file). */
export function attachViewer(id: string, view: PaneView, parent: HTMLElement, onNavigate: (path: string) => void): void {
  const v = getViewer(id, view)
  v.onNavigate = onNavigate
  if (v.view.path !== view.path || v.view.kind !== view.kind) {
    api.file.unwatch(v.view.path)
    disposeRenderer(v)
    v.view = view
    v.scroll = { top: 0, left: 0 }
    setState(v, { status: '' })
    api.file.watch(view.path)
    void reload(v)
  }
  if (v.element.parentElement !== parent) parent.appendChild(v.element)
  requestAnimationFrame(() => restoreScroll(v))
}

export function detachViewer(id: string, parent: HTMLElement): void {
  const v = viewers.get(id)
  if (!v) return
  v.onNavigate = null
  if (v.element.parentElement === parent) parent.removeChild(v.element)
}

export function subscribeViewer(id: string, cb: () => void): () => void {
  const v = viewers.get(id)
  if (!v) return () => {}
  v.listeners.add(cb)
  return () => v.listeners.delete(cb)
}

const NO_STATE: ViewerState = { loading: true, error: null, tooLarge: false, status: '' }
export const viewerState = (id: string): ViewerState => viewers.get(id)?.state ?? NO_STATE

export function focusViewer(id: string): void {
  const v = viewers.get(id)
  if (!v) return
  v.focusedAt = Date.now()
  v.element.focus({ preventScroll: true })
}

/** Of these viewer panes, the one focused most recently (or the first, when none has been focused since launch). */
export function lastFocusedViewer(ids: string[]): string | undefined {
  return [...ids].sort((a, b) => (viewers.get(b)?.focusedAt ?? 0) - (viewers.get(a)?.focusedAt ?? 0))[0]
}

/** Re-read the file (reload button, `lymux reload`). */
export function reloadViewer(id: string, view: PaneView): Promise<void> {
  const v = viewers.get(id)
  return v ? reload(v) : getViewer(id, view).loading
}

/** Apply a pane's saved zoom (the layout owns it, so it is saved with the session). */
export function setViewerZoom(id: string, zoom: number): void {
  const v = viewers.get(id)
  if (!v || v.zoom === zoom) return
  v.zoom = zoom
  v.renderer?.setZoom(zoom)
}

/** The file as text for `lymux read`. Loads the viewer if the pane has not been shown yet. */
export async function readViewer(id: string, view: PaneView, params: ControlParams): Promise<string> {
  const v = getViewer(id, view)
  // A change may start a newer load while waiting; wait for the latest.
  for (let p = v.loading; ; p = v.loading) {
    await p
    if (p === v.loading) break
  }
  if (v.state.error) throw new Error(v.state.error)
  if (!v.renderer) throw new Error(`pane ${id} has not loaded its file`)
  const text = await v.renderer.text(params)
  return params.lines ? text.split('\n').slice(-params.lines).join('\n') : text
}

/** Called only when a pane is closed for good (not on re-mount). */
export function destroyViewer(id: string): void {
  const v = viewers.get(id)
  if (!v) return
  v.gen++
  api.file.unwatch(v.view.path)
  v.resizeObserver.disconnect()
  disposeRenderer(v)
  v.element.remove()
  v.listeners.clear()
  viewers.delete(id)
}
