import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { homedir, tmpdir } from 'node:os'
import { readFile, writeFile } from 'node:fs/promises'
import { chmodSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:net'
import { app, BrowserWindow, clipboard, ipcMain, Menu, Notification } from 'electron'
import { PtyManager } from './pty'
import { loadSession, saveSession } from './session'
import { gitBranch } from './git'
import { openExternal, openFile, openLink, readAllowed, unwatchAll, unwatchFile, watchFile } from './files'
import { serveControl, socketInUse, watchOutput, type ControlHandler } from './control'
import type { ControlParams } from '../shared/control'
import type { PaneMeta, Session, SpawnOptions } from '../shared/types'
import icon from '../../resources/icon.png?asset'

// AppImages cannot ship a setuid chrome-sandbox, and Ubuntu 24.04+ blocks the namespace sandbox for them.
// The .deb sets chrome-sandbox up properly, so only the AppImage opts out.
if (process.platform === 'linux' && process.env.APPIMAGE) app.commandLine.appendSwitch('no-sandbox')

// Dev/test aid: keep session state in a separate directory so test runs never touch the real ~/.config/lymux.
if (process.env.LYMUX_USER_DATA) app.setPath('userData', process.env.LYMUX_USER_DATA)

// Control socket and the generated `lymux` CLI wrapper. Dev builds get their own so they never take over the installed app's.
const controlDir =
  app.isPackaged || process.env.LYMUX_USER_DATA ? app.getPath('userData') : join(app.getPath('userData'), 'dev')
// Unix socket paths are limited to 108 bytes; a long profile path gets a short one derived from it instead.
const socketPath =
  join(controlDir, 'control.sock').length < 100
    ? join(controlDir, 'control.sock')
    : join(process.env.XDG_RUNTIME_DIR ?? tmpdir(), `lymux-${createHash('sha1').update(controlDir).digest('hex').slice(0, 12)}.sock`)
const binDir = join(controlDir, 'bin')

let win: BrowserWindow | null = null
// Every shell knows its pane and has the CLI on PATH, so an agent running in a pane can drive lymux.
const ptys = new PtyManager(
  () => (win && !win.isDestroyed() ? win.webContents : null),
  (id) => ({ LYMUX_PANE_ID: id, LYMUX_SOCKET: socketPath, PATH: `${binDir}:${process.env.PATH ?? '/usr/bin:/bin'}` })
)

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'lymux',
    // Transparent window: the renderer paints translucent backgrounds so desktop blur (e.g. Blur my Shell) shows through.
    transparent: true,
    backgroundColor: '#00000000',
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      additionalArguments: [`--lymux-home=${homedir()}`],
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))

  // Dev aid: LYMUX_SCREENSHOT=/path.png captures the window once the shells have drawn, then quits.
  const shot = process.env.LYMUX_SCREENSHOT
  if (shot) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const image = await win?.webContents.capturePage()
        if (image) await writeFile(shot, image.toPNG())
        app.quit()
      }, Number(process.env.LYMUX_SCREENSHOT_DELAY ?? 5000))
    })
  }

  // Dev aid for the demo stills: LYMUX_SHOTS=/dir saves a PNG of the window each time the renderer logs
  // `LYMUX_SHOT <name>` (tests/demo.js, run by scripts/demo.sh).
  const shotsDir = process.env.LYMUX_SHOTS
  if (shotsDir) {
    win.webContents.on('console-message', async ({ message }) => {
      const name = message.match(/^LYMUX_SHOT ([\w-]+)$/)?.[1]
      const image = name && (await win?.webContents.capturePage())
      if (image) await writeFile(join(shotsDir, `${name}.png`), image.toPNG())
    })
  }

  // Dev aid for end-to-end checks: LYMUX_EVAL=/path.js runs that script in the renderer once loaded,
  // prints its (awaited) result as JSON to stdout, then quits.
  const evalFile = process.env.LYMUX_EVAL
  if (evalFile) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const code = await readFile(evalFile, 'utf8')
          const result = await win?.webContents.executeJavaScript(code)
          process.stdout.write(`LYMUX_EVAL_RESULT ${JSON.stringify(result)}\n`)
        } catch (err) {
          process.stdout.write(`LYMUX_EVAL_ERROR ${String(err)}\n`)
        }
        app.quit()
      }, Number(process.env.LYMUX_EVAL_DELAY ?? 4000))
    })
  }

  // The renderer is an app, not a browser: links in viewed files open externally (see files.ts), never in the window.
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  win.on('closed', () => {
    win = null
    unwatchAll()
  })
}

