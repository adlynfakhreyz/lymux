import type { LayoutNode, Session, SplitDir, Workspace } from '../../../shared/types'

// Pure functions over the layout tree. Every change returns a new tree so React state stays immutable.

export const uid = (): string => crypto.randomUUID().slice(0, 8)

export const newPane = (cwd?: string): LayoutNode => ({ type: 'pane', id: uid(), cwd })

export function newWorkspace(name: string, cwd?: string): Workspace {
  const root = newPane(cwd)
  return { id: uid(), name, root, activePaneId: root.id }
}

export function newSession(cwd?: string): Session {
  const ws = newWorkspace('main', cwd)
  return { version: 1, workspaces: [ws], activeWorkspaceId: ws.id }
}

export function listPanes(node: LayoutNode): Extract<LayoutNode, { type: 'pane' }>[] {
  return node.type === 'pane' ? [node] : node.children.flatMap(listPanes)
}

const equal = (n: number): number[] => Array.from({ length: n }, () => 100 / n)

/**
 * Put `pane` next to `paneId` (after it, or before it when `before` is set).
 * Joins the parent split when it already runs in `dir`, so repeated splits stay flat.
 */
export function splitPane(root: LayoutNode, paneId: string, dir: SplitDir, pane: LayoutNode, before = false): LayoutNode {
  if (root.type === 'pane') {
    if (root.id !== paneId) return root
    return { type: 'split', id: uid(), dir, children: before ? [pane, root] : [root, pane], sizes: [50, 50] }
  }
  const idx = root.children.findIndex((c) => c.type === 'pane' && c.id === paneId)
  if (idx >= 0 && root.dir === dir) {
    const at = before ? idx : idx + 1
    const children = [...root.children.slice(0, at), pane, ...root.children.slice(at)]
    return { ...root, children, sizes: equal(children.length) }
  }
  return { ...root, children: root.children.map((c) => splitPane(c, paneId, dir, pane, before)) }
}

/** Where a dragged pane lands relative to the pane it is dropped on. `center` swaps the two. */
export type DropEdge = 'left' | 'right' | 'top' | 'bottom' | 'center'

function findPane(node: LayoutNode, id: string): LayoutNode | null {
  if (node.type === 'pane') return node.id === id ? node : null
  for (const c of node.children) {
    const found = findPane(c, id)
    if (found) return found
  }
  return null
}

function swapPanes(node: LayoutNode, a: LayoutNode, b: LayoutNode): LayoutNode {
  if (node.type === 'pane') return node.id === a.id ? b : node.id === b.id ? a : node
  return { ...node, children: node.children.map((c) => swapPanes(c, a, b)) }
}

/** Move pane `srcId` beside (or onto, for `center`) pane `targetId`. The pane keeps its id, so its terminal survives. */
export function movePane(root: LayoutNode, srcId: string, targetId: string, edge: DropEdge): LayoutNode {
  if (srcId === targetId) return root
  const src = findPane(root, srcId)
  const target = findPane(root, targetId)
  if (!src || !target) return root
  if (edge === 'center') return swapPanes(root, src, target)
  const rest = removePane(root, srcId)
  if (!rest) return root
  const dir: SplitDir = edge === 'left' || edge === 'right' ? 'row' : 'column'
  return splitPane(rest, targetId, dir, src, edge === 'left' || edge === 'top')
}

/** Remove a pane; splits left with one child collapse into that child. Returns null when nothing is left. */
export function removePane(root: LayoutNode, paneId: string): LayoutNode | null {
  if (root.type === 'pane') return root.id === paneId ? null : root
  const children = root.children.map((c) => removePane(c, paneId)).filter((c): c is LayoutNode => c !== null)
  if (children.length === 0) return null
  if (children.length === 1) return children[0]
  return { ...root, children, sizes: children.length === root.children.length ? root.sizes : equal(children.length) }
}

export function setSizes(root: LayoutNode, splitId: string, sizes: number[]): LayoutNode {
  if (root.type === 'pane') return root
  if (root.id === splitId) return { ...root, sizes }
  return { ...root, children: root.children.map((c) => setSizes(c, splitId, sizes)) }
}

export function setPaneCwds(root: LayoutNode, cwds: Record<string, string | null>): LayoutNode {
  if (root.type === 'pane') return cwds[root.id] ? { ...root, cwd: cwds[root.id] ?? undefined } : root
  return { ...root, children: root.children.map((c) => setPaneCwds(c, cwds)) }
}

/** Give pane `paneId` `percent` of its parent split; its siblings share the rest in their current proportions. */
export function resizePane(root: LayoutNode, paneId: string, percent: number): LayoutNode {
  if (root.type === 'pane') return root
  const idx = root.children.findIndex((c) => c.type === 'pane' && c.id === paneId)
  if (idx < 0) return { ...root, children: root.children.map((c) => resizePane(c, paneId, percent)) }
  const others = 100 - root.sizes[idx]
  const scale = others > 0 ? (100 - percent) / others : 0
  return { ...root, sizes: root.sizes.map((s, i) => (i === idx ? percent : s * scale)) }
}
