// Control protocol shared by the main process, the renderer, the lymux CLI and the MCP server.
// The main process serves a unix socket: one JSON request per line in, one JSON response per line out.

export interface ControlRequest {
  id: number
  method: string
  params?: ControlParams
}

export interface ControlResponse {
  id: number
  result?: unknown
  error?: string
}

/** Where a split puts the new pane relative to the one it splits. */
export type SplitDirection = 'right' | 'left' | 'down' | 'up'

/** Parameters of every method. Pane/workspace refs are optional; the default is the active one. */
export interface ControlParams {
  /** Pane id. The CLI and MCP server pass the caller's own pane ($LYMUX_PANE_ID) when none is given. */
  pane?: string
  /** Workspace id, name, or 1-based position in the sidebar. */
  workspace?: string
  /** move-pane: the pane to dock beside (or swap with). */
  target?: string
  edge?: 'left' | 'right' | 'top' | 'bottom' | 'center'
  name?: string
  cwd?: string
  /** Typed into the new pane's shell, followed by Enter. */
  command?: string
  /** Do not focus the new pane / workspace. */
  background?: boolean
  direction?: SplitDirection
  /** resize-pane: share of the parent split, in percent. */
  percent?: number
  text?: string
  /** read: last N lines, scrollback included. */
  lines?: number
  scrollback?: boolean
  /** wait (and send): regex matched against the pane's output from now on (multiline mode). */
  pattern?: string
  /** wait (and send): seconds without output that count as done. */
  idle?: number
  /** wait: seconds before giving up. */
  timeout?: number
  /** wait: also match the text already on screen. */
  screen?: boolean
}

export interface WaitResult {
  pane: string
  /** The text the pattern matched. */
  matched?: string
  /** Output produced while waiting, escape sequences stripped (tail only). */
  output: string
  idle?: boolean
  exited?: boolean
  timedOut?: boolean
}

const NAMED_KEYS: Record<string, string> = {
  enter: '\r',
  tab: '\t',
  escape: '\x1b',
  esc: '\x1b',
  space: ' ',
  bspace: '\x7f',
  backspace: '\x7f',
  delete: '\x1b[3~',
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
  home: '\x1b[H',
  end: '\x1b[F',
  pageup: '\x1b[5~',
  pagedown: '\x1b[6~'
}

/** tmux-style key names (Enter, Up, C-c, M-x) to the bytes a terminal sends. Single characters pass through. */
export function keysToText(keys: string[]): string {
  return keys
    .map((key) => {
      const named = NAMED_KEYS[key.toLowerCase()]
      if (named) return named
      const ctrl = key.match(/^C-(.)$/i)
      if (ctrl) {
        const code = ctrl[1].toUpperCase().charCodeAt(0)
        if (code >= 0x40 && code <= 0x5f) return String.fromCharCode(code & 0x1f)
      }
      const meta = key.match(/^M-(.+)$/i)
      if (meta) return '\x1b' + keysToText([meta[1]])
      if ([...key].length === 1) return key
      throw new Error(`unknown key "${key}"`)
    })
    .join('')
}
