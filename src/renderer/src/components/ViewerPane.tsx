import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { basename } from '../../../shared/files'
import { formatFor, formatOf } from '../../../shared/formats'
import type { PaneView } from '../../../shared/types'
import {
  attachViewer,
  detachViewer,
  focusViewer,
  reloadViewer,
  setViewerZoom,
  stepZoom,
  subscribeViewer,
  viewerState,
  ZOOM_MAX,
  ZOOM_MIN
} from '../viewer/registry'
import { PaneButton, PaneFrame, type PaneFrameProps } from './PaneFrame'

interface Props extends PaneFrameProps {
  view: PaneView
  /** Show another file (a followed link) or save a new zoom. */
  onSetView: (view: PaneView) => void
}

/** A read-only file pane. Its DOM lives in the viewer registry, so a re-mount (split, drag) keeps it as it was. */
export function ViewerPane(props: Props): React.JSX.Element {
  const { id, view, active, onSetView } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const latest = useRef({ view, onSetView })
  latest.current = { view, onSetView }
  const zoom = view.zoom ?? 1

  // Layout effect: the viewer must exist before useSyncExternalStore subscribes to it.
  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    attachViewer(id, view, host, (path) => {
      const format = formatFor(path)
      if (format) latest.current.onSetView({ path, kind: format.kind })
    })
    return () => detachViewer(id, host)
    // The view object is rebuilt by layout edits; only a different file matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, view.path, view.kind])

  useEffect(() => setViewerZoom(id, zoom), [id, zoom])

  const subscribe = useCallback((cb: () => void) => subscribeViewer(id, cb), [id])
  const state = useSyncExternalStore(subscribe, () => viewerState(id))

  useEffect(() => {
    if (active) focusViewer(id)
  }, [active, id])

  const reload = (): void => void reloadViewer(id, view)
  const openExternal = (): void => void window.lymux.file.openExternal(view.path).catch(() => {})
  const setZoom = (delta: number | 'reset'): void => onSetView({ ...view, zoom: stepZoom(zoom, delta) })

  const title = (
    <span title={view.path}>
      {basename(view.path)}
      <span className="pane-kind"> · {formatOf(view.kind)?.label ?? view.kind}</span>
      {state.status && <span className="pane-kind"> · {state.status}</span>}
    </span>
  )
  const actions = (
    <>
      <span className="pane-zoom">
        <PaneButton title="Zoom out (Ctrl+scroll)" disabled={zoom <= ZOOM_MIN} onClick={() => setZoom(-1)}>
          −
        </PaneButton>
        <PaneButton className="pane-zoom-level" title="Reset zoom" onClick={() => setZoom('reset')}>
          {Math.round(zoom * 100)}%
        </PaneButton>
        <PaneButton title="Zoom in (Ctrl+scroll)" disabled={zoom >= ZOOM_MAX} onClick={() => setZoom(1)}>
          +
        </PaneButton>
      </span>
      <PaneButton title="Reload" onClick={reload}>
        ↻
      </PaneButton>
      <PaneButton title="Open in the default app" onClick={openExternal}>
        ↗
      </PaneButton>
    </>
  )

  return (
    <PaneFrame {...props} className={`pane-viewer${state.error ? ' viewer-failed' : ''}`} title={title} actions={actions} bodyRef={hostRef}>
      {state.error && (
        <div className="viewer-notice">
          <div>{state.error}</div>
          <div className="viewer-notice-actions">
            {state.tooLarge ? (
              <button onClick={openExternal}>Open in the default app</button>
            ) : (
              <button onClick={reload}>Reload</button>
            )}
          </div>
        </div>
      )}
    </PaneFrame>
  )
}
