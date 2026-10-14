// Types shared by the main process, preload, and renderer.

import type { ControlParams } from './control'

export type SplitDir = 'row' | 'column'

/** A layout is a tree: splits hold children side by side (row) or stacked (column); leaves are terminal panes. */
export type LayoutNode =
  | { type: 'pane'; id: string; cwd?: string }
  | { type: 'split'; id: string; dir: SplitDir; children: LayoutNode[]; sizes: number[] }

export interface Workspace {
  id: string
  name: string
  root: LayoutNode
  activePaneId: string
}

/** `pinned`: sidebar takes space and is opened/closed by hand. `hover`: hidden, slides out over the panes when the pointer reaches the left edge. */
export type SidebarMode = 'pinned' | 'hover'

export interface UiSettings {
  fontSize: number
  sidebarWidth: number
  sidebarMode: SidebarMode
  sidebarOpen: boolean
}

export interface Session {
  version: 1
  workspaces: Workspace[]
  activeWorkspaceId: string
  /** Optional so sessions saved by older versions still load. */
  ui?: Partial<UiSettings>
}

export interface PaneMeta {
  cwd: string | null
  branch: string | null
}

export interface SpawnOptions {
  cwd?: string
  cols: number
  rows: number
}

export interface LymuxApi {
  homeDir: string
  pty: {
    spawn(id: string, opts: SpawnOptions): Promise<void>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    kill(id: string): void
    onData(cb: (id: string, data: string) => void): () => void
    onExit(cb: (id: string, exitCode: number) => void): () => void
  }
  session: {
    load(): Promise<Session | null>
    save(session: Session): Promise<void>
  }
  meta(ids: string[]): Promise<Record<string, PaneMeta>>
  control: {
    /** Answer control socket requests (lymux CLI, MCP server). Returns an unsubscribe function. */
    serve(handler: (method: string, params: ControlParams) => Promise<unknown>): () => void
  }
}
