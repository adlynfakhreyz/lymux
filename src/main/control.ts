import { chmodSync, existsSync, unlinkSync } from 'node:fs'
import { connect, createServer, type Server } from 'node:net'
import type { ControlParams, ControlRequest, ControlResponse, WaitResult } from '../shared/control'
import type { PtyManager } from './pty'

export type ControlHandler = (method: string, params: ControlParams) => Promise<unknown>

/** True when another lymux instance is already answering on this socket. */
export function socketInUse(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect(path)
    sock.once('connect', () => {
      sock.destroy()
      resolve(true)
    })
    sock.once('error', () => resolve(false))
  })
}

/** Serve the control socket (user-only). Each connection may send any number of requests, one JSON object per line. */
export function serveControl(path: string, handle: ControlHandler): Server {
  // Left over from a crash: nobody answers on it (checked with socketInUse first).
  if (existsSync(path)) unlinkSync(path)
  const server = createServer((sock) => {
    let buf = ''
    const answer = async (line: string): Promise<void> => {
      let res: ControlResponse = { id: 0 }
      try {
        const req = JSON.parse(line) as ControlRequest
        res = { id: req.id, result: await handle(req.method, req.params ?? {}) }
      } catch (err) {
        res = { id: res.id, error: err instanceof Error ? err.message : String(err) }
      }
      if (!sock.destroyed) sock.write(JSON.stringify(res) + '\n')
    }
    sock.setEncoding('utf8')
    sock.on('data', (chunk: string) => {
      buf += chunk
      for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        if (line.trim()) void answer(line)
      }
    })
    sock.on('error', () => sock.destroy())
  })
  server.listen(path, () => chmodSync(path, 0o600))
  return server
}

// OSC (titles, cwd reports), CSI (colours, cursor moves), charset selection, other two-byte escapes, then stray controls.
const ESCAPES = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[()][0-9A-Za-z]|\x1b[@-_]|[\x00-\x08\x0b-\x1f\x7f]/g
export const stripEscapes = (s: string): string => s.replace(ESCAPES, '')

const KEEP_RAW = 256 * 1024
const RETURN_TAIL = 16 * 1024

export interface OutputWatch {
  /** Check text that was already there (the screen) against the pattern. */
  feed(text: string): void
  cancel(): void
  done: Promise<Omit<WaitResult, 'pane'>>
}

/**
 * Watch a pane's output from now on until `pattern` matches, it stays quiet for `idle` seconds, the shell exits,
 * or `timeout` seconds pass. Start watching before sending input so fast output is never missed.
 */
export function watchOutput(ptys: PtyManager, pane: string, p: ControlParams): OutputWatch {
  const re = p.pattern ? new RegExp(p.pattern, 'm') : null
  if (!re && !p.idle) throw new Error('wait needs a pattern or an idle time')
  let raw = ''
  let finish: (r: Omit<WaitResult, 'pane'>) => void = () => {}
  const done = new Promise<Omit<WaitResult, 'pane'>>((resolve) => (finish = resolve))
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const armIdle = (): void => {
    clearTimeout(idleTimer)
    if (p.idle) idleTimer = setTimeout(() => end({ idle: true }), p.idle * 1000)
  }
  const timeoutTimer = setTimeout(() => end({ timedOut: true }), (p.timeout ?? 30) * 1000)
  const offData = ptys.onData((id, data) => {
    if (id !== pane) return
    raw = (raw + data).slice(-KEEP_RAW)
    armIdle()
    const m = re?.exec(stripEscapes(raw))
    if (m) end({ matched: m[0] })
  })
  const offExit = ptys.onExit((id) => id === pane && end({ exited: true }))
  const stop = (): void => {
    clearTimeout(idleTimer)
    clearTimeout(timeoutTimer)
    offData()
    offExit()
  }
  function end(r: Partial<WaitResult>): void {
    stop()
    finish({ output: stripEscapes(raw).slice(-RETURN_TAIL), ...r })
  }
  armIdle()
  return {
    feed: (text) => {
      const m = re?.exec(text)
      if (m) end({ matched: m[0] })
    },
    cancel: stop,
    done
  }
}
