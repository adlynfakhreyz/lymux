// Notifications: a short chime, a desktop notification, and a mark on the pane's workspace in the sidebar (App
// listens). Sources: a long command finishing, a program ringing the bell or sending OSC 9/777 (Claude Code), and
// `lymux notify`.

/** One pane can't notify more often than this (a program ringing the bell in a loop). */
const THROTTLE_MS = 2000

const listeners = new Set<(paneId: string) => void>()
const lastByPane = new Map<string, number>()
let sound = true
let audio: AudioContext | null = null

export function setNotificationSound(on: boolean): void {
  sound = on
}

/** Called with the pane id after each notification. Returns an unsubscribe function. */
export function onNotified(cb: (paneId: string) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** `throttle: false` for notifications asked for explicitly (`lymux notify`), which are never dropped. */
export function notify(paneId: string, title: string, body: string, { throttle = true } = {}): void {
  const now = Date.now()
  if (throttle && now - (lastByPane.get(paneId) ?? 0) < THROTTLE_MS) return
  lastByPane.set(paneId, now)
  if (sound) chime()
  window.lymux.notify(title, body, paneId)
  listeners.forEach((cb) => cb(paneId))
}

/** Two soft rising notes, synthesized, so there is no sound file to ship. */
export function chime(): void {
  audio ??= new AudioContext()
  const t = audio.currentTime
  for (const [i, freq] of [880, 1318.5].entries()) {
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    const start = t + i * 0.12
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(0.18, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.45)
    osc.connect(gain).connect(audio.destination)
    osc.start(start)
    osc.stop(start + 0.5)
  }
}

/** "42s", "3m 5s", "1h 2m" */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}
