import type { ControlParams } from '../../../shared/control'

/**
 * The file renderer engine. Each format in src/shared/formats.ts has a class in renderers/<kind>.ts whose default
 * export extends FileRenderer. It is loaded with import() the first time a file of that kind opens, so its libraries
 * cost nothing until then. The viewer registry (registry.ts) does everything else: file access and size limits,
 * watching and live reload, error states, scroll position, zoom steps, and keeping the DOM alive across re-mounts.
 *
 * Lifecycle: constructor(host) → mount(el, file) → update(bytes), again on every reload or change → dispose().
 * setZoom and resize may come at any time after mount; text after the first update.
 */
export abstract class FileRenderer {
  /** The element to draw in: empty at mount, inside host.scroller. */
  protected el!: HTMLElement
  protected file!: ViewerFile

  constructor(protected readonly host: ViewerHost) {}

  /** Called once before the first update. Overrides build their DOM after calling super.mount(el, file). */
  mount(el: HTMLElement, file: ViewerFile): void {
    this.el = el
    this.file = file
  }

  /** Show the file's bytes. Resolve once drawn: the registry restores the scroll position then. */
  abstract update(bytes: Uint8Array): Promise<void>

  /** Plain text of the bytes last shown, for `lymux read` and read_pane. Rejects when the format has none. */
  abstract text(params: ControlParams): Promise<string>

  /** The viewer's own zoom, 1 = 100% (0.5 to 3). Called after mount with the saved zoom, then on every change. */
  setZoom(_factor: number): void {}

  /** The pane changed size (also once it is first shown). For fit-to-width layouts and virtualized grids. */
  resize(): void {}

  dispose(): void {
    this.el?.replaceChildren()
  }
}

export interface ViewerFile {
  /** Absolute path. */
  readonly path: string
  /** The Format kind (src/shared/formats.ts). */
  readonly kind: string
}

/** What a renderer may ask of its pane. */
export interface ViewerHost {
  /** The element that scrolls (el's parent), e.g. to track which PDF page is in view. */
  readonly scroller: HTMLElement
  /** Bytes of another file the main process allows: images in a Markdown file's folder. */
  read(path: string): Promise<Uint8Array>
  /** Show another supported file in this pane (a relative link). */
  navigate(path: string): void
  /** Short text in the pane header after the label, e.g. a PDF page counter "3 / 12". Empty clears it. */
  setStatus(text: string): void
}

export type FileRendererClass = new (host: ViewerHost) => FileRenderer

/** A format whose renderer has not landed yet: says so, and offers the default app through the header button. */
export class PlaceholderRenderer extends FileRenderer {
  constructor(
    host: ViewerHost,
    private readonly label: string
  ) {
    super(host)
  }

  mount(el: HTMLElement, file: ViewerFile): void {
    super.mount(el, file)
    const note = document.createElement('div')
    note.className = 'viewer-placeholder'
    note.textContent = `${this.label} files are not supported yet. Use the ↗ button to open it in the default app.`
    el.appendChild(note)
  }

  async update(): Promise<void> {}

  async text(): Promise<string> {
    throw new Error(`reading ${this.label} files is not supported yet`)
  }
}

// renderers/<kind>.ts, each its own chunk.
const modules = import.meta.glob<{ default: FileRendererClass }>('./renderers/*.ts')
const loaded = new Map<string, Promise<FileRendererClass>>()

export function loadRenderer(kind: string): Promise<FileRendererClass> {
  let p = loaded.get(kind)
  if (!p) {
    const load = modules[`./renderers/${kind}.ts`]
    if (!load) return Promise.reject(new Error(`No renderer for "${kind}" files`))
    p = load().then((m) => m.default)
    // A failed chunk load should not stick: let the next reload try again.
    p.catch(() => loaded.delete(kind))
    loaded.set(kind, p)
  }
  return p
}
