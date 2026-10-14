import { useEffect, useRef } from 'react'
import type { ControlParams } from '../../../shared/control'
import { basename } from '../../../shared/files'
import { formatFor } from '../../../shared/formats'
import type { TerminalEngine } from '../terminal/engine'
import { getEngine, syncSize } from '../terminal/registry'
import { openMenu, type MenuItem } from './ContextMenu'
import { PaneFrame, type PaneFrameProps } from './PaneFrame'

interface Props extends PaneFrameProps {
  cwd?: string
  title: string
  /** Run a pane action through the same code as the control socket (split, open, close-pane). */
  onCommand: (method: string, params: ControlParams) => void
}

const api = window.lymux

/** The selected text as a file a viewer can show, resolved against the pane's directory; null if it isn't one. */
async function selectedFile(id: string, text: string): Promise<string | null> {
  const raw = text.trim().replace(/^['"]|['"]$/g, '')
  if (!raw || /\s/.test(raw) || !formatFor(raw)) return null
  if (raw.startsWith('/')) return raw
  if (raw.startsWith('~/')) return api.homeDir + raw.slice(1)
  const cwd = (await api.meta([id]))[id]?.cwd
  return cwd ? `${cwd}/${raw.replace(/^\.\//, '')}` : null
}

export async function copySelection(engine: TerminalEngine): Promise<void> {
  const text = engine.selection()
  if (text) api.clipboard.write(text)
}

export async function pasteClipboard(engine: TerminalEngine): Promise<void> {
  const text = await api.clipboard.read()
  if (text) engine.paste(text)
}

/** The terminal's right-click menu. */
async function showMenu(id: string, engine: TerminalEngine, command: Props['onCommand'], x: number, y: number): Promise<void> {
  const selected = engine.selection()
  const file = await selectedFile(id, selected)
  const items: MenuItem[] = [
    { id: 'copy', label: 'Copy', enabled: !!selected, keys: 'Ctrl+Shift+C' },
    { id: 'paste', label: 'Paste', keys: 'Ctrl+Shift+V' },
    { id: 'select-all', label: 'Select All' },
    ...(file ? [{ type: 'separator' } as const, { id: 'open', label: `Open ${basename(file)}` }] : []),
    { type: 'separator' },
    { id: 'split-right', label: 'Split Right', keys: 'Ctrl+Shift+D' },
    { id: 'split-down', label: 'Split Down', keys: 'Ctrl+Shift+E' },
    { type: 'separator' },
    { id: 'clear', label: 'Clear' },
    { id: 'close', label: 'Close Pane', keys: 'Ctrl+Shift+W' }
  ]
  const choice = await openMenu(x, y, items)
  if (choice === 'copy') await copySelection(engine)
  else if (choice === 'paste') await pasteClipboard(engine)
  else if (choice === 'select-all') engine.selectAll()
  else if (choice === 'open' && file) command('open', { pane: id, path: file })
  else if (choice === 'split-right') command('split', { pane: id, direction: 'right' })
  else if (choice === 'split-down') command('split', { pane: id, direction: 'down' })
  else if (choice === 'clear') engine.clear()
  else if (choice === 'close') command('close-pane', { pane: id })
  if (choice !== 'close') engine.focus()
}

export function TerminalPane(props: Props): React.JSX.Element {
  const { id, cwd, title, active } = props
  const hostRef = useRef<HTMLDivElement>(null)
  // The listener below is attached once; read the latest callbacks through refs.
  const latest = useRef(props)
  latest.current = props

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const engine = getEngine(id)
    host.appendChild(engine.element)

    const sync = (): void => syncSize(id, cwd)
    // Wait one frame so the panel has its final size before the first fit.
    const raf = requestAnimationFrame(sync)
    const observer = new ResizeObserver(() => sync())
    observer.observe(host)
    const onContextMenu = (e: MouseEvent): void => {
      e.preventDefault()
      latest.current.onFocus()
      void showMenu(id, engine, latest.current.onCommand, e.clientX, e.clientY)
    }
    host.addEventListener('contextmenu', onContextMenu)

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      host.removeEventListener('contextmenu', onContextMenu)
      // Detach only; the registry keeps the terminal alive for the next mount.
      if (engine.element.parentElement === host) host.removeChild(engine.element)
    }
    // cwd only matters for the very first spawn, so it is intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    if (active) getEngine(id).focus()
  }, [active, id])

  return <PaneFrame {...props} title={title} bodyRef={hostRef} />
}
