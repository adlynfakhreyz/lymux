import { resolve } from 'node:path'
import { call } from './client'
import { serveMcp } from './mcp'
import { keysToText, type ControlParams, type SplitDirection, type WaitResult } from '../shared/control'

// The `lymux` command: drives a running lymux window over its control socket. Built as out/main/cli.js and run by the
// wrapper the app writes to ~/.config/lymux/bin/lymux (that directory is on PATH in every lymux pane).

const HELP = `lymux: control the running lymux window (workspaces, split panes, terminals).

Inside a lymux pane, $LYMUX_PANE_ID is that pane, and it is the default for -p.
Outside one, the default is the focused pane of the active workspace.

Usage: lymux <command> [options]          add --json for machine-readable output

Workspaces
  list                                    workspaces and their panes (* = active / focused)
  tree [-w WS]                            a workspace's layout tree (JSON)
  current                                 the pane and workspace -p refers to
  new-workspace [--name N] [--cwd DIR] [--cmd CMD] [-d]
                                          prints "<workspace> <pane>"
  select-workspace WS
  rename-workspace WS NAME
  close-workspace WS                      kills its shells
  WS is a workspace id, its name, or its position in the sidebar (1, 2, ...)

Panes
  split [-p PANE] [--right|--left|--down|--up] [--cwd DIR] [--cmd CMD] [-d]
                                          prints the new pane id (default --right)
  focus PANE
  close-pane PANE                         kills its shell
  move-pane -p PANE --to TARGET --left|--right|--up|--down|--swap
  resize-pane [-p PANE] PERCENT           share of its parent split

Terminals
  send [-p PANE] TEXT... [--enter]        type text (--enter presses Enter after it)
       [--wait REGEX | --idle SECS] [--timeout SECS]
                                          ...then wait as below and print the output
  keys [-p PANE] KEY...                   Enter Tab Esc Space BSpace Up Down Left Right Home End
                                          PageUp PageDown Delete C-c M-x, or single characters
  read [-p PANE] [--lines N | --scrollback]
                                          screen text (default: the visible screen)
  wait [-p PANE] (--for REGEX | --idle SECS) [--timeout SECS] [--screen] [--quiet]
                                          block until new output matches REGEX (multiline, so
                                          ^...$ match whole lines) or goes quiet; prints the
                                          output seen; exits 1 on timeout (default 30s)

  mcp                                     serve these commands as an MCP server on stdio

Options: -p/--pane PANE, -w/--workspace WS, -d/--background (do not focus), --json

Examples
  P=$(lymux split --down --cmd 'npm run dev' -d)
  lymux wait -p "$P" --for 'ready in' --timeout 60
  lymux send -p "$P" 'npm test' --enter --wait '^Tests:' --timeout 120
  lymux keys -p "$P" C-c
`

const VALUE_OPTIONS = new Set(['pane', 'workspace', 'name', 'cwd', 'cmd', 'to', 'lines', 'for', 'wait', 'idle', 'timeout'])
const SHORT: Record<string, string> = { p: 'pane', w: 'workspace', d: 'background', h: 'help' }

interface Args {
  pos: string[]
  opts: Record<string, string | true>
}

function parse(argv: string[]): Args {
  const args: Args = { pos: [], opts: {} }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') {
      args.pos.push(...argv.slice(i + 1))
      break
    }
    const m = a.match(/^--([\w-]+)(?:=(.*))?$/) ?? a.match(/^-(\w)$/)
    if (!m) {
      args.pos.push(a)
      continue
    }
    const name = SHORT[m[1]] ?? m[1]
    if (!VALUE_OPTIONS.has(name)) args.opts[name] = true
    else if (m[2] !== undefined) args.opts[name] = m[2]
    else if (i + 1 < argv.length) args.opts[name] = argv[++i]
    else throw new Error(`--${name} needs a value`)
  }
  return args
}

const str = (v: string | true | undefined): string | undefined => (typeof v === 'string' ? v : undefined)

function num(v: string | true | undefined, name: string): number | undefined {
  if (v === undefined) return undefined
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) throw new Error(`--${name} needs a number`)
  return n
}

const oneOf = <T extends string>(opts: Args['opts'], names: readonly T[]): T | undefined => names.find((n) => opts[n])

interface ListResult {
  workspaces: {
    index: number
    id: string
    name: string
    active: boolean
    activePaneId: string
    panes: { id: string; cwd: string | null; branch: string | null }[]
  }[]
}

function printList(r: ListResult): void {
  const home = process.env.HOME ?? ''
  const me = process.env.LYMUX_PANE_ID
  for (const w of r.workspaces) {
    console.log(`${w.active ? '*' : ' '} ${w.index}  ${w.name}  (${w.id})`)
    for (const p of w.panes) {
      const cwd = p.cwd && home && (p.cwd === home || p.cwd.startsWith(home + '/')) ? '~' + p.cwd.slice(home.length) : p.cwd
      const notes = [p.branch && `⎇ ${p.branch}`, p.id === me && '(this pane)'].filter(Boolean).join('  ')
      console.log(`    ${p.id === w.activePaneId ? '*' : ' '} ${p.id}  ${cwd ?? ''}${notes ? '  ' + notes : ''}`)
    }
  }
}

