// Scripted demo, run by scripts/demo.sh with LYMUX_EVAL + LYMUX_SHOTS. It walks through the features, screenshots
// each step, and returns where things are in every shot: `focus` (what the camera should frame) and the cursor's
// `from`/`to` points, as fractions of the window. demo/ (Remotion) animates the stills from that.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const api = window.lymux
  const $ = (sel) => document.querySelector(sel)
  const $$ = (sel) => [...document.querySelectorAll(sel)]

  const rect = (el, fh = 1) => {
    const r = el.getBoundingClientRect()
    return { x: r.left / innerWidth, y: r.top / innerHeight, w: r.width / innerWidth, h: (r.height * fh) / innerHeight }
  }
  const point = (el, fx = 0.5, fy = 0.5) => {
    const r = el.getBoundingClientRect()
    return { x: (r.left + r.width * fx) / innerWidth, y: (r.top + r.height * fy) / innerHeight }
  }

  const shots = {}
  /** Let the UI settle, then ask the main process to save a screenshot. */
  const shot = async (name, meta = {}) => {
    await sleep(500)
    console.log(`LYMUX_SHOT ${name}`)
    shots[name] = meta
    await sleep(600) // capture is async; don't change the UI under it
  }
  const press = (code, mods = {}) =>
    window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true, cancelable: true, ...mods }))

  const paneEl = (id) => $(`.pane[data-pane-id="${id}"]`)
  /** Pane ids of the active workspace, once the (debounced) saved session has `count` panes on screen. */
  const panes = async (count, timeoutMs = 30000) => {
    for (const end = Date.now() + timeoutMs; ; ) {
      if (Date.now() > end) throw new Error(`expected ${count} panes in the active workspace`)
      await sleep(300)
      const s = await api.session.load()
      const ws = s?.workspaces.find((w) => w.id === s.activeWorkspaceId)
      const ids = (n) => (n.type === 'pane' ? [n.id] : n.children.flatMap(ids))
      const list = ws ? ids(ws.root) : []
      if (list.length === count && list.every(paneEl)) return list
    }
  }
  /** The top-left part of a pane, where a fresh shell's prompt and output appear. */
  const paneTop = (id) => {
    const r = rect(paneEl(id))
    return { ...r, w: Math.min(r.w, 0.45), h: Math.min(r.h, 0.4) }
  }
  const run = async (id, command) => {
    await sleep(1500) // a fresh shell (and its prompt) needs a moment before it takes input
    api.pty.write(id, command + '\r')
    await sleep(1000)
  }

  // Native drag-and-drop; the preview shot is taken while the drop target is highlighted.
  const drag = async (handle, dropEl, fx, fy, name, focus = null) => {
    const from = point(handle)
    const dt = new DataTransfer()
    handle.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
    await sleep(200)
    const target = dropEl()
    const r = target.getBoundingClientRect()
    const client = { clientX: r.left + r.width * fx, clientY: r.top + r.height * fy }
    const to = { x: client.clientX / innerWidth, y: client.clientY / innerHeight }
    const at = { bubbles: true, cancelable: true, dataTransfer: dt, ...client }
    target.dispatchEvent(new DragEvent('dragover', at))
    await shot(`${name}-preview`, { focus, from, to })
    target.dispatchEvent(new DragEvent('drop', at))
    handle.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }))
    await shot(name, { focus, to })
  }
  const dragPane = (src, target, fx, fy, name) =>
    drag(paneEl(src).querySelector('.pane-header'), () => paneEl(target).querySelector('.drop-overlay'), fx, fy, name)

  // Story: Claude Code on the left, a dev server top-right. Asked in plain words whether the server works, Claude
  // opens the bottom-right pane itself through the lymux CLI (on PATH in every pane) and reports back.
  await sleep(1500)
  const [a] = await panes(1)
  await run(a, 'claude')
  await shot('01-intro', { to: point(paneEl(a), 0.5, 0.5) })

  press('KeyD', { ctrlKey: true, shiftKey: true })
  const [, b] = await panes(2)
  await run(b, 'python3 -m http.server 8000')
  await shot('02-split-right', { focus: paneTop(b) })

  const claudeTop = () => ({ ...rect(paneEl(a)), h: 0.6 })
  for (const ch of 'is my server on :8000 working? use lymux to open a pane under it that keeps checking it') {
    api.pty.write(a, ch)
    await sleep(15)
  }
  await shot('03-claude-ask', { focus: claudeTop(), to: point(paneEl(a), 0.4, 0.3) })
  api.pty.write(a, '\r')
  // Claude decides how; wait for the pane it opens, then give it time to answer.
  const c = (await panes(3, 180000)).find((id) => id !== a && id !== b)
  await sleep(6000)
  await shot('04-claude-opens-pane', { focus: paneTop(c) })
  await sleep(20000)
  await shot('05-claude-answer', { focus: claudeTop() })

  // Swap the server and the pane Claude opened, then dock that pane back under the server.
  await dragPane(b, c, 0.5, 0.5, '06-swap')
  await dragPane(c, b, 0.5, 0.88, '07-dock')

  const sidebarTop = () => rect($('.sidebar'), 0.4)
  press('KeyN', { ctrlKey: true, shiftKey: true })
  await shot('08-new-workspace', { focus: sidebarTop() })

  const fresh = $$('.workspace').at(-1)
  const nameAt = point(fresh.querySelector('.workspace-name'), 0.3)
  fresh.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  await sleep(300)
  const input = $('.workspace-rename')
  input.value = 'scratch'
  // React's onBlur listens for focusout; blur() alone does nothing when the window lacks OS focus.
  input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  await shot('09-rename', { focus: sidebarTop(), to: nameAt })

  press('KeyE', { ctrlKey: true, shiftKey: true })
  const [top, scratch] = await panes(2)
  await shot('10-split-down', { focus: rect(paneEl(scratch)) })

  // File viewer: Markdown beside the shell, then live reload. scripts/demo.sh copies demo/notes.md to /tmp/lymux-demo.
  const viewer = () => $('.pane-viewer')
  await run(top, 'lymux open /tmp/lymux-demo/notes.md')
  for (let i = 0; i < 40 && !viewer(); i++) await sleep(250)
  await shot('11-file-viewer', { focus: rect(viewer()) })
  await run(scratch, "echo '- [x] Film the demo' >> /tmp/lymux-demo/notes.md")
  await sleep(800)
  await shot('12-live-reload', { focus: rect(viewer()) })

  // Right-click menu on the bottom terminal.
  const body = $(`.pane[data-pane-id="${scratch}"] .terminal-host`).parentElement
  const at = point(body, 0.35, 0.45)
  body.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: at.x * innerWidth, clientY: at.y * innerHeight, button: 2 })
  )
  await sleep(300)
  await shot('13-context-menu', { focus: { ...rect($('.context-menu')), w: rect($('.context-menu')).w * 1.6 }, to: at })
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))

  await drag($$('.workspace').at(-1), () => $$('.workspace')[0], 0.5, 0.15, '14-reorder', sidebarTop())

  // A long command keeps running in scratch while you switch to main; when it ends, scratch gets the green dot.
  await run(scratch, 'sleep 12 && echo done')
  press('PageDown', { ctrlKey: true })
  await shot('15-switch-workspace', { focus: sidebarTop() })
  for (let i = 0; i < 100 && !$$('.workspace')[0].querySelector('.workspace-status-done'); i++) await sleep(250)
  await shot('16-notified', { focus: sidebarTop(), to: point($$('.workspace')[0], 0.3) })

  // Back to scratch (that clears the dot), and `exit` closes the pane.
  $$('.workspace')[0].click()
  await sleep(600)
  await run(scratch, 'exit')
  for (let i = 0; i < 40 && paneEl(scratch); i++) await sleep(250)
  await shot('17-exit-closes', { focus: rect($('.workspace-view')) })

  const pin = () => $('.sidebar-pin')
  const pinAt = point(pin())
  const header = rect($('.sidebar-header'))
  pin().click() // unpin: auto-hide mode
  await shot('18-auto-hide', { focus: { ...header, w: header.w * 1.6, h: header.h * 4 }, to: pinAt })
  $('.sidebar-hover-zone').dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }))
  await shot('19-slide-out', { to: { x: 0.003, y: 0.4 } })
  const pinBack = point(pin())
  pin().click() // pin again
  await shot('20-pin-back', { to: pinBack })
  return { width: innerWidth, height: innerHeight, shots }
})()
