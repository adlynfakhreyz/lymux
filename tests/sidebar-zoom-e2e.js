// End-to-end test for zoom, sidebar resizing and sidebar modes. Run inside the lymux window via LYMUX_EVAL.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const ui = async () => {
    await sleep(1300) // session save is debounced by 1s
    return (await window.lymux.session.load()).ui ?? {}
  }
  const key = (code, mods = {}) =>
    window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true, cancelable: true, ...mods }))
  const $ = (sel) => document.querySelector(sel)
  // React derives onMouseEnter/onMouseLeave from native mouseover/mouseout.
  const hover = (el) => el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }))
  const unhover = (el) => el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))
  const out = {}

  // Zoom
  out.noZoomControlInSidebar = !document.querySelector('.zoom-control')
  key('Equal', { ctrlKey: true })
  await sleep(50)
  out.toastShown = $('.zoom-toast')?.textContent
  key('Equal', { ctrlKey: true })
  out.zoomAfterTwoCtrlEquals = (await ui()).fontSize
  out.toastGoneAfterDelay = !$('.zoom-toast')
  key('Equal', { ctrlKey: true })
  out.zoomAfterThirdCtrlEquals = (await ui()).fontSize
  key('Minus', { ctrlKey: true })
  key('Minus', { ctrlKey: true })
  out.zoomAfterTwoCtrlMinus = (await ui()).fontSize
  key('Digit0', { ctrlKey: true })
  out.zoomAfterReset = (await ui()).fontSize

  // Sidebar width: drag the resizer 100px right, then far left (clamped to the minimum)
  const startWidth = $('.sidebar').getBoundingClientRect().width
  const resizer = $('.sidebar-resizer')
  const x0 = resizer.getBoundingClientRect().left
  resizer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x0 }))
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: x0 + 100 }))
  window.dispatchEvent(new MouseEvent('mouseup', {}))
  await sleep(50)
  out.widthBefore = startWidth
  out.widthAfterDragRight100 = $('.sidebar').getBoundingClientRect().width
  out.savedWidth = (await ui()).sidebarWidth
  resizer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x0 }))
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: x0 - 600 }))
  window.dispatchEvent(new MouseEvent('mouseup', {}))
  await sleep(50)
  out.widthClampedMin = $('.sidebar').getBoundingClientRect().width

  // Pinned mode: close with the « button, reopen with Ctrl+Shift+B
  $('.sidebar-collapse').click()
  await sleep(50)
  out.closedShowsRail = !!$('.sidebar-rail') && !$('.sidebar')
  key('KeyB', { ctrlKey: true, shiftKey: true })
  await sleep(50)
  out.reopenedByShortcut = !!$('.sidebar') && !$('.sidebar-rail')

  // Hover mode: pin button switches; sidebar hides, panes take the full width, edge hover reveals it
  $('.sidebar-pin').click()
  await sleep(250)
  out.savedMode = (await ui()).sidebarMode
  const sb = $('.sidebar')
  out.hoverHiddenInitially = sb.classList.contains('sidebar-floating') && !sb.classList.contains('sidebar-peek')
  out.panesFullWidth = Math.round($('.workspace-view').getBoundingClientRect().width) === window.innerWidth
  hover($('.sidebar-hover-zone'))
  await sleep(50)
  out.revealedOnEdgeHover = $('.sidebar').classList.contains('sidebar-peek')
  unhover($('.sidebar'))
  await sleep(400)
  out.hiddenAfterLeave = !$('.sidebar').classList.contains('sidebar-peek')

  // Pin it back
  hover($('.sidebar-hover-zone'))
  await sleep(50)
  $('.sidebar-pin').click()
  await sleep(250)
  out.pinnedAgain = !$('.sidebar').classList.contains('sidebar-floating') && (await ui()).sidebarMode === 'pinned'
  return out
})()
