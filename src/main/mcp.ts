import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import { call } from './client'
import { keysToText, type ControlParams } from '../shared/control'

// `lymux mcp`: a Model Context Protocol server on stdio (newline-delimited JSON-RPC 2.0) that exposes the control
// socket as tools. It forwards to the same methods as the CLI, so both stay in step.

type Props = Record<string, { type: string; description: string; enum?: string[]; items?: { type: string } }>

interface Tool {
  name: string
  description: string
  properties: Props
  required?: string[]
  /** Forwards the tool arguments to the control socket. */
  run(args: Record<string, unknown>): Promise<unknown>
}

const PANE = {
  pane: {
    type: 'string',
    description: 'Pane id. Defaults to the pane this agent runs in ($LYMUX_PANE_ID), else the focused pane.'
  }
}
const WORKSPACE = { workspace: { type: 'string', description: 'Workspace id, name, or 1-based position in the sidebar.' } }
const WAIT = {
  timeout: { type: 'number', description: 'Seconds before giving up (default 30).' },
  idle: { type: 'number', description: 'Done after this many seconds without output.' }
}
const NEW_PANE = {
  cwd: { type: 'string', description: 'Absolute working directory. Defaults to the current pane\'s directory.' },
  command: { type: 'string', description: 'Command typed into the new shell, followed by Enter.' },
  background: { type: 'boolean', description: 'Do not focus it (do not steal the user\'s keyboard focus).' }
}

const paneOf = (args: Record<string, unknown>): string | undefined =>
  (args.pane as string | undefined) ?? (process.env.LYMUX_PANE_ID || undefined)

/** Pass the tool arguments through, filling in the caller's pane. */
const forward =
  (method: string) =>
  (args: Record<string, unknown>): Promise<unknown> =>
    call(method, { ...(args as ControlParams), pane: paneOf(args) })

const TOOLS: Tool[] = [
  {
    name: 'list_workspaces',
    description:
      'List workspaces and their panes: ids, cwd, git branch, which workspace is active and which pane is focused. ' +
      'File viewer panes have kind "viewer" and their file instead of a cwd.',
    properties: {},
    run: () => call('list')
  },
  {
    name: 'get_layout',
    description: 'Layout tree of a workspace: nested row/column splits with sizes, panes as leaves.',
    properties: WORKSPACE,
    run: (args) => call('tree', { workspace: args.workspace as string | undefined })
  },
  {
    name: 'new_workspace',
    description: 'Create a workspace (sidebar entry) with one pane. Returns its workspace and pane ids.',
    properties: { name: { type: 'string', description: 'Sidebar name.' }, ...NEW_PANE },
    run: forward('new-workspace')
  },
  {
    name: 'select_workspace',
    description: 'Show a workspace.',
    properties: WORKSPACE,
    required: ['workspace'],
    run: (args) => call('select-workspace', { workspace: args.workspace as string })
  },
  {
    name: 'rename_workspace',
    description: 'Rename a workspace.',
    properties: { ...WORKSPACE, name: { type: 'string', description: 'New name.' } },
    required: ['workspace', 'name'],
    run: (args) => call('rename-workspace', { workspace: args.workspace as string, name: args.name as string })
  },
  {
    name: 'close_workspace',
    description: 'Close a workspace and kill all of its shells.',
    properties: WORKSPACE,
    required: ['workspace'],
    run: (args) => call('close-workspace', { workspace: args.workspace as string })
  },
  {
    name: 'split_pane',
    description: 'Split a pane, putting a new terminal beside it. Returns the new pane id.',
    properties: {
      ...PANE,
      direction: { type: 'string', enum: ['right', 'left', 'down', 'up'], description: 'Where the new pane goes (default right).' },
      ...NEW_PANE
    },
    run: forward('split')
  },
  {
    name: 'focus_pane',
    description: 'Focus a pane, switching to its workspace.',
    properties: PANE,
    required: ['pane'],
    run: forward('focus')
  },
  {
    name: 'close_pane',
    description: 'Close a pane and kill its shell. Closing the last pane closes the workspace.',
    properties: PANE,
    required: ['pane'],
    run: forward('close-pane')
  },
  {
    name: 'move_pane',
    description: 'Dock a pane on an edge of another pane in the same workspace, or swap the two (edge "center").',
    properties: {
      ...PANE,
      target: { type: 'string', description: 'Pane to dock beside or swap with.' },
      edge: { type: 'string', enum: ['left', 'right', 'top', 'bottom', 'center'], description: 'Side of the target.' }
    },
    required: ['pane', 'target', 'edge'],
    run: forward('move-pane')
  },
  {
    name: 'resize_pane',
    description: 'Set the share (percent) of its parent split that a pane takes.',
    properties: { ...PANE, percent: { type: 'number', description: '5 to 95.' } },
    required: ['percent'],
    run: forward('resize-pane')
  },
  {
    name: 'send_text',
    description:
      'Type text into a pane\'s terminal. With enter=true, press Enter after it (run a command). With wait_for or idle, ' +
      'wait for the resulting output and return it. Output includes the echoed command line, so anchor patterns (^...$).',
    properties: {
      ...PANE,
      text: { type: 'string', description: 'Text to type.' },
      enter: { type: 'boolean', description: 'Press Enter after the text.' },
      wait_for: { type: 'string', description: 'Regex (multiline) to wait for in the new output.' },
      ...WAIT
    },
    required: ['text'],
    run: (args) =>
      call('send', {
        pane: paneOf(args),
        text: String(args.text) + (args.enter ? '\r' : ''),
        pattern: args.wait_for as string | undefined,
        idle: args.idle as number | undefined,
        timeout: args.timeout as number | undefined
      })
  },
  {
    name: 'send_keys',
    description: 'Press keys in a pane: Enter Tab Esc Space BSpace Up Down Left Right Home End PageUp PageDown Delete, C-c style controls, M-x style alt, or single characters.',
    properties: { ...PANE, keys: { type: 'array', items: { type: 'string' }, description: 'Keys in order.' } },
    required: ['keys'],
    run: (args) => call('send', { pane: paneOf(args), text: keysToText(args.keys as string[]) })
  },
  {
    name: 'read_pane',
    description:
      'Text in a pane: for a terminal, the visible screen by default, or the last N lines, or the whole scrollback; ' +
      'for a file viewer, the file\'s text (Markdown source).',
    properties: {
      ...PANE,
      lines: { type: 'number', description: 'Last N lines, scrollback included.' },
      scrollback: { type: 'boolean', description: 'Everything in the scrollback.' }
    },
    run: forward('read')
  },
  {
    name: 'open_file',
    description:
      'Show a file to the user in a read-only viewer pane beside a pane (Markdown or an image; it re-renders when the ' +
      'file changes). If it is already open in that workspace, focuses it instead. Returns the viewer\'s pane id. Viewer ' +
      'panes work with read_pane, reload_pane, focus/move/resize/close_pane, but not send_text, send_keys or wait_for_output.',
    properties: {
      ...PANE,
      path: { type: 'string', description: 'The file. Relative paths resolve against this MCP server\'s working directory.' },
      direction: { type: 'string', enum: ['right', 'left', 'down', 'up'], description: 'Where the viewer goes (default right).' },
      reuse: {
        type: 'boolean',
        description: 'Show it in the workspace\'s most recently focused viewer pane instead of a new one, if there is one.'
      },
      background: NEW_PANE.background
    },
    required: ['path'],
    run: (args) => call('open', { ...(args as ControlParams), path: resolve(String(args.path)), pane: paneOf(args) })
  },
  {
    name: 'notify',
    description:
      'Tell the user something finished or needs them: a desktop notification with sound, and a mark on the pane\'s ' +
      'workspace in the lymux sidebar.',
    properties: {
      ...PANE,
      text: { type: 'string', description: 'The message.' },
      title: { type: 'string', description: 'Title (default: lymux and the workspace name).' }
    },
    required: ['text'],
    run: forward('notify')
  },
  {
    name: 'reload_pane',
    description: 'Re-read the file a viewer pane shows.',
    properties: PANE,
    required: ['pane'],
    run: forward('reload')
  },
  {
    name: 'wait_for_output',
    description:
      'Block until a pane\'s new output matches a regex, or it goes quiet for `idle` seconds. Returns the output seen. ' +
      'Set screen=true to also match text already on screen.',
    properties: {
      ...PANE,
      pattern: { type: 'string', description: 'Regex, multiline mode.' },
      screen: { type: 'boolean', description: 'Also match what is on screen now.' },
      ...WAIT
    },
    run: forward('wait')
  }
]

