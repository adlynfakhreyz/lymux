import type { ControlParams, SplitDirection } from '../../shared/control'
import type { LayoutNode, Session, SplitDir, Workspace } from '../../shared/types'
import {
  listPanes,
  movePane,
  newPane,
  newSession,
  newWorkspace,
  removePane,
  resizePane,
  splitPane
} from './state/layout'
import { destroyPane, ensureRunning, readPane } from './terminal/registry'

// Answers control socket requests (the lymux CLI and MCP server, via the main process) with the same pure layout
// functions the UI uses.

type Pane = Extract<LayoutNode, { type: 'pane' }>

export interface ControlContext {
  session(): Session | null
  /** Apply a pure, deterministic edit: to the state the next request reads right away, and to React state. */
  apply(fn: (s: Session) => Session): void
  homeDir: string
}

const DIRECTIONS: Record<SplitDirection, [SplitDir, boolean]> = {
  right: ['row', false],
  left: ['row', true],
  down: ['column', false],
  up: ['column', true]
}

const api = window.lymux

function findWorkspace(s: Session, ref: string | undefined): Workspace {
  const ws = !ref
    ? s.workspaces.find((w) => w.id === s.activeWorkspaceId)
    : (s.workspaces.find((w) => w.id === ref) ??
      s.workspaces.find((w) => w.name === ref) ??
      (/^\d+$/.test(ref) ? s.workspaces[Number(ref) - 1] : undefined))
  if (!ws) throw new Error(`no workspace "${ref}"`)
  return ws
}

/** The pane `ref` and its workspace; without a ref, the focused pane of the active workspace. */
function findPane(s: Session, ref: string | undefined): { ws: Workspace; pane: Pane } {
  const id = ref ?? findWorkspace(s, undefined).activePaneId
  for (const ws of s.workspaces) {
    const pane = listPanes(ws.root).find((p) => p.id === id)
    if (pane) return { ws, pane }
  }
  throw new Error(`no pane "${ref}"`)
}

const mapWorkspace = (s: Session, id: string, fn: (w: Workspace) => Workspace): Session => ({
  ...s,
  workspaces: s.workspaces.map((w) => (w.id === id ? fn(w) : w))
})

async function liveCwd(pane: Pane, homeDir: string): Promise<string> {
  const m = await api.meta([pane.id])
  return m[pane.id]?.cwd ?? pane.cwd ?? homeDir
}

/** Start a new pane's shell now when it has a command to run; otherwise it starts when shown. */
async function start(pane: LayoutNode, command: string | undefined): Promise<void> {
  if (pane.type !== 'pane' || !command) return
  await ensureRunning(pane.id, pane.cwd)
  api.pty.write(pane.id, command + '\r')
}