ipcMain.handle('pty:spawn', (_e, id: string, opts: SpawnOptions) => ptys.spawn(id, opts))
ipcMain.on('pty:write', (_e, id: string, data: string) => ptys.write(id, data))
ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => ptys.resize(id, cols, rows))
ipcMain.on('pty:kill', (_e, id: string) => ptys.kill(id))
ipcMain.handle('session:load', () => loadSession())
ipcMain.handle('session:save', (_e, session: Session) => saveSession(session))
ipcMain.handle('meta:get', async (_e, ids: string[]) => {
  const out: Record<string, PaneMeta> = {}
  await Promise.all(
    ids.map(async (id) => {
      const cwd = ptys.cwdOf(id)
      out[id] = { cwd, branch: cwd ? await gitBranch(cwd) : null }
    })
  )
  return out
})

// Activity: once a second, see which panes have a command running in the foreground. The renderer shows it in the
// sidebar, and a command that ran a while without being typed into (a build, tests) gets a "finished" notification.
const ACTIVITY_POLL_MS = 1000
/** Commands shorter than this finish silently. */
const LONG_COMMAND_MS = 10_000
/** Typing into a command this long after it started marks it interactive (an editor, a REPL): no notification. */
const STARTUP_INPUT_MS = 1500
const running = new Map<string, { pgid: number; command: string; since: number }>()
setInterval(() => {
  const target = win && !win.isDestroyed() ? win.webContents : null
  for (const id of ptys.ids()) {
    const fg = ptys.foreground(id)
    const was = running.get(id)
    if (fg && was?.pgid === fg.pgid) continue
    if (was) {
      running.delete(id)
      const took = Date.now() - was.since
      const interactive = ptys.lastInputAt(id) > was.since + STARTUP_INPUT_MS
      if (took >= LONG_COMMAND_MS && !interactive) target?.send('pty:command-done', id, was.command, took)
    }
    if (fg) running.set(id, { ...fg, since: Date.now() })
    if (fg?.command !== was?.command || !fg !== !was) target?.send('pty:activity', id, fg?.command ?? null)
  }
  for (const id of running.keys()) if (!ptys.ids().includes(id)) running.delete(id)
}, ACTIVITY_POLL_MS)

// Desktop notifications. The renderer plays the sound itself, so the system one is silenced.
ipcMain.on('notify:show', (_e, title: string, body: string, paneId: string) => {
  // Test and demo runs (a throwaway LYMUX_USER_DATA profile) check notifications through the sidebar; don't pop them
  // on the developer's desktop.
  if (!Notification.isSupported() || process.env.LYMUX_USER_DATA) return
  const n = new Notification({ title, body, icon, silent: true })
  n.on('click', () => {
    if (!win || win.isDestroyed()) return
    win.show()
    win.focus()
    win.webContents.send('notify:clicked', paneId)
  })
  n.show()
})

ipcMain.handle('clipboard:read', () => clipboard.readText())
ipcMain.on('clipboard:write', (_e, text: string) => clipboard.writeText(text))

