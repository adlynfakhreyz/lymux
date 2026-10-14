import { destroyPane } from './terminal/registry'
import { destroyViewer } from './viewer/registry'

/** Release whatever a closed pane held: its shell and terminal, or its file viewer and watch. */
export function disposePane(id: string): void {
  destroyPane(id)
  destroyViewer(id)
}
