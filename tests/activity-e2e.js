// End-to-end test for pane activity, notifications and auto-close, run inside the lymux window via LYMUX_EVAL.
// Checks the sidebar's busy dot and command name, the "done" mark that a finished long command, a bell and an OSC 9
// notification leave on a background workspace, and that a pane closes when its shell exits cleanly but stays open
// after an error exit. (Desktop popups are skipped for throwaway LYMUX_USER_DATA profiles; the sound is muted first.)
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const $ = (sel) => document.querySelector(sel)
  const $$ = (sel) => [...document.querySelectorAll(sel)]
  const key = (code, mods = { ctrlKey: true, shiftKey: true }) =>
    window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true, cancelable: true, ...mods }))
  const until = async (fn, ms = 15000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) if (fn()) return true
    return false
  }
  const panes = () => $$('.pane').map((p) => p.dataset.paneId)
  const run = (id, cmd) => window.lymux.pty.write(id, cmd + '\r')
  const items = () => $$('.workspace')
  const out = {}

  await sleep(2500)
  $('.sidebar-sound').click() // mute the notification sound
  await sleep(300)
  out.soundMuted = !!$('.icon-button-off')

  // Activity: a running command shows a pulsing dot and its name.
  const [a] = panes()
  run(a, 'sleep 4')
  out.busyDot = await until(() => $('.workspace-status-busy'), 4000)
  out.runningName = $('.workspace-running')?.textContent.includes('sleep') ?? false
  out.idleAfter = await until(() => !$('.workspace-status-busy'), 8000)

  // Clean exit closes the pane; an error exit leaves it open with the code.
  key('KeyD')
  await until(() => panes().length === 2)
  await sleep(1500)
  run(panes()[1], 'exit')
  out.cleanExitCloses = await until(() => panes().length === 1, 6000)
  key('KeyD')
  await until(() => panes().length === 2)
  await sleep(1500)
  run(panes()[1], 'exit 3')
  await sleep(2500)
  out.errorExitStays = panes().length === 2

  // Notifications mark a background workspace: a long command finishing, a bell, an OSC 9 notification.
  run(a, 'sleep 11') // runs while we look at another workspace
  key('KeyN')
  await until(() => items().length === 2)
  out.longCommandMarksWorkspace = await until(() => items()[0].querySelector('.workspace-status-done'), 16000)
  items()[0].click()
  out.markClearsOnVisit = await until(() => !items()[0].querySelector('.workspace-status-done'), 3000)

  items()[1].click()
  await sleep(800)
  run(a, "sleep 1; printf '\\a'")
  out.bellMarksWorkspace = await until(() => items()[0].querySelector('.workspace-status-done'), 6000)
  items()[0].click()
  await sleep(800)
  items()[1].click()
  await sleep(2500) // past the per-pane throttle
  run(a, "sleep 1; printf '\\e]9;tests passed\\a'")
  out.oscNotificationMarksWorkspace = await until(() => items()[0].querySelector('.workspace-status-done'), 6000)
  return out
})()
