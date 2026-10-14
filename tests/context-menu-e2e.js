// End-to-end test for the terminal's right-click menu, run inside the lymux window via LYMUX_EVAL: its items, opening a
// selected file path in a viewer, splitting, Escape, and closing a pane from it.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const $ = (sel) => document.querySelector(sel)
  const $$ = (sel) => [...document.querySelectorAll(sel)]
  const until = async (fn, ms = 8000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) if (fn()) return true
    return false
  }
  const labels = () => $$('.context-menu-item').map((b) => b.firstChild.textContent)
  const pick = (label) => $$('.context-menu-item').find((b) => b.firstChild.textContent.startsWith(label))?.click()
  const rightClick = (el, x, y) =>
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }))
  const out = {}

  await sleep(2500)
  const pane = $('.pane')
  const id = pane.dataset.paneId
  const body = pane.querySelector('.terminal-host').parentElement
  const screen = pane.querySelector('.xterm-screen')
  const file = `/tmp/lymux-ctx-${Date.now()}.md`
  window.lymux.pty.write(id, `printf '# Notes\\n' > ${file}; clear; echo ${file}\r`)
  await sleep(1500)

  // Nothing selected: Copy is disabled and there is no Open item.
  const r = screen.getBoundingClientRect()
  rightClick(body, r.left + 300, r.top + 200)
  await until(() => $('.context-menu'))
  out.items = labels()
  out.copyDisabled = $$('.context-menu-item')[0].disabled

  // Escape closes it.
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))
  out.escapeCloses = await until(() => !$('.context-menu'), 2000)

  // Double-click the printed path to select it, then right-click: "Open <name>" opens a viewer beside the terminal.
  const at = { clientX: r.left + 20, clientY: r.top + 8, bubbles: true, cancelable: true, button: 0 }
  for (const detail of [1, 2]) {
    screen.dispatchEvent(new MouseEvent('mousedown', { ...at, detail }))
    screen.dispatchEvent(new MouseEvent('mouseup', { ...at, detail }))
  }
  await sleep(300)
  rightClick(body, r.left + 300, r.top + 200)
  await until(() => $('.context-menu'))
  out.openItem = labels().find((l) => l.startsWith('Open')) ?? null
  pick('Open')
  out.viewerOpened = await until(() => $('.pane-viewer'), 6000)

  // Split Right from the menu, then Close Pane from the new pane's menu. Splits re-mount panes: look elements up again.
  const count = () => $$('.pane').length
  const bodyOf = (paneId) => $(`.pane[data-pane-id="${paneId}"] .terminal-host`)?.parentElement
  const before = count()
  await sleep(800)
  const b2 = bodyOf(id).getBoundingClientRect()
  rightClick(bodyOf(id), b2.left + 60, b2.top + 60)
  await until(() => $('.context-menu'))
  pick('Split Right')
  out.splitAdds = await until(() => count() === before + 1)
  const newest = $$('.pane').find((p) => p.dataset.paneId !== id && p.querySelector('.terminal-host'))
  const nb = newest && bodyOf(newest.dataset.paneId)
  if (nb) {
    await sleep(1200)
    const nr = nb.getBoundingClientRect()
    rightClick(nb, nr.left + 50, nr.top + 50)
    await until(() => $('.context-menu'))
    pick('Close Pane')
    out.closeRemoves = await until(() => count() === before)
  }
  window.lymux.pty.write(id, `rm -f ${file}\r`)
  return out
})()