/** Prints the output seen while waiting; a timeout is an error (exit 1) so scripts can branch on it. */
function printWait(r: WaitResult, quiet: boolean): number {
  if (!quiet && r.output) process.stdout.write(r.output.endsWith('\n') ? r.output : r.output + '\n')
  if (r.timedOut) {
    console.error('lymux: timed out')
    return 1
  }
  if (r.exited) console.error('lymux: the pane\'s shell exited')
  return 0
}

async function run(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(HELP)
    return 0
  }
  if (command === 'mcp') {
    await serveMcp()
    return 0
  }

  const { pos, opts } = parse(rest)
  const json = !!opts.json
  const p: ControlParams = { pane: str(opts.pane) ?? (process.env.LYMUX_PANE_ID || undefined) }
  const cwd = str(opts.cwd)
  if (cwd) p.cwd = resolve(cwd)
  if (opts.background) p.background = true
  const out = (result: unknown, text: string): number => {
    if (json) console.log(JSON.stringify(result))
    else if (text) console.log(text)
    return 0
  }
  const waitParams = (pattern: string | undefined): ControlParams => ({
    pattern,
    idle: num(opts.idle, 'idle'),
    timeout: num(opts.timeout, 'timeout')
  })

  switch (command) {
    case 'list': {
      const r = await call<ListResult>('list')
      if (json) return out(r, '')
      printList(r)
      return 0
    }
    case 'tree':
      console.log(JSON.stringify(await call('tree', { workspace: str(opts.workspace) ?? pos[0] }), null, json ? 0 : 2))
      return 0
    case 'current': {
      const r = await call<{ pane: string; workspace: string; workspaceName: string }>('locate', p)
      return out(r, `${r.pane} ${r.workspace} ${r.workspaceName}`)
    }
    case 'new-workspace': {
      const r = await call<{ workspace: string; pane: string }>('new-workspace', {
        ...p,
        name: str(opts.name) ?? (pos.join(' ') || undefined),
        command: str(opts.cmd)
      })
      return out(r, `${r.workspace} ${r.pane}`)
    }
    case 'select-workspace':
    case 'close-workspace': {
      const workspace = str(opts.workspace) ?? pos[0]
      if (!workspace) throw new Error(`${command} needs a workspace`)
      return out(await call(command, { workspace }), '')
    }
    case 'rename-workspace': {
      const [workspace, ...name] = pos
      if (!workspace || !name.length) throw new Error('usage: lymux rename-workspace WS NAME')
      return out(await call(command, { workspace, name: name.join(' ') }), '')
    }
    case 'split': {
      const direction = oneOf(opts, ['right', 'left', 'down', 'up'] as SplitDirection[])
      const r = await call<{ pane: string }>('split', { ...p, direction, command: str(opts.cmd) })
      return out(r, r.pane)
    }
    case 'focus':
    case 'close-pane': {
      const pane = str(opts.pane) ?? pos[0]
      if (!pane) throw new Error(`${command} needs a pane`)
      return out(await call(command, { pane }), '')
    }
    case 'move-pane': {
      const edges = { left: 'left', right: 'right', up: 'top', down: 'bottom', swap: 'center' } as const
      const which = oneOf(opts, Object.keys(edges) as (keyof typeof edges)[])
      const target = str(opts.to) ?? pos[0]
      if (!which || !target) throw new Error('usage: lymux move-pane -p PANE --to TARGET --left|--right|--up|--down|--swap')
      return out(await call(command, { ...p, target, edge: edges[which] }), '')
    }
    case 'resize-pane':
      return out(await call(command, { ...p, percent: num(pos[0], 'percent') }), '')
    case 'send': {
      const text = pos.join(' ') + (opts.enter ? '\r' : '')
      const pattern = str(opts.wait)
      if (!pattern && opts.idle === undefined) return out(await call('send', { ...p, text }), '')
      const r = await call<WaitResult>('send', { ...p, text, ...waitParams(pattern) })
      if (json) return out(r, '') + (r.timedOut ? 1 : 0)
      return printWait(r, !!opts.quiet)
    }
    case 'keys':
      if (!pos.length) throw new Error('keys needs at least one key')
      return out(await call('send', { ...p, text: keysToText(pos) }), '')
    case 'read': {
      const text = await call<string>('read', { ...p, lines: num(opts.lines, 'lines'), scrollback: !!opts.scrollback })
      return out(text, text)
    }
    case 'wait': {
      const pattern = str(opts.for)
      if (!pattern && opts.idle === undefined) throw new Error('wait needs --for REGEX or --idle SECS')
      const r = await call<WaitResult>('wait', { ...p, ...waitParams(pattern), screen: !!opts.screen })
      if (json) return out(r, '') + (r.timedOut ? 1 : 0)
      return printWait(r, !!opts.quiet)
    }
    default:
      throw new Error(`unknown command "${command}" (see lymux help)`)
  }
}

run(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code
  },
  (err: Error) => {
    console.error(`lymux: ${err.message}`)
    process.exitCode = 1
  }
)
