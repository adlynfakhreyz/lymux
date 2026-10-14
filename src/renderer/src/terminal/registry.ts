import { createXtermEngine, type TerminalEngine } from './engine'

/**
 * One engine + shell per pane id, kept outside React. Splitting re-parents panes in the React tree,
 * which re-mounts components; the registry keeps the terminal (and its scrollback) alive through that.
 */
const engines = new Map<string, TerminalEngine>()
const spawned = new Set<string>()
let fontSize = 13

window.lymux.pty.onData((id, data) => engines.get(id)?.write(data))
window.lymux.pty.onExit((id) => engines.get(id)?.write('\r\n\x1b[2m[process exited]\x1b[0m\r\n'))

export function getEngine(id: string): TerminalEngine {
  let engine = engines.get(id)
  if (!engine) {
    engine = createXtermEngine(fontSize)
    engine.onInput((data) => window.lymux.pty.write(id, data))
    engines.set(id, engine)
  }
  return engine
}

/** How long the shell gets to redraw its prompt at a narrower width before the terminal itself narrows. */
const SHELL_REDRAW_MS = 80
const pendingShrink = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Fit the pane's terminal to its element and keep the shell in step, starting the shell on first call.
 *
 * Getting narrower is ordered shell-first. A full-width prompt line (powerlevel10k's right prompt, for one) would
 * otherwise be reflowed onto two rows by xterm, and zsh's redraw, which assumes the old layout, leaves that wrapped
 * copy behind under the new prompt. Told first, the shell redraws its prompt to fit the new width while the
 * terminal is still wide, so by the time the terminal narrows there is nothing left to wrap.
 */
export function syncSize(id: string, cwd?: string): void {
  const engine = getEngine(id)
  const next = engine.measure()
  if (!next) return
  if (!spawned.has(id)) {
    engine.resize(next)
    spawned.add(id)
    void window.lymux.pty.spawn(id, { cwd, ...next })
    return
  }
  clearTimeout(pendingShrink.get(id))
  pendingShrink.delete(id)
  if (next.cols < engine.size().cols) {
    window.lymux.pty.resize(id, next.cols, next.rows)
    pendingShrink.set(
      id,
      setTimeout(() => {
        pendingShrink.delete(id)
        const latest = engine.measure() ?? next
        engine.resize(latest)
        if (latest.cols !== next.cols || latest.rows !== next.rows) window.lymux.pty.resize(id, latest.cols, latest.rows)
      }, SHELL_REDRAW_MS)
    )
  } else {
    engine.resize(next)
    window.lymux.pty.resize(id, next.cols, next.rows)
  }
}

/** Start a pane's shell even if it is not on screen (a background workspace driven over the control socket). */
export async function ensureRunning(id: string, cwd: string | undefined): Promise<void> {
  const engine = getEngine(id)
  if (spawned.has(id)) return
  spawned.add(id)
  // Not mounted yet: xterm keeps its default grid (80x24) until the pane is shown and fitted.
  const measured = engine.measure()
  if (measured) engine.resize(measured)
  await window.lymux.pty.spawn(id, { cwd, ...engine.size() })
}

/** Text in a pane's terminal: the screen, the whole scrollback, or its last `lines` lines. */
export function readPane(id: string, opts: { lines?: number; scrollback?: boolean }): string {
  const engine = engines.get(id)
  if (!engine) return ''
  if (!opts.lines) return engine.text(!!opts.scrollback)
  return engine.text(true).split('\n').slice(-opts.lines).join('\n')
}

/** Zoom every terminal. The pane size does not change, so refit here and tell each shell its new grid. */
export function setFontSize(size: number): void {
  if (size === fontSize) return
  fontSize = size
  for (const [id, engine] of engines) {
    engine.setFontSize(size)
    if (spawned.has(id)) syncSize(id)
  }
}

/** Called only when a pane is closed for good (not on re-mount). */
export function destroyPane(id: string): void {
  clearTimeout(pendingShrink.get(id))
  pendingShrink.delete(id)
  window.lymux.pty.kill(id)
  engines.get(id)?.dispose()
  engines.delete(id)
  spawned.delete(id)
}
