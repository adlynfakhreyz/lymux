import { useState } from 'react'
import type { PaneMeta, SidebarMode, Workspace } from '../../../shared/types'
import logo from '../assets/logo.png'

interface Props {
  workspaces: Workspace[]
  activeId: string
  meta: Record<string, PaneMeta>
  /** Per workspace: the commands running in its panes. */
  busy: Record<string, string[]>
  /** Workspaces with a notification not looked at yet. */
  attention: Set<string>
  sound: boolean
  onToggleSound: () => void
  homeDir: string
  width: number
  mode: SidebarMode
  /** Hover mode: whether the sidebar is currently slid out. */
  peek: boolean
  onSelect: (id: string) => void
  onNew: () => void
  onRename: (id: string, name: string) => void
  onClose: (id: string) => void
  /** Move workspace `id` so it lands before `beforeId` (or at the end when null). */
  onReorder: (id: string, beforeId: string | null) => void
  onToggleMode: () => void
  onCollapse: () => void
  onResizeStart: (e: React.MouseEvent) => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}

// Keys shown as keycaps in the sidebar footer.
const SHORTCUTS: [string[], string][] = [
  [['Ctrl+Shift', 'D'], 'Split right'],
  [['Ctrl+Shift', 'E'], 'Split down'],
  [['Ctrl+Shift', 'W'], 'Close pane'],
  [['Ctrl+Shift', 'N'], 'New workspace'],
  [['Ctrl', 'PgUp/Dn'], 'Switch workspace'],
  [['Ctrl+Shift', 'B'], 'Toggle sidebar'],
  [['Ctrl', '+ / −'], 'Zoom']
]

const shortPath = (path: string | null | undefined, home: string): string =>
  !path ? '' : path === home ? '~' : path.startsWith(home + '/') ? '~' + path.slice(home.length) : path

const BellIcon = ({ on }: { on: boolean }): React.JSX.Element => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
    <path d="M10 21h4" />
    {!on && <path d="M4 4l16 16" />}
  </svg>
)

const PinIcon = ({ pinned }: { pinned: boolean }): React.JSX.Element => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
    <path d="M9 4h6l-1 6 4 4H6l4-4-1-6z" strokeLinejoin="round" />
    <path d="M12 14v7" strokeLinecap="round" />
  </svg>
)

const CollapseIcon = (): React.JSX.Element => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 6l-6 6 6 6M19 6l-6 6 6 6" />
  </svg>
)

export function Sidebar(props: Props): React.JSX.Element {
  const { workspaces, activeId, meta, homeDir, width, mode, peek } = props
  const [editing, setEditing] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  // Where the dragged workspace would land: above or below this one.
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null)

  const endDrag = (): void => {
    setDragId(null)
    setDrop(null)
  }
  const floating = mode === 'hover'

  return (
    <aside
      className={`sidebar${floating ? ' sidebar-floating' : ''}${floating && peek ? ' sidebar-peek' : ''}`}
      style={{ width }}
      onMouseEnter={props.onMouseEnter}
      onMouseLeave={props.onMouseLeave}
    >
      <div className="sidebar-header">
        <img className="sidebar-logo" src={logo} alt="" />
        <span className="sidebar-title">lymux</span>
        <button
          className="icon-button sidebar-pin"
          title={floating ? 'Pin sidebar (always visible)' : 'Auto-hide: open on hover at the left edge'}
          onClick={props.onToggleMode}
        >
          <PinIcon pinned={!floating} />
        </button>
        <button
          className={`icon-button sidebar-sound${props.sound ? '' : ' icon-button-off'}`}
          title={props.sound ? 'Notification sound on (click to mute)' : 'Notification sound muted (click to turn on)'}
          onClick={props.onToggleSound}
        >
          <BellIcon on={props.sound} />
        </button>
        {!floating && (
          <button className="icon-button sidebar-collapse" title="Close sidebar (Ctrl+Shift+B)" onClick={props.onCollapse}>
            <CollapseIcon />
          </button>
        )}
      </div>
      <ul className="workspace-list">
        {workspaces.map((ws) => {
          const m = meta[ws.activePaneId]
          const busy = props.busy[ws.id] ?? []
          return (
            <li
              key={ws.id}
              className={
                `workspace${ws.id === activeId ? ' workspace-active' : ''}` +
                (ws.id === dragId ? ' workspace-dragging' : '') +
                (drop?.id === ws.id ? (drop.after ? ' workspace-drop-after' : ' workspace-drop-before') : '')
              }
              draggable={editing !== ws.id}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', ws.id)
                setDragId(ws.id)
              }}
              onDragOver={(e) => {
                if (!dragId) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                const r = e.currentTarget.getBoundingClientRect()
                const after = e.clientY > r.top + r.height / 2
                if (drop?.id !== ws.id || drop.after !== after) setDrop({ id: ws.id, after })
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragId && drop) {
                  const i = workspaces.findIndex((w) => w.id === drop.id) + (drop.after ? 1 : 0)
                  props.onReorder(dragId, workspaces[i]?.id ?? null)
                }
                endDrag()
              }}
              onDragEnd={endDrag}
              onClick={() => props.onSelect(ws.id)}
              onDoubleClick={() => setEditing(ws.id)}
            >
              {editing === ws.id ? (
                <input
                  className="workspace-rename"
                  autoFocus
                  defaultValue={ws.name}
                  onBlur={(e) => {
                    props.onRename(ws.id, e.currentTarget.value.trim() || ws.name)
                    setEditing(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setEditing(null)
                  }}
                />
              ) : (
                <div className="workspace-name">
                  {ws.name}
                  {props.attention.has(ws.id) ? (
                    <span className="workspace-status workspace-status-done" title="Something finished here" />
                  ) : (
                    busy.length > 0 && <span className="workspace-status workspace-status-busy" title={`Running: ${busy.join(', ')}`} />
                  )}
                </div>
              )}
              <div className="workspace-meta">
                {shortPath(m?.cwd, homeDir)}
                {m?.branch && <span className="workspace-branch"> ⎇ {m.branch}</span>}
                {busy.length > 0 && <span className="workspace-running"> · {[...new Set(busy)].join(', ')}</span>}
              </div>
              <button
                className="workspace-close"
                title="Close workspace"
                onClick={(e) => {
                  e.stopPropagation()
                  props.onClose(ws.id)
                }}
              >
                ×
              </button>
            </li>
          )
        })}
      </ul>
      <button className="workspace-new" onClick={props.onNew}>
        + New workspace
      </button>
      <div className="shortcuts">
        <div className="shortcuts-title">Shortcuts</div>
        {SHORTCUTS.map(([keys, label]) => (
          <div className="shortcut" key={label}>
            <span className="shortcut-label">{label}</span>
            <span className="shortcut-keys">
              {keys.map((k) => (
                <kbd key={k}>{k}</kbd>
              ))}
            </span>
          </div>
        ))}
        <div className="shortcut-hint">Drag a pane's header to move it</div>
        <div className="shortcut-hint">Drag a workspace to reorder it</div>
        <div className="shortcut-hint">Ctrl+scroll over a file viewer to zoom it</div>
        <div className="shortcut-hint">Right-click a terminal for copy, paste, split and more</div>
      </div>
      <div className="sidebar-resizer" title="Drag to resize" onMouseDown={props.onResizeStart} />
    </aside>
  )
}
