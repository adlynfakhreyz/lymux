import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'

/**
 * The only surface the rest of the app uses to talk to a terminal emulator.
 * xterm.js implements it today; a libghostty-vt engine can replace it later without touching layout or sidebar code.
 */
export interface TerminalEngine {
  /** Root DOM element; the engine keeps it alive across React re-mounts so scrollback survives re-layouts. */
  readonly element: HTMLElement
  write(data: string): void
  onInput(cb: (data: string) => void): void
  /** Fit to the element's current size; returns the new grid size. */
  fit(): { cols: number; rows: number }
  setFontSize(size: number): void
  /** Plain text of the visible screen, or of the whole scrollback. Wrapped lines are joined; trailing blank lines dropped. */
  text(scrollback: boolean): string
  focus(): void
  dispose(): void
}

/** Bundled fonts (see fonts.css): text first, then Nerd Font symbols for prompt icons. */
export const FONT_FAMILY_NAMES = ['JetBrains Mono', 'Symbols Nerd Font Mono']
const fontFamily = [...FONT_FAMILY_NAMES.map((f) => `'${f}'`), 'monospace'].join(', ')

const theme = {
  // Transparent so the pane's CSS background (translucent) shows through.
  background: '#00000000',
  foreground: '#d7dae0',
  cursor: '#d7dae0',
  selectionBackground: '#3a3f4b'
}

/** GPU renderer; if WebGL is unavailable or the context is lost, xterm falls back to its DOM renderer. */
function loadWebgl(term: Terminal): void {
  try {
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => webgl.dispose())
    term.loadAddon(webgl)
  } catch {
    // DOM renderer stays in place.
  }
}

export function createXtermEngine(fontSize = 13): TerminalEngine {
  const element = document.createElement('div')
  element.className = 'terminal-host'
  const term = new Terminal({
    fontFamily,
    fontSize,
    cursorBlink: true,
    scrollback: 10000,
    allowProposedApi: true,
    allowTransparency: true,
    // Draw box/block/shade and powerline glyphs procedurally (like Ghostty) so prompt segments join cleanly. WebGL only.
    customGlyphs: true,
    rescaleOverlappingGlyphs: true,
    theme
  })
  const fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  let opened = false

  return {
    element,
    write: (data) => term.write(data),
    onInput: (cb) => {
      term.onData(cb)
    },
    fit: () => {
      // xterm needs a live, sized element before it can open and measure.
      if (!opened && element.isConnected) {
        term.open(element)
        opened = true
        loadWebgl(term)
      }
      if (opened && element.clientWidth > 0 && element.clientHeight > 0) fitAddon.fit()
      return { cols: term.cols, rows: term.rows }
    },
    setFontSize: (size) => {
      term.options.fontSize = size
    },
    text: (scrollback) => {
      const buf = term.buffer.active
      const lines: string[] = []
      for (let y = scrollback ? 0 : buf.baseY; y < buf.length; y++) {
        const line = buf.getLine(y)
        if (!line) continue
        const s = line.translateToString(false)
        if (line.isWrapped && lines.length) lines[lines.length - 1] += s
        else lines.push(s)
      }
      const out = lines.map((l) => l.trimEnd())
      while (out.length && !out[out.length - 1]) out.pop()
      return out.join('\n')
    },
    focus: () => term.focus(),
    dispose: () => {
      term.dispose()
      element.remove()
    }
  }
}
