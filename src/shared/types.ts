// Types shared by the main process, preload, and renderer.

import type { ControlParams } from './control'

export type SplitDir = 'row' | 'column'

/** What a file viewer pane shows. */
export interface PaneView {
  /** Absolute path. */
  path: string
  /** A Format kind from src/shared/formats.ts ('markdown', 'pdf', 'sheet', 'image'). */
  kind: string
  /** The viewer's own zoom, 1 = 100% (terminal font zoom does not touch it). Optional so older sessions load. */
  zoom?: number
}

/**
 * A layout is a tree: splits hold children side by side (row) or stacked (column); leaves are panes.
 * A leaf with `view` is a read-only file viewer; without it, a terminal. `view` is optional so older sessions load.
 */
export type LayoutNode =
  | { type: 'pane'; id: string; cwd?: string; view?: PaneView }
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

/** What file:open learned about a file it allowed the renderer to read. */
export interface FileInfo {
  path: string
  kind: string
  size: number
  mtime: number
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
  /** Read-only file access for viewer panes. The main process only serves files opened with `open`. */
  file: {
    /** Check a file exists and is a supported kind, and allow reading it. Rejects with a readable message. */
    open(path: string): Promise<FileInfo>
    /** Bytes of an opened file, or of an image next to (or below) an opened Markdown file. */
    read(path: string): Promise<Uint8Array>
    watch(path: string): void
    unwatch(path: string): void
    /** A watched file changed on disk (debounced). Returns an unsubscribe function. */
    onChanged(cb: (path: string) => void): () => void
    /** Open in the desktop's default app. */
    openExternal(path: string): Promise<void>
    /** Open an http(s) link in the default browser. Other schemes are ignored. */
    openLink(url: string): Promise<void>
  }
  control: {
    /** Answer control socket requests (lymux CLI, MCP server). Returns an unsubscribe function. */
    serve(handler: (method: string, params: ControlParams) => Promise<unknown>): () => void
  }
}
