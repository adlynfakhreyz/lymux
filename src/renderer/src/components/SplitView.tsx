import { Fragment, useEffect, useRef } from 'react'
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelGroupHandle } from 'react-resizable-panels'
import type { ControlParams } from '../../../shared/control'
import type { LayoutNode, PaneView } from '../../../shared/types'
import type { DropEdge } from '../state/layout'
import { TerminalPane } from './TerminalPane'
import { ViewerPane } from './ViewerPane'

interface Props {
  node: LayoutNode
  activePaneId: string
  draggingId: string | null
  titleOf: (paneId: string, cwd?: string) => string
  onFocusPane: (id: string) => void
  onClosePane: (id: string) => void
  onResize: (splitId: string, sizes: number[]) => void
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onMovePane: (srcId: string, targetId: string, edge: DropEdge) => void
  /** A viewer pane shows another file (a followed link) or changes its zoom. */
  onSetView: (paneId: string, view: PaneView) => void
  /** A pane action from its context menu, run like a control socket request. */
  onCommand: (method: string, params: ControlParams) => void
}

/** Renders the layout tree recursively: splits become resizable panel groups, leaves become terminals or file viewers. */
export function SplitView(props: Props): React.JSX.Element {
  const { node } = props
  if (node.type === 'pane') {
    const common = {
      id: node.id,
      active: node.id === props.activePaneId,
      draggingId: props.draggingId,
      onFocus: () => props.onFocusPane(node.id),
      onClose: () => props.onClosePane(node.id),
      onDragStart: () => props.onDragStart(node.id),
      onDragEnd: props.onDragEnd,
      onDrop: (srcId: string, edge: DropEdge) => props.onMovePane(srcId, node.id, edge)
    }
    if (node.view) return <ViewerPane {...common} view={node.view} onSetView={(view) => props.onSetView(node.id, view)} />
    return <TerminalPane {...common} cwd={node.cwd} title={props.titleOf(node.id, node.cwd)} onCommand={props.onCommand} />
  }
  return <SplitGroup {...props} node={node} />
}

function SplitGroup(props: Props & { node: Extract<LayoutNode, { type: 'split' }> }): React.JSX.Element {
  const { node } = props
  const group = useRef<ImperativePanelGroupHandle>(null)
  // Panels only read defaultSize when they mount. Sizes changed from outside (`lymux resize-pane`) are applied here;
  // a drag reports its own sizes through onLayout first, so they already match and nothing is re-applied.
  useEffect(() => {
    const shown = group.current?.getLayout()
    if (shown && node.sizes.some((size, i) => Math.abs(size - (shown[i] ?? size)) > 0.5)) group.current?.setLayout(node.sizes)
  }, [node.sizes])
  return (
    <PanelGroup
      ref={group}
      id={node.id}
      direction={node.dir === 'row' ? 'horizontal' : 'vertical'}
      onLayout={(sizes) => props.onResize(node.id, sizes)}
    >
      {node.children.map((child, i) => (
        <Fragment key={child.id}>
          {i > 0 && <PanelResizeHandle className={`resize-handle resize-${node.dir}`} />}
          <Panel id={child.id} order={i} defaultSize={node.sizes[i]} minSize={5}>
            <SplitView {...props} node={child} />
          </Panel>
        </Fragment>
      ))}
    </PanelGroup>
  )
}