export function createControlHandler(ctx: ControlContext): (method: string, p: ControlParams) => Promise<unknown> {
  const current = (): Session => {
    const s = ctx.session()
    if (!s) throw new Error('lymux is still starting')
    return s
  }

  const closeWorkspace = (id: string): void => {
    listPanes(findWorkspace(current(), id).root).forEach((p) => destroyPane(p.id))
    const fresh = newSession(ctx.homeDir)
    ctx.apply((s) => {
      const rest = s.workspaces.filter((w) => w.id !== id)
      if (rest.length === 0) return fresh
      return { ...s, workspaces: rest, activeWorkspaceId: s.activeWorkspaceId === id ? rest[0].id : s.activeWorkspaceId }
    })
  }

  const methods: Record<string, (p: ControlParams) => unknown> = {
    list: async () => {
      const s = current()
      const ids = s.workspaces.flatMap((w) => listPanes(w.root).map((p) => p.id))
      const meta = await api.meta(ids)
      return {
        activeWorkspaceId: s.activeWorkspaceId,
        workspaces: s.workspaces.map((w, i) => ({
          index: i + 1,
          id: w.id,
          name: w.name,
          active: w.id === s.activeWorkspaceId,
          activePaneId: w.activePaneId,
          panes: listPanes(w.root).map((p) => ({
            id: p.id,
            cwd: meta[p.id]?.cwd ?? p.cwd ?? null,
            branch: meta[p.id]?.branch ?? null
          }))
        }))
      }
    },

    tree: (p) => {
      const ws = findWorkspace(current(), p.workspace)
      return { id: ws.id, name: ws.name, activePaneId: ws.activePaneId, root: ws.root }
    },

    /** Which pane and workspace a ref means; starts the pane's shell so it can be written to and watched. */
    locate: async (p) => {
      const { ws, pane } = findPane(current(), p.pane)
      await ensureRunning(pane.id, pane.cwd)
      return { pane: pane.id, workspace: ws.id, workspaceName: ws.name }
    },

    'new-workspace': async (p) => {
      const s = current()
      const cwd = p.cwd ?? (await liveCwd(findPane(s, p.pane).pane, ctx.homeDir))
      const ws = newWorkspace(p.name ?? `workspace ${s.workspaces.length + 1}`, cwd)
      ctx.apply((s) => ({
        ...s,
        workspaces: [...s.workspaces, ws],
        activeWorkspaceId: p.background ? s.activeWorkspaceId : ws.id
      }))
      await start(ws.root, p.command)
      return { workspace: ws.id, pane: ws.activePaneId }
    },

    'select-workspace': (p) => {
      const ws = findWorkspace(current(), p.workspace)
      ctx.apply((s) => ({ ...s, activeWorkspaceId: ws.id }))
      return { workspace: ws.id }
    },

    'rename-workspace': (p) => {
      const ws = findWorkspace(current(), p.workspace)
      if (!p.name) throw new Error('rename-workspace needs a name')
      ctx.apply((s) => mapWorkspace(s, ws.id, (w) => ({ ...w, name: p.name! })))
      return { workspace: ws.id }
    },

    'close-workspace': (p) => {
      if (!p.workspace) throw new Error('close-workspace needs a workspace')
      const ws = findWorkspace(current(), p.workspace)
      closeWorkspace(ws.id)
      return { workspace: ws.id }
    },

    split: async (p) => {
      const { ws, pane } = findPane(current(), p.pane)
      const direction = DIRECTIONS[p.direction ?? 'right']
      if (!direction) throw new Error(`unknown direction "${p.direction}"`)
      const [dir, before] = direction
      const node = newPane(p.cwd ?? (await liveCwd(pane, ctx.homeDir)))
      ctx.apply((s) => ({
        ...mapWorkspace(s, ws.id, (w) => ({
          ...w,
          root: splitPane(w.root, pane.id, dir, node, before),
          activePaneId: p.background ? w.activePaneId : node.id
        })),
        activeWorkspaceId: p.background ? s.activeWorkspaceId : ws.id
      }))
      await start(node, p.command)
      return { pane: node.id, workspace: ws.id }
    },

    focus: (p) => {
      const { ws, pane } = findPane(current(), p.pane)
      ctx.apply((s) => ({ ...mapWorkspace(s, ws.id, (w) => ({ ...w, activePaneId: pane.id })), activeWorkspaceId: ws.id }))
      return { pane: pane.id, workspace: ws.id }
    },

    'close-pane': (p) => {
      const { ws, pane } = findPane(current(), p.pane)
      const root = removePane(ws.root, pane.id)
      if (!root) {
        closeWorkspace(ws.id)
        return { pane: pane.id, closedWorkspace: ws.id }
      }
      destroyPane(pane.id)
      ctx.apply((s) =>
        mapWorkspace(s, ws.id, (w) => {
          const root = removePane(w.root, pane.id) ?? w.root
          return { ...w, root, activePaneId: w.activePaneId === pane.id ? listPanes(root)[0].id : w.activePaneId }
        })
      )
      return { pane: pane.id }
    },

    'move-pane': (p) => {
      const s = current()
      const src = findPane(s, p.pane)
      const target = findPane(s, p.target)
      if (src.ws.id !== target.ws.id) throw new Error('panes can only move within their workspace')
      if (!p.edge) throw new Error('move-pane needs an edge')
      ctx.apply((s) => mapWorkspace(s, src.ws.id, (w) => ({ ...w, root: movePane(w.root, src.pane.id, target.pane.id, p.edge!) })))
      return { pane: src.pane.id }
    },

    'resize-pane': (p) => {
      const { ws, pane } = findPane(current(), p.pane)
      if (ws.root.type === 'pane') throw new Error('the pane is not in a split')
      const percent = Math.min(95, Math.max(5, Number(p.percent)))
      if (!Number.isFinite(percent)) throw new Error('resize-pane needs a percentage')
      ctx.apply((s) => mapWorkspace(s, ws.id, (w) => ({ ...w, root: resizePane(w.root, pane.id, percent) })))
      return { pane: pane.id }
    },

    send: async (p) => {
      const { pane } = findPane(current(), p.pane)
      await ensureRunning(pane.id, pane.cwd)
      api.pty.write(pane.id, p.text ?? '')
      return { pane: pane.id }
    },

    read: (p) => readPane(findPane(current(), p.pane).pane.id, p)
  }

  return async (method, p) => {
    const fn = methods[method]
    if (!fn) throw new Error(`unknown method "${method}"`)
    return fn(p)
  }
}