// File IPC answers { ok } or { error } so the preload can reject with the bare message (no "Error invoking..." prefix).
const handleFile = <A extends unknown[]>(channel: string, fn: (...args: A) => Promise<unknown>): void => {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: await fn(...(args as A)) }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })
}
const webContents = (): Electron.WebContents | null => (win && !win.isDestroyed() ? win.webContents : null)
handleFile('file:open', (path: string) => openFile(path))
handleFile('file:read', (path: string) => readAllowed(path))
handleFile('file:openExternal', (path: string) => openExternal(path))
handleFile('file:openLink', (url: string) => openLink(url))
ipcMain.on('file:watch', (_e, path: string) => watchFile(path, webContents))
ipcMain.on('file:unwatch', (_e, path: string) => unwatchFile(path))

// Control requests about layout and terminals are answered by the renderer, which owns the session.
const RENDERER_TIMEOUT_MS = 10000
let nextRequest = 0
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()

function askRenderer(method: string, params: ControlParams): Promise<unknown> {
  const wc = win && !win.isDestroyed() ? win.webContents : null
  if (!wc) return Promise.reject(new Error('the lymux window is not open'))
  return new Promise((resolve, reject) => {
    const id = ++nextRequest
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`${method}: the lymux window did not answer`))
    }, RENDERER_TIMEOUT_MS)
    pending.set(id, { resolve, reject, timer })
    wc.send('control:request', id, method, params)
  })
}

ipcMain.on('control:response', (_e, id: number, result: unknown, error?: string) => {
  const p = pending.get(id)
  if (!p) return
  pending.delete(id)
  clearTimeout(p.timer)
  if (error) p.reject(new Error(error))
  else p.resolve(result)
})

const handleControl: ControlHandler = async (method, p) => {
  // Waiting needs the raw pty stream, which only the main process sees. Send-and-wait starts watching before sending.
  if (method === 'wait' || (method === 'send' && (p.pattern || p.idle))) {
    const { pane, kind } = (await askRenderer('locate', p)) as { pane: string; kind: string }
    if (kind === 'viewer') throw new Error(`pane ${pane} is a file viewer`)
    const watch = watchOutput(ptys, pane, p)
    try {
      if (method === 'send') await askRenderer('send', { ...p, pane })
      else if (p.screen) watch.feed(String(await askRenderer('read', { pane })))
    } catch (err) {
      watch.cancel()
      throw err
    }
    return { pane, ...(await watch.done) }
  }
  return askRenderer(method, p)
}

/** Write the `lymux` command into binDir (on every shell's PATH) for this build of the app. */
function writeCliWrapper(): void {
  const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`
  const file = join(binDir, 'lymux')
  mkdirSync(binDir, { recursive: true })
  writeFileSync(
    file,
    [
      '#!/bin/sh',
      '# Generated by lymux at launch: the CLI that agents and scripts use to drive the app. Run `lymux help`.',
      `[ -n "$LYMUX_SOCKET" ] || LYMUX_SOCKET=${q(socketPath)}`,
      'export LYMUX_SOCKET ELECTRON_RUN_AS_NODE=1',
      `exec ${q(process.execPath)} ${q(join(__dirname, 'cli.js'))} "$@"`,
      ''
    ].join('\n')
  )
  chmodSync(file, 0o755)
}

let control: Server | null = null

async function startControl(): Promise<void> {
  mkdirSync(controlDir, { recursive: true })
  writeCliWrapper()
  // A second window keeps working, but the first one stays in charge of the socket.
  if (await socketInUse(socketPath)) return
  control = serveControl(socketPath, handleControl)
}

app.on('will-quit', () => {
  if (!control) return
  control.close()
  try {
    unlinkSync(socketPath)
  } catch {
    // Already gone.
  }
})

app.whenReady().then(() => {
  // No app menu: its default zoom accelerators (Ctrl+=/-) would zoom the whole UI instead of the terminal font.
  Menu.setApplicationMenu(null)
  createWindow()
  void startControl()
})

app.on('window-all-closed', () => {
  // v1: shells die with the app. A background daemon that keeps them alive is on the roadmap.
  ptys.killAll()
  app.quit()
})
