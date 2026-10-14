import { useEffect, useRef, useState } from 'react'

// A right-click menu drawn by the app, not the desktop: it matches the translucent look, and it is part of the window
// (so screenshots and the demo capture it). openMenu() shows it and resolves with the chosen item's id, or null.

export type MenuItem = { type: 'separator' } | { type?: 'item'; id: string; label: string; enabled?: boolean; keys?: string }

interface Open {
  x: number
  y: number
  items: MenuItem[]
  resolve: (id: string | null) => void
}

let show: ((menu: Open | null) => void) | null = null

export function openMenu(x: number, y: number, items: MenuItem[]): Promise<string | null> {
  return new Promise((resolve) => (show ? show({ x, y, items, resolve }) : resolve(null)))
}

/** Rendered once by App; shows whichever menu is open. */
export function ContextMenuHost(): React.JSX.Element | null {
  const [menu, setMenu] = useState<Open | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })

  useEffect(() => {
    show = (next) =>
      setMenu((cur) => {
        cur?.resolve(null) // a new menu replaces one still open
        return next
      })
    return () => {
      show = null
    }
  }, [])

  const close = (id: string | null): void => {
    menu?.resolve(id)
    setMenu(null)
  }

  // Keep it inside the window, then close it on a click outside, Escape, or the window losing focus.
  useEffect(() => {
    if (!menu || !ref.current) return
    const { width, height } = ref.current.getBoundingClientRect()
    setPos({ left: Math.min(menu.x, innerWidth - width - 4), top: Math.min(menu.y, innerHeight - height - 4) })
    const outside = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) close(null)
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      close(null)
    }
    const blur = (): void => close(null)
    window.addEventListener('mousedown', outside, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('mousedown', outside, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', blur)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu])

  if (!menu) return null
  return (
    <div className="context-menu" ref={ref} style={pos} role="menu" onContextMenu={(e) => e.preventDefault()}>
      {menu.items.map((item, i) =>
        item.type === 'separator' ? (
          <div key={i} className="context-menu-separator" />
        ) : (
          <button
            key={item.id}
            className="context-menu-item"
            role="menuitem"
            disabled={item.enabled === false}
            onClick={() => close(item.id)}
          >
            <span>{item.label}</span>
            {item.keys && <span className="context-menu-keys">{item.keys}</span>}
          </button>
        )
      )}
    </div>
  )
}
