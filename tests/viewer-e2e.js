// End-to-end test for file viewer panes, run inside the lymux window via LYMUX_EVAL. It types `lymux open` into the
// first terminal (the real CLI and control socket), works on a copy of tests/fixtures in a temp dir, and checks the
// rendered Markdown, live reload, links, the error state, the viewer's own zoom, a drag swap with the terminal, an
// image viewer and the saved session.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) {
      const v = fn()
      if (v) return v
    }
    return null
  }
  const saved = async () => {
    await sleep(1300) // session save is debounced by 1s
    const s = await window.lymux.session.load()
    return s.workspaces.find((w) => w.id === s.activeWorkspaceId)
  }
  const paneIds = (n) => (n.type === 'pane' ? [n.id] : n.children.flatMap(paneIds))
  const leaves = (n) => (n.type === 'pane' ? [n] : n.children.flatMap(leaves))
  const paneEl = (id) => document.querySelector(`.pane[data-pane-id="${id}"]`)
  const key = (code, mods = {}) =>
    window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true, cancelable: true, ...mods }))
  // The built app loads out/renderer/index.html, so the repo is three levels up.
  const repo = decodeURIComponent(new URL('../..', location.href).pathname).replace(/\/$/, '')
  const out = {}

  const terminal = (await saved()).root.id
  // A scratch copy of the fixtures, so the test can edit and delete files.
  const sh = (cmd) => window.lymux.pty.write(terminal, cmd + '\r')
  const start = `D=$(mktemp -d) && cp -r '${repo}/tests/fixtures/.' "$D/" && lymux open "$D/sample.md"`
  sh(start)
  // A shell still starting up can drop what was typed; type it once more if nothing opened.
  let viewer = await until(() => document.querySelector('.pane-viewer'), 8000)
  if (!viewer) sh(start)
  viewer ??= await until(() => document.querySelector('.pane-viewer'), 10000)
  out.viewerOpened = !!viewer
  if (!viewer) return out
  const id = viewer.dataset.paneId
  const body = () => paneEl(id).querySelector('.markdown-body')
  await until(() => body()?.querySelector('h1'))
  await until(() => body().querySelector('img[data-lymux-src="images/swatch.png"]')?.naturalWidth)

  // Rendering
  out.title = paneEl(id).querySelector('.pane-title').textContent
  out.h1 = body().querySelector('h1')?.textContent
  out.tableRows = body().querySelectorAll('table tbody tr').length
  out.codeHighlighted = body().querySelectorAll('pre code .hljs-keyword').length > 0
  const boxes = [...body().querySelectorAll('.task-list-item input[type=checkbox]')]
  out.taskBoxes = boxes.map((b) => (b.checked ? 'x' : ' ')).join('')
  out.localImageWidth = body().querySelector('img[data-lymux-src="images/swatch.png"]')?.naturalWidth
  out.remoteImageSrc = body().querySelector('img[data-lymux-src^="https:"]')?.getAttribute('src')
  out.noScripts = body().querySelectorAll('script, iframe').length === 0

  // Session saves the view
  let ws = await saved()
  const leaf = leaves(ws.root).find((p) => p.id === id)
  out.savedView = leaf?.view && { kind: leaf.view.kind, file: leaf.view.path.split('/').pop() }
  out.focusedOnOpen = ws.activePaneId === id

  // Zoom: Ctrl+= stays the terminal font; Ctrl+scroll over the viewer and its header buttons zoom the viewer alone
  key('Equal', { ctrlKey: true })
  await sleep(100)
  out.ctrlEqualLeavesViewer = body().style.zoom || '1'
  key('Digit0', { ctrlKey: true })
  const wheel = (deltaY) =>
    body().dispatchEvent(new WheelEvent('wheel', { deltaY, ctrlKey: true, bubbles: true, cancelable: true }))
  wheel(-100)
  wheel(-100)
  await sleep(100)
  out.ctrlScrollZoom = body().style.zoom // two steps
  out.headerZoomLabel = paneEl(id).querySelector('.pane-zoom-level').textContent
  paneEl(id).querySelectorAll('.pane-zoom .pane-button')[2].click()
  await sleep(100)
  out.plusButtonZoom = body().style.zoom
  ws = await saved()
  out.savedZoom = leaves(ws.root).find((p) => p.id === id)?.view?.zoom
  out.terminalFontUnchanged = (await window.lymux.session.load()).ui?.fontSize ?? 13
  paneEl(id).querySelector('.pane-zoom-level').click()
  await sleep(100)
  out.resetZoom = body().style.zoom

  // Live reload keeps the scroll position
  sh(`seq 120 | sed 's/^/- filler line /' >> "$D/sample.md"`)
  const scroller = paneEl(id).querySelector('.viewer-scroll')
  await until(() => scroller.scrollHeight > scroller.clientHeight + 400)
  scroller.scrollTop = 300
  await sleep(100)
  sh(`printf '\\n## Appended live\\n' >> "$D/sample.md"`)
  out.liveReloaded = !!(await until(() => [...body().querySelectorAll('h2')].some((h) => h.textContent === 'Appended live')))
  out.scrollKept = scroller.scrollTop

  // Swap with the terminal by dragging the viewer's header onto its middle
  const before = paneIds((await saved()).root)
  const dt = new DataTransfer()
  const header = paneEl(id).querySelector('.pane-header')
  header.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
  await sleep(150)
  const overlay = paneEl(terminal).querySelector('.drop-overlay')
  const r = overlay.getBoundingClientRect()
  const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }
  overlay.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, ...at }))
  overlay.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, ...at }))
  header.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }))
  await sleep(300)
  ws = await saved()
  out.swapped = JSON.stringify(paneIds(ws.root)) === JSON.stringify([...before].reverse())
  out.contentSurvivedSwap = body()?.querySelector('h1')?.textContent === 'Sample document'
  out.scrollSurvivedSwap = paneEl(id).querySelector('.viewer-scroll').scrollTop

  // A relative link opens the other file in the same pane
  ;[...body().querySelectorAll('a')].find((a) => a.textContent === 'Another file').click()
  out.followedLink = !!(await until(() => body()?.querySelector('h1')?.textContent === 'Other document'))
  ws = await saved()
  out.savedAfterLink = leaves(ws.root).find((p) => p.id === id)?.view?.path.split('/').pop()

  // Missing file: the pane says so, and recovers when the file comes back
  sh(`rm "$D/other.md"`)
  out.missingMessage = await until(() => paneEl(id).querySelector('.viewer-notice')?.textContent)
  sh(`printf '# Back again\\n' > "$D/other.md"`)
  out.recovered = !!(await until(() => body()?.querySelector('h1')?.textContent === 'Back again' && !paneEl(id).querySelector('.viewer-notice')))

  // Images: fitted to the pane, zoomable
  sh(`lymux open "$D/images/swatch.png" -d`)
  const imageEl = await until(() => document.querySelector('.pane-viewer .image-view img[src]'))
  await until(() => imageEl?.naturalWidth)
  out.imageNatural = imageEl && `${imageEl.naturalWidth}x${imageEl.naturalHeight}`
  out.imageTitle = imageEl?.closest('.pane').querySelector('.pane-title').textContent.replace(/\s+/g, ' ')
  const imageWidth = imageEl?.getBoundingClientRect().width
  imageEl?.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true }))
  await sleep(150)
  out.imageZoomGrows = imageEl?.getBoundingClientRect().width > imageWidth
  imageEl?.closest('.pane').querySelector('.pane-close').click()
  await sleep(300)

  // Closing the viewer leaves the terminal
  paneEl(id).querySelector('.pane-close').click()
  for (let i = 0; i < 10; i++) {
    ws = await saved()
    if (ws.root.type === 'pane') break
  }
  out.closed = ws.root.type === 'pane' && ws.root.id === terminal && !document.querySelector('.pane-viewer')
  sh('rm -rf "$D"')
  return out
})()
