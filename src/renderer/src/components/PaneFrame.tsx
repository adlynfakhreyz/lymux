import { useEffect, useState, type ReactNode, type Ref } from 'react'
import type { DropEdge } from '../state/layout'

// The chrome every pane shares, terminal or file viewer: the draggable header and the drop zones shown while another
// pane is dragged. The body is the pane's own.

export const PANE_DRAG_TYPE = 'application/x-lymux-pane'

export interface PaneFrameProps {
  id: string
  active: boolean
  /** Id of the pane currently being dragged anywhere in the workspace, or null. */
  draggingId: string | null
  onFocus: () => void
  onClose: () => void
  onDragStart: () => void
  onDragEnd: () => void
  onDrop: (srcId: string, edge: DropEdge) => void
}

interface Props extends PaneFrameProps {
  title: ReactNode
  /** Header buttons placed before the close button. */
  actions?: ReactNode
  className?: string
  bodyRef?: Ref<HTMLDivElement>
  children?: ReactNode
}

/** Which zone of the pane the pointer is over: the middle 40% swaps, otherwise the nearest edge. */
function edgeAt(e: React.DragEvent, el: HTMLElement): DropEdge {
  const r = el.getBoundingClientRect()
  const x = (e.clientX - r.left) / r.width
  const y = (e.clientY - r.top) / r.height
  if (x > 0.3 && x < 0.7 && y > 0.3 && y < 0.7) return 'center'
  const distances: [DropEdge, number][] = [
    ['left', x],
    ['right', 1 - x],
    ['top', y],
    ['bottom', 1 - y]
  ]
  return distances.sort((a, b) => a[1] - b[1])[0][0]
}

/** A header button that does not take focus from the pane or start a drag. */
export function PaneButton(props: {
  title: string
  className?: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}): React.JSX.Element {
  return (
    <button
      className={props.className === 'pane-close' ? 'pane-close' : `pane-button${props.className ? ' ' + props.className : ''}`}
      title={props.title}
      disabled={props.disabled}
      draggable={false}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

export function PaneFrame(props: Props): React.JSX.Element {
  const { id, active, draggingId, onFocus, onClose, onDragStart, onDragEnd, onDrop } = props
  const [hoverEdge, setHoverEdge] = useState<DropEdge | null>(null)

  useEffect(() => {
    if (!draggingId) setHoverEdge(null)
  }, [draggingId])

  const isDropTarget = draggingId !== null && draggingId !== id

  return (
    <div
      className={`pane${active ? ' pane-active' : ''}${draggingId === id ? ' pane-dragging' : ''}${props.className ? ' ' + props.className : ''}`}
      data-pane-id={id}
      onMouseDown={onFocus}
    >
      <div
        className="pane-header"
        draggable
        title="Drag to move this pane"
        onDragStart={(e) => {
          e.dataTransfer.setData(PANE_DRAG_TYPE, id)
          e.dataTransfer.effectAllowed = 'move'
          onDragStart()
        }}
        onDragEnd={onDragEnd}
      >
        <span className="pane-grip">⠿</span>
        <span className="pane-title">{props.title}</span>
        {props.actions}
        <PaneButton className="pane-close" title="Close pane (Ctrl+Shift+W)" onClick={onClose}>
          ×
        </PaneButton>
      </div>
      <div ref={props.bodyRef} className="pane-body">
        {props.children}
      </div>
      {isDropTarget && (
        <div
          className="drop-overlay"
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setHoverEdge(edgeAt(e, e.currentTarget))
          }}
          onDragLeave={() => setHoverEdge(null)}
          onDrop={(e) => {
            e.preventDefault()
            const src = e.dataTransfer.getData(PANE_DRAG_TYPE)
            if (src) onDrop(src, edgeAt(e, e.currentTarget))
            setHoverEdge(null)
          }}
        >
          {hoverEdge && <div className={`drop-preview drop-${hoverEdge}`}>{hoverEdge === 'center' ? 'swap' : ''}</div>}
        </div>
      )}
    </div>
  )
}