type Message = { jsonrpc: '2.0'; id?: number | string; method?: string; params?: Record<string, unknown> }

async function respond(msg: Message): Promise<unknown> {
  switch (msg.method) {
    case 'initialize':
      return {
        protocolVersion: (msg.params?.protocolVersion as string | undefined) ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'lymux', version: '1' },
        instructions:
          'lymux is the terminal multiplexer this agent may be running in. Use these tools to create workspaces, ' +
          'split panes, run commands in other panes and read their output, and show files (Markdown, images) to the ' +
          'user in viewer panes with open_file. Your own pane is the default target, so ' +
          'pass a pane id (from split_pane or list_workspaces) to act on another one.'
      }
    case 'ping':
      return {}
    case 'tools/list':
      return {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: { type: 'object', properties: t.properties, required: t.required ?? [] }
        }))
      }
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === msg.params?.name)
      if (!tool) throw Object.assign(new Error(`unknown tool ${String(msg.params?.name)}`), { code: -32602 })
      try {
        const result = await tool.run((msg.params?.arguments as Record<string, unknown>) ?? {})
        const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
        return { content: [{ type: 'text', text: text || '(empty)' }] }
      } catch (err) {
        return { content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }], isError: true }
      }
    }
    default:
      throw Object.assign(new Error(`method not found: ${msg.method}`), { code: -32601 })
  }
}

export function serveMcp(): Promise<void> {
  const send = (m: object): boolean => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n')
  const rl = createInterface({ input: process.stdin })
  rl.on('line', (line) => {
    if (!line.trim()) return
    let msg: Message
    try {
      msg = JSON.parse(line)
    } catch {
      send({ id: null, error: { code: -32700, message: 'parse error' } })
      return
    }
    // Notifications (no id) need no answer.
    if (msg.id === undefined) return
    respond(msg).then(
      (result) => send({ id: msg.id, result }),
      (err: Error & { code?: number }) => send({ id: msg.id, error: { code: err.code ?? -32603, message: err.message } })
    )
  })
  return new Promise((resolve) => rl.on('close', resolve))
}
