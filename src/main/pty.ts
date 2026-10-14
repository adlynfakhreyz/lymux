import { existsSync, readlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import * as pty from 'node-pty'
import type { WebContents } from 'electron'
import type { SpawnOptions } from '../shared/types'

/** Owns one shell process per pane. Lives in the main process so panes survive renderer re-layouts. */
export class PtyManager {
  private ptys = new Map<string, pty.IPty>()
  private dataListeners = new Set<(id: string, data: string) => void>()
  private exitListeners = new Set<(id: string) => void>()

  /** `env` adds per-pane variables to each shell (LYMUX_PANE_ID, the CLI on PATH). */
  constructor(
    private target: () => WebContents | null,
    private env: (id: string) => Record<string, string> = () => ({})
  ) {}

  spawn(id: string, opts: SpawnOptions): void {
    if (this.ptys.has(id)) return
    const shell = process.env.SHELL || '/bin/bash'
    const cwd = opts.cwd && existsSync(opts.cwd) ? opts.cwd : homedir()
    const p = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd,
      env: { ...process.env, ...this.env(id), TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'lymux' } as Record<string, string>
    })
    p.onData((data) => {
      this.target()?.send('pty:data', id, data)
      this.dataListeners.forEach((cb) => cb(id, data))
    })
    p.onExit(({ exitCode }) => {
      this.ptys.delete(id)
      this.exitListeners.forEach((cb) => cb(id))
      this.target()?.send('pty:exit', id, exitCode)
    })
    this.ptys.set(id, p)
  }

  /** Listen to every pane's output (control socket waits). Returns an unsubscribe function. */
  onData(cb: (id: string, data: string) => void): () => void {
    this.dataListeners.add(cb)
    return () => this.dataListeners.delete(cb)
  }

  onExit(cb: (id: string) => void): () => void {
    this.exitListeners.add(cb)
    return () => this.exitListeners.delete(cb)
  }

  write(id: string, data: string): void {
    this.ptys.get(id)?.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    if (cols > 0 && rows > 0) this.ptys.get(id)?.resize(cols, rows)
  }

  kill(id: string): void {
    this.ptys.get(id)?.kill()
    this.ptys.delete(id)
  }

  killAll(): void {
    for (const id of [...this.ptys.keys()]) this.kill(id)
  }

  /** Current working directory of the pane's shell, read from /proc (Linux). */
  cwdOf(id: string): string | null {
    const p = this.ptys.get(id)
    if (!p) return null
    try {
      return readlinkSync(`/proc/${p.pid}/cwd`)
    } catch {
      return null
    }
  }
}
