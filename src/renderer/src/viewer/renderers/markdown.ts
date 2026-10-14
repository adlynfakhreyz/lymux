import MarkdownIt from 'markdown-it'
import type { StateCore } from 'markdown-it'
import hljs from 'highlight.js/lib/common'
import DOMPurify from 'dompurify'
import type { ControlParams } from '../../../../shared/control'
import { IMAGE_TYPES, dirname, resolvePath } from '../../../../shared/files'
import { extname, formatFor } from '../../../../shared/formats'
import { FileRenderer, type ViewerFile } from '../renderer'
import './markdown.css'

// GitHub-style Markdown: markdown-it with tables, task lists, heading anchors and highlight.js code blocks, sanitized
// by DOMPurify. Local images come through file:read (the page's own origin is the app); remote ones load directly.

const IMAGE_ATTR = 'data-lymux-src'

/** `- [ ] item` and `- [x] item` become disabled checkboxes, as on GitHub. */
function taskLists(state: StateCore): void {
  const tokens = state.tokens
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i]
    if (inline.type !== 'inline' || tokens[i - 1].type !== 'paragraph_open' || tokens[i - 2].type !== 'list_item_open') continue
    const m = inline.content.match(/^\[([ xX])\]\s/)
    const first = inline.children?.[0]
    if (!m || first?.type !== 'text' || !first.content.startsWith(m[0])) continue
    first.content = first.content.slice(m[0].length)
    const box = new state.Token('html_inline', '', 0)
    box.content = `<input type="checkbox" disabled${m[1] === ' ' ? '' : ' checked'}> `
    inline.children!.unshift(box)
    tokens[i - 2].attrJoin('class', 'task-list-item')
  }
}

/** GitHub-like heading ids so `#section` links work. */
function headingIds(state: StateCore): void {
  const seen = new Map<string, number>()
  state.tokens.forEach((t, i) => {
    if (t.type !== 'heading_open') return
    const base =
      (state.tokens[i + 1]?.content ?? '')
        .toLowerCase()
        .trim()
        .replace(/[^\p{L}\p{N}\s_-]/gu, '')
        .replace(/\s/g, '-') || 'section'
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    t.attrSet('id', n ? `${base}-${n}` : base)
  })
}

const md = new MarkdownIt({
  html: true,
  linkify: true,
  highlight: (code, lang) => {
    if (!lang || !hljs.getLanguage(lang)) return ''
    try {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
    } catch {
      return ''
    }
  }
})
md.core.ruler.push('task_lists', taskLists)
md.core.ruler.push('heading_ids', headingIds)

// Image URLs stay out of the HTML: relative ones would resolve against the app itself. The renderer sets each src.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'IMG' && node.hasAttribute('src')) {
    node.setAttribute(IMAGE_ATTR, node.getAttribute('src') ?? '')
    node.removeAttribute('src')
  }
  node.removeAttribute('srcset')
})

const SANITIZE = {
  // No page-wide styles or self-loading media; scripts, iframes and event handlers are out by default.
  FORBID_TAGS: ['style', 'video', 'audio', 'source', 'track'],
  FORBID_ATTR: ['style']
}

const isRemote = (src: string): boolean => /^(https?:)?\/\//i.test(src)
const hasScheme = (href: string): boolean => /^[a-z][a-z0-9+.-]*:/i.test(href)

function decodePath(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** Wait for an image to decode (so the swap does not shift the scroll position), but never hang on a slow one. */
const settle = (img: HTMLImageElement): Promise<void> =>
  Promise.race([img.decode().catch(() => {}), new Promise<void>((r) => setTimeout(r, 1500))])

export default class MarkdownRenderer extends FileRenderer {
  private body = document.createElement('article')
  private source = ''
  private urls: string[] = []

  mount(el: HTMLElement, file: ViewerFile): void {
    super.mount(el, file)
    this.body.className = 'markdown-body'
    this.body.addEventListener('click', this.onClick)
    el.appendChild(this.body)
  }

  async update(bytes: Uint8Array): Promise<void> {
    this.source = new TextDecoder().decode(bytes)
    const next = document.createElement('div')
    next.innerHTML = DOMPurify.sanitize(md.render(this.source), SANITIZE)
    const fresh: string[] = []
    await Promise.all([...next.querySelectorAll<HTMLImageElement>(`img[${IMAGE_ATTR}]`)].map((img) => this.loadImage(img, fresh)))
    // One swap, after images have their size, so live reloads keep the reader where they were.
    this.body.replaceChildren(...next.childNodes)
    this.urls.forEach((u) => URL.revokeObjectURL(u))
    this.urls = fresh
  }

  async text(_params: ControlParams): Promise<string> {
    return this.source
  }

  setZoom(factor: number): void {
    this.body.style.zoom = String(factor)
  }

  dispose(): void {
    this.body.removeEventListener('click', this.onClick)
    this.urls.forEach((u) => URL.revokeObjectURL(u))
    super.dispose()
  }

  /** Remote images load directly; local ones become blobs of their bytes. */
  private async loadImage(img: HTMLImageElement, fresh: string[]): Promise<void> {
    const src = img.getAttribute(IMAGE_ATTR) ?? ''
    img.title ||= src
    try {
      if (isRemote(src)) {
        img.src = src.startsWith('//') ? 'https:' + src : src
        // Remote images may be slow; do not hold the render for them.
        return
      }
      if (src.startsWith('data:image/') && !src.startsWith('data:image/svg')) {
        img.src = src
        return settle(img)
      }
      if (hasScheme(src)) throw new Error('unsupported image URL')
      const path = resolvePath(dirname(this.file.path), decodePath(src.split(/[?#]/)[0]))
      const bytes = await this.host.read(path)
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: IMAGE_TYPES[extname(path)] ?? '' }))
      fresh.push(url)
      img.src = url
      await settle(img)
    } catch {
      img.classList.add('md-image-broken')
    }
  }

  // Links never navigate the window: anchors scroll, http(s) opens the browser, relative files open in this pane.
  private onClick = (e: MouseEvent): void => {
    const a = (e.target as Element).closest?.('a[href]')
    if (!a) return
    e.preventDefault()
    const href = a.getAttribute('href') ?? ''
    if (href.startsWith('#')) {
      this.body.querySelector(`[id="${CSS.escape(decodePath(href.slice(1)))}"]`)?.scrollIntoView()
    } else if (/^https?:\/\//i.test(href)) {
      void window.lymux.file.openLink(href)
    } else if (!hasScheme(href) && !href.startsWith('//')) {
      const path = resolvePath(dirname(this.file.path), decodePath(href.split(/[?#]/)[0]))
      if (formatFor(path)) this.host.navigate(path)
    }
  }
}
