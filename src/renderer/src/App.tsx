import { useCallback, useEffect, useRef, useState } from 'react'
import type { PaneMeta, Session, SplitDir, UiSettings, Workspace } from '../../shared/types'
import { createControlHandler } from './control'
import { Sidebar } from './components/Sidebar'
import { SplitView } from './components/SplitView'
import { destroyPane, setFontSize } from './terminal/registry'
import {
  listPanes,
  movePane,
  newPane,
  newSession,
  newWorkspace,
  removePane,
  setPaneCwds,
  setSizes,
  splitPane
} from './state/layout'

const api = window.lymux
const META_POLL_MS = 2000
const SAVE_DEBOUNCE_MS = 1000

const DEFAULT_UI: UiSettings = { fontSize: 13, sidebarWidth: 248, sidebarMode: 'pinned', sidebarOpen: true }
const FONT_MIN = 8
const FONT_MAX = 32
const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 480
/** Hover mode: how long the pointer may leave the sidebar before it slides away. */
const PEEK_HIDE_MS = 250
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

export function App(): React.JSX.Element | null {
  const [session, setSession] = useState<Session | null>(null)
  const [meta, setMeta] = useState<Record<string, PaneMeta>>({})
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [peek, setPeek] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const peekTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const sessionRef = useRef(session)
  sessionRef.current = session

  // Restore the last session, or start fresh in ~.
  useEffect(() => {
    void api.session.load().then((s) => setSession(s ?? newSession(api.homeDir)))
  }, [])

  // Persist (debounced) whenever the layout changes.
  useEffect(() => {
    if (!session) return
    const t = setTimeout(() => void api.session.save(session), SAVE_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [session])

  // Poll each pane's cwd and git branch; write cwds back into the layout so a restore reopens them in place.
  useEffect(() => {
    const tick = async (): Promise<void> => {
      const s = sessionRef.current
      if (!s) return
      const ids = s.workspaces.flatMap((w) => listPanes(w.root).map((p) => p.id))
      const m = await api.meta(ids)
      setMeta(m)
      const changed = s.workspaces.some((w) => listPanes(w.root).some((p) => m[p.id]?.cwd && m[p.id].cwd !== p.cwd))
      if (changed) {
        const cwds = Object.fromEntries(Object.entries(m).map(([id, v]) => [id, v.cwd]))
        setSession((cur) => cur && { ...cur, workspaces: cur.workspaces.map((w) => ({ ...w, root: setPaneCwds(w.root, cwds) })) })
      }
    }
    const t = setInterval(() => void tick(), META_POLL_MS)
    return () => clearInterval(t)
  }, [])

  // Agents and scripts drive the app over the control socket (lymux CLI, MCP server). Edits land in sessionRef at once
  // so back-to-back requests build on each other, and go through setSession so they compose with UI edits.
  useEffect(
    () =>
      api.control.serve(
        createControlHandler({
          session: () => sessionRef.current,
          apply: (fn) => {
            if (sessionRef.current) sessionRef.current = fn(sessionRef.current)
            setSession((cur) => cur && fn(cur))
          },
          homeDir: api.homeDir
        })
      ),
    []
  )

  const updateWorkspace = useCallback((id: string, fn: (w: Workspace) => Workspace) => {
    setSession((s) => s && { ...s, workspaces: s.workspaces.map((w) => (w.id === id ? fn(w) : w)) })
  }, [])

  const active = session?.workspaces.find((w) => w.id === session.activeWorkspaceId)
  const ui: UiSettings = { ...DEFAULT_UI, ...session?.ui }
  // Latest settings, updated immediately on each change: repeated key presses before a re-render must build on each other.
  const uiRef = useRef(ui)
  uiRef.current = ui

  const setUi = useCallback((patch: Partial<UiSettings>) => {
    setSession((s) => s && { ...s, ui: { ...DEFAULT_UI, ...s.ui, ...patch } })
  }, [])

  // Apply the saved/changed font size to every terminal.
  useEffect(() => setFontSize(ui.fontSize), [ui.fontSize])

  /** Brief, unobtrusive indicator in the corner (zoom level). */
  const flash = (text: string): void => {
    clearTimeout(toastTimer.current)
    setToast(text)
    toastTimer.current = setTimeout(() => setToast(null), 1200)
  }


  const zoom = (delta: number | 'reset'): void => {
    const fontSize = delta === 'reset' ? DEFAULT_UI.fontSize : clamp(uiRef.current.fontSize + delta, FONT_MIN, FONT_MAX)
    uiRef.current = { ...uiRef.current, fontSize }
    setUi({ fontSize })
    flash(`Font ${fontSize}`)
  }

  const showPeek = (): void => {
    clearTimeout(peekTimer.current)
    setPeek(true)
  }
  const hidePeekSoon = (): void => {
    clearTimeout(peekTimer.current)
    peekTimer.current = setTimeout(() => setPeek(false), PEEK_HIDE_MS)
  }

  const toggleSidebar = (): void => {
    if (ui.sidebarMode === 'hover') setPeek((p) => !p)
    else setUi({ sidebarOpen: !ui.sidebarOpen })
  }

  const toggleSidebarMode = (): void => {
    setPeek(false)
    setUi(ui.sidebarMode === 'pinned' ? { sidebarMode: 'hover' } : { sidebarMode: 'pinned', sidebarOpen: true })
  }

  // Drag the sidebar's right edge to resize it.
  const startSidebarResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = ui.sidebarWidth
    document.body.classList.add('resizing-sidebar')
    const onMove = (ev: MouseEvent): void => setUi({ sidebarWidth: clamp(startWidth + ev.clientX - startX, SIDEBAR_MIN, SIDEBAR_MAX) })
    const onUp = (): void => {
      document.body.classList.remove('resizing-sidebar')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const activeCwd = async (): Promise<string> => {
    if (!active) return api.homeDir
    const m = await api.meta([active.activePaneId])
    return m[active.activePaneId]?.cwd ?? api.homeDir
  }

  const split = async (dir: SplitDir): Promise<void> => {
    if (!active) return
    const pane = newPane(await activeCwd())
    updateWorkspace(active.id, (w) => ({ ...w, root: splitPane(w.root, w.activePaneId, dir, pane), activePaneId: pane.id }))
  }

  const closeWorkspace = (id: string): void => {
    setSession((s) => {
      if (!s) return s
      const ws = s.workspaces.find((w) => w.id === id)
      ws && listPanes(ws.root).forEach((p) => destroyPane(p.id))
      const rest = s.workspaces.filter((w) => w.id !== id)
      if (rest.length === 0) return newSession(api.homeDir)
      const activeWorkspaceId = s.activeWorkspaceId === id ? rest[0].id : s.activeWorkspaceId
      return { ...s, workspaces: rest, activeWorkspaceId }
    })
  }

  const closePane = (id = active?.activePaneId): void => {
    if (!active || !id) return
    const root = removePane(active.root, id)
    destroyPane(id)
    if (!root) return closeWorkspace(active.id)
    updateWorkspace(active.id, (w) => ({
      ...w,
      root,
      activePaneId: w.activePaneId === id ? listPanes(root)[0].id : w.activePaneId
    }))
  }

  const titleOf = (paneId: string, cwd?: string): string => {
    const dir = meta[paneId]?.cwd ?? cwd ?? ''
    const name = dir === api.homeDir ? '~' : dir.split('/').pop() || '/'
    const branch = meta[paneId]?.branch
    return branch ? `${name}  ⎇ ${branch}` : name
  }

  const addWorkspace = async (): Promise<void> => {
    const ws = newWorkspace(`workspace ${(session?.workspaces.length ?? 0) + 1}`, await activeCwd())
    setSession((s) => s && { ...s, workspaces: [...s.workspaces, ws], activeWorkspaceId: ws.id })
  }

  const reorderWorkspace = (id: string, beforeId: string | null): void => {
    if (id === beforeId) return
    setSession((s) => {
      if (!s) return s
      const moved = s.workspaces.find((w) => w.id === id)
      if (!moved) return s
      const rest = s.workspaces.filter((w) => w.id !== id)
      const i = beforeId ? rest.findIndex((w) => w.id === beforeId) : rest.length
      return { ...s, workspaces: [...rest.slice(0, i), moved, ...rest.slice(i)] }
    })
  }

  const cycleWorkspace = (step: number): void => {
    setSession((s) => {
      if (!s) return s
      const i = s.workspaces.findIndex((w) => w.id === s.activeWorkspaceId)
      const next = s.workspaces[(i + step + s.workspaces.length) % s.workspaces.length]
      return { ...s, activeWorkspaceId: next.id }
    })
  }

  // App shortcuts are caught in the capture phase, before the focused terminal sees the key.
  const draggingRef = useRef(draggingId)
  draggingRef.current = draggingId
  const handlers = useRef({ split, closePane, addWorkspace, cycleWorkspace, zoom, toggleSidebar })
  handlers.current = { split, closePane, addWorkspace, cycleWorkspace, zoom, toggleSidebar }
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const h = handlers.current
      let handled = true
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyD') void h.split('row')
      else if (e.ctrlKey && e.shiftKey && e.code === 'KeyE') void h.split('column')
      else if (e.ctrlKey && e.shiftKey && e.code === 'KeyW') h.closePane()
      else if (e.code === 'Escape' && draggingRef.current) setDraggingId(null)
      else if (e.ctrlKey && e.shiftKey && e.code === 'KeyN') void h.addWorkspace()
      else if (e.ctrlKey && e.code === 'PageDown') h.cycleWorkspace(1)
      else if (e.ctrlKey && e.code === 'PageUp') h.cycleWorkspace(-1)
      else if (e.ctrlKey && e.shiftKey && e.code === 'KeyB') h.toggleSidebar()
      else if (e.ctrlKey && (e.code === 'Equal' || e.code === 'NumpadAdd')) h.zoom(1)
      else if (e.ctrlKey && (e.code === 'Minus' || e.code === 'NumpadSubtract')) h.zoom(-1)
      else if (e.ctrlKey && (e.code === 'Digit0' || e.code === 'Numpad0')) h.zoom('reset')
      else handled = false
      if (handled) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    // Ctrl+scroll zooms too, instead of scrolling the terminal.
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey || e.deltaY === 0) return
      e.preventDefault()
      e.stopPropagation()
      handlers.current.zoom(e.deltaY < 0 ? 1 : -1)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('wheel', onWheel, true)
    }
  }, [])

  if (!session || !active) return null

  return (
    <div className="app">
      {ui.sidebarMode === 'hover' && <div className="sidebar-hover-zone" onMouseEnter={showPeek} />}
      {ui.sidebarMode === 'pinned' && !ui.sidebarOpen ? (
        <div className="sidebar-rail">
          <button className="icon-button" title="Open sidebar (Ctrl+Shift+B)" onClick={() => setUi({ sidebarOpen: true })}>
            »
          </button>
        </div>
      ) : (
        <Sidebar
          workspaces={session.workspaces}
          activeId={active.id}
          meta={meta}
          homeDir={api.homeDir}
          width={ui.sidebarWidth}
          mode={ui.sidebarMode}
          peek={peek}
          onSelect={(id) => setSession({ ...session, activeWorkspaceId: id })}
          onNew={() => void addWorkspace()}
          onRename={(id, name) => updateWorkspace(id, (w) => ({ ...w, name }))}
          onClose={closeWorkspace}
          onReorder={reorderWorkspace}
          onToggleMode={toggleSidebarMode}
          onCollapse={() => setUi({ sidebarOpen: false })}
          onResizeStart={startSidebarResize}
          onMouseEnter={() => ui.sidebarMode === 'hover' && showPeek()}
          onMouseLeave={() => ui.sidebarMode === 'hover' && !document.body.classList.contains('resizing-sidebar') && hidePeekSoon()}
        />
      )}
      {toast && <div className="zoom-toast">{toast}</div>}
      <main className="workspace-view" key={active.id}>
        <SplitView
          node={active.root}
          activePaneId={active.activePaneId}
          draggingId={draggingId}
          titleOf={titleOf}
          onFocusPane={(id) => updateWorkspace(active.id, (w) => ({ ...w, activePaneId: id }))}
          onClosePane={(id) => closePane(id)}
          onResize={(splitId, sizes) => updateWorkspace(active.id, (w) => ({ ...w, root: setSizes(w.root, splitId, sizes) }))}
          onDragStart={setDraggingId}
          onDragEnd={() => setDraggingId(null)}
          onMovePane={(srcId, targetId, edge) => {
            setDraggingId(null)
            updateWorkspace(active.id, (w) => ({ ...w, root: movePane(w.root, srcId, targetId, edge), activePaneId: srcId }))
          }}
        />
      </main>
    </div>
  )
}
