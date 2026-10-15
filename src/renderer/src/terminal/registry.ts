import { createXtermEngine, type TerminalEngine } from './engine'

/**
 * One engine + shell per pane id, kept outside React. Splitting re-parents panes in the React tree,
 * which re-mounts components; the registry keeps the terminal (and its scrollback) alive through that.
 */
const engines = new Map<string, TerminalEngine>()
const spawned = new Set<string>()
let fontSize = 13

window.lymux.pty.onData((id, data) => {
  engines.get(id)?.write(data)
  onShellOutput.get(id)?.()
})
/** What the app does with pane events the terminal layer can't act on by itself (App sets these). */
export interface PaneEvents {
  /** Close the pane: its shell exited cleanly, or the user pressed a key after an error exit. */
  close(id: string): void
  bell(id: string): void
  notification(id: string, title: string | null, body: string): void
}
let events: PaneEvents | null = null
export function setPaneEvents(handlers: PaneEvents): void {
  events = handlers
}

/** Panes whose shell exited with an error: they stay open to show it, and the next key closes them. */
const exited = new Set<string>()

window.lymux.pty.onExit((id, exitCode) => {
  const engine = engines.get(id)
  if (!engine) return // the pane was closed, which killed its shell
  if (exitCode === 0 && events) return events.close(id)
  exited.add(id)
  engine.write(`\r\n\x1b[2m[exited with code ${exitCode} · press any key to close]\x1b[0m\r\n`)
})

export function getEngine(id: string): TerminalEngine {
  let engine = engines.get(id)
  if (!engine) {
    engine = createXtermEngine(fontSize)
    engine.onInput((data) => (exited.has(id) ? events?.close(id) : window.lymux.pty.write(id, data)))
    engine.onBell(() => events?.bell(id))
    engine.onNotification((title, body) => events?.notification(id, title, body))
    engines.set(id, engine)
  }
  return engine
}

/** The shell's redraw after a narrowing is done once it has been quiet this long. */
const SHELL_REDRAW_QUIET_MS = 40
/** Narrow the terminal anyway after this long: a busy program may never redraw. */
const SHELL_REDRAW_MAX_MS = 500
/** Per pane: a narrowing waiting on the shell's redraw, and how to cancel it. */
const pendingShrink = new Map<string, () => void>()
/** Per pane: called on every chunk of shell output while a narrowing waits for the redraw. */
const onShellOutput = new Map<string, () => void>()

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
  pendingShrink.get(id)?.()
  if (next.cols < engine.size().cols) {
    window.lymux.pty.resize(id, next.cols, next.rows)
    // Wait for the redraw to arrive and finish (prompts like powerlevel10k can take a while, more so on a busy
    // machine), then for xterm to parse it (writes are processed asynchronously), and only then narrow the grid.
    let quiet: ReturnType<typeof setTimeout> | undefined
    const cancel = (): void => {
      clearTimeout(quiet)
      clearTimeout(max)
      onShellOutput.delete(id)
      pendingShrink.delete(id)
    }
    const narrow = (): void => {
      cancel()
      engine.afterWrites(() => {
        if (pendingShrink.has(id)) return // a newer resize took over
        const latest = engine.measure() ?? next
        engine.resize(latest)
        if (latest.cols !== next.cols || latest.rows !== next.rows) window.lymux.pty.resize(id, latest.cols, latest.rows)
      })
    }
    const max = setTimeout(narrow, SHELL_REDRAW_MAX_MS)
    onShellOutput.set(id, () => {
      clearTimeout(quiet)
      quiet = setTimeout(narrow, SHELL_REDRAW_QUIET_MS)
    })
    pendingShrink.set(id, cancel)
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
  exited.delete(id)
  pendingShrink.get(id)?.()
  window.lymux.pty.kill(id)
  engines.get(id)?.dispose()
  engines.delete(id)
  spawned.delete(id)
}
