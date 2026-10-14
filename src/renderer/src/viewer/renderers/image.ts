import type { ControlParams } from '../../../../shared/control'
import { IMAGE_TYPES, basename } from '../../../../shared/files'
import { extname } from '../../../../shared/formats'
import { FileRenderer, type ViewerFile } from '../renderer'

/**
 * Images, fitted to the pane at 100% and scaled from there by zoom. Always an <img> (SVG too), so an SVG's scripts
 * never run.
 */
export default class ImageRenderer extends FileRenderer {
  private img = document.createElement('img')
  private url = ''
  private zoom = 1

  mount(el: HTMLElement, file: ViewerFile): void {
    super.mount(el, file)
    el.classList.add('image-view')
    this.img.alt = basename(file.path)
    this.img.draggable = false
    el.appendChild(this.img)
  }

  async update(bytes: Uint8Array): Promise<void> {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: IMAGE_TYPES[extname(this.file.path)] ?? '' }))
    const next = new Image()
    next.src = url
    // Decode first so the swap never shows a broken or half-drawn image.
    await next.decode().catch(() => {})
    this.img.src = url
    if (this.url) URL.revokeObjectURL(this.url)
    this.url = url
    this.layout()
  }

  async text(_params: ControlParams): Promise<string> {
    const { naturalWidth: w, naturalHeight: h } = this.img
    return `${basename(this.file.path)}: image, ${w}×${h} px`
  }

  setZoom(factor: number): void {
    this.zoom = factor
    this.layout()
  }

  resize(): void {
    this.layout()
  }

  /** Fit inside the pane (never upscale past natural size), then apply zoom. */
  private layout(): void {
    const { naturalWidth: w, naturalHeight: h } = this.img
    const box = this.host.scroller
    if (!w || !h || !box.clientWidth) return
    const fit = Math.min(1, (box.clientWidth - 16) / w, (box.clientHeight - 16) / h)
    this.img.style.width = `${Math.max(1, Math.round(w * fit * this.zoom))}px`
  }

  dispose(): void {
    if (this.url) URL.revokeObjectURL(this.url)
    super.dispose()
  }
}
