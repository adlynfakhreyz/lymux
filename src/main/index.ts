import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { homedir, tmpdir } from 'node:os'
import { readFile, writeFile } from 'node:fs/promises'
import { chmodSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:net'
import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import { PtyManager } from './pty'
import { loadSession, saveSession } from './session'
import { gitBranch } from './git'
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

  // Dev aid for demo videos: LYMUX_RECORD=/dir saves PNG frames of the window (as fast as capture allows, up to
  // ~12 fps) plus frames.txt, an ffmpeg concat list with each frame's real on-screen duration.
  const recordDir = process.env.LYMUX_RECORD
  if (recordDir) {
    const frames: { file: string; at: number }[] = []
    let busy = false
    win.webContents.once('did-finish-load', () => {
      const timer = setInterval(async () => {
        if (busy || !win || win.isDestroyed()) return
        busy = true
        try {
          const at = Date.now()
          const image = await win.webContents.capturePage()
          const file = join(recordDir, `frame-${String(frames.length).padStart(5, '0')}.png`)
          await writeFile(file, image.toPNG())
          frames.push({ file, at })
        } finally {
          busy = false
        }
      }, 80)
      app.once('before-quit', () => {
        clearInterval(timer)
        const list = frames.map((f, i) => {
          const next = frames[i + 1]?.at ?? f.at + 80
          return `file '${f.file}'\nduration ${((next - f.at) / 1000).toFixed(3)}`
        })
        // concat demuxer quirk: repeat the last file so its duration is honoured.
        if (frames.length) list.push(`file '${frames[frames.length - 1].file}'`)
        writeFileSync(join(recordDir, 'frames.txt'), list.join('\n') + '\n')
      })
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

  win.on('closed', () => {
    win = null
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
    const { pane } = (await askRenderer('locate', p)) as { pane: string }
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
