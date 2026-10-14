import { connect } from 'node:net'
import type { ControlParams, ControlResponse } from '../shared/control'

// Control socket client for the CLI and the MCP server. Runs under plain Node (ELECTRON_RUN_AS_NODE), so no electron imports.

export function socketPath(): string {
  const path = process.env.LYMUX_SOCKET
  if (!path) throw new Error('LYMUX_SOCKET is not set. Run lymux commands from a lymux pane, or through ~/.config/lymux/bin/lymux.')
  return path
}

/** One request, one response. Waits get their own timeout plus a margin; everything else answers quickly. */
export function call<T = unknown>(method: string, params: ControlParams = {}): Promise<T> {
  const path = socketPath()
  const timeoutMs = method === 'wait' || params.pattern || params.idle ? ((params.timeout ?? 30) + 15) * 1000 : 20000
  return new Promise((resolve, reject) => {
    const sock = connect(path)
    let buf = ''
    const timer = setTimeout(() => {
      sock.destroy()
      reject(new Error(`${method}: no answer from lymux`))
    }, timeoutMs)
    sock.setEncoding('utf8')
    sock.on('connect', () => sock.write(JSON.stringify({ id: 1, method, params }) + '\n'))
    sock.on('data', (chunk: string) => {
      buf += chunk
      const nl = buf.indexOf('\n')
      if (nl < 0) return
      clearTimeout(timer)
      sock.end()
      const res = JSON.parse(buf.slice(0, nl)) as ControlResponse
      if (res.error) reject(new Error(res.error))
      else resolve(res.result as T)
    })
    sock.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      reject(
        err.code === 'ENOENT' || err.code === 'ECONNREFUSED' ? new Error(`lymux is not running (no control socket at ${path})`) : err
      )
    })
  })
}
