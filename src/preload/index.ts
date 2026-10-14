import { contextBridge, ipcRenderer } from 'electron'
import type { ControlParams } from '../shared/control'
import type { LymuxApi } from '../shared/types'

function subscribe<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, ...args: unknown[]): void => cb(...(args as T))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

// The main process passes the home directory as a launch argument (the sandboxed preload has no node:os).
const homeArg = process.argv.find((a) => a.startsWith('--lymux-home='))

const api: LymuxApi = {
  homeDir: homeArg ? homeArg.slice('--lymux-home='.length) : '/',
  pty: {
    spawn: (id, opts) => ipcRenderer.invoke('pty:spawn', id, opts),
    write: (id, data) => ipcRenderer.send('pty:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id) => ipcRenderer.send('pty:kill', id),
    onData: (cb) => subscribe('pty:data', cb),
    onExit: (cb) => subscribe('pty:exit', cb)
  },
  session: {
    load: () => ipcRenderer.invoke('session:load'),
    save: (session) => ipcRenderer.invoke('session:save', session)
  },
  meta: (ids) => ipcRenderer.invoke('meta:get', ids),
  control: {
    serve: (handler) =>
      subscribe('control:request', (id: number, method: string, params: ControlParams) => {
        handler(method, params).then(
          (result) => ipcRenderer.send('control:response', id, result),
          (err) => ipcRenderer.send('control:response', id, undefined, err instanceof Error ? err.message : String(err))
        )
      })
  }
}

contextBridge.exposeInMainWorld('lymux', api)
