import { existsSync, readFileSync, readlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import * as pty from 'node-pty'
import type { WebContents } from 'electron'
import type { SpawnOptions } from '../shared/types'

/** Interpreters whose script, not the interpreter itself, names what is running (`node …/npm` is npm). */
const INTERPRETERS = new Set(['node', 'nodejs', 'python', 'python3', 'ruby', 'perl', 'bash', 'sh', 'zsh', 'deno', 'bun'])

/** A readable name for a process: its command line (comm is truncated, and node renames it "node-MainThread"). */
function commandName(pid: number): string {
  try {
    const argv = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean)
    const base = (arg: string): string => arg.split('/').pop() ?? arg
    const script = argv.slice(1).find((arg) => !arg.startsWith('-'))
    return INTERPRETERS.has(base(argv[0] ?? '')) && script ? base(script) : base(argv[0] ?? '?')
  } catch {
    return '?' // the group leader already exited; the group is still running
  }
}

/** Owns one shell process per pane. Lives in the main process so panes survive renderer re-layouts. */
export class PtyManager {
  private ptys = new Map<string, pty.IPty>()
  private dataListeners = new Set<(id: string, data: string) => void>()
  private exitListeners = new Set<(id: string) => void>()
  /** When each pane last got keyboard input, to tell interactive programs from unattended commands. */
  private lastInput = new Map<string, number>()

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
      this.lastInput.delete(id)
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
    this.lastInput.set(id, Date.now())
    this.ptys.get(id)?.write(data)
  }

  ids(): string[] {
    return [...this.ptys.keys()]
  }

  lastInputAt(id: string): number {
    return this.lastInput.get(id) ?? 0
  }

  /**
   * The command running in the foreground of the pane's terminal, or null while the shell itself waits at its prompt.
   * Read from /proc: the terminal's foreground process group differs from the shell's while a command runs.
   */
  foreground(id: string): { pgid: number; command: string } | null {
    const p = this.ptys.get(id)
    if (!p) return null
    try {
      const stat = readFileSync(`/proc/${p.pid}/stat`, 'utf8')
      // Fields after the command name, which is in parentheses and may itself contain spaces.
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
      const pgid = Number(fields[5]) // tpgid: the foreground process group of the controlling terminal
      if (!pgid || pgid < 0 || pgid === p.pid) return null
      return { pgid, command: commandName(pgid) }
    } catch {
      return null
    }
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
