// The story: one scene per shot from tests/demo.js. `shot` names the still a scene ends on; the scene before it
// supplies the starting picture. Geometry (camera focus, cursor points) comes from shots.json, not from here.

/** How the change in a scene happens, which sets its timing and cursor moves. */
export type Kind = 'intro' | 'key' | 'show' | 'click' | 'double-click' | 'hover' | 'drag' | 'outro'

export interface Scene {
  shot: string
  kind: Kind
  caption: string
  keys?: string[]
}

export const SCENES: Scene[] = [
  { shot: '01-intro', kind: 'intro', caption: 'Claude Code in one pane' },
  { shot: '02-split-right', kind: 'key', caption: 'Split right for a dev server', keys: ['Ctrl', 'Shift', 'D'] },
  { shot: '03-claude-ask', kind: 'show', caption: 'Ask Claude about your server' },
  { shot: '04-claude-opens-pane', kind: 'show', caption: 'Claude opens a pane with the lymux CLI' },
  { shot: '05-claude-answer', kind: 'show', caption: '…and tells you what it found' },
  { shot: '06-swap', kind: 'drag', caption: 'Drop a pane in the middle of another to swap' },
  { shot: '07-dock', kind: 'drag', caption: 'Drop on an edge to dock it there' },
  { shot: '08-new-workspace', kind: 'key', caption: 'New workspace', keys: ['Ctrl', 'Shift', 'N'] },
  { shot: '09-rename', kind: 'double-click', caption: 'Double-click to rename' },
  { shot: '10-split-down', kind: 'key', caption: 'Split down', keys: ['Ctrl', 'Shift', 'E'] },
  { shot: '11-reorder', kind: 'drag', caption: 'Drag to reorder workspaces' },
  { shot: '12-switch-workspace', kind: 'key', caption: 'Switch workspace', keys: ['Ctrl', 'PgUp / PgDn'] },
  { shot: '13-auto-hide', kind: 'click', caption: 'Auto-hide the sidebar' },
  { shot: '14-slide-out', kind: 'hover', caption: 'It slides out at the left edge' },
  { shot: '15-pin-back', kind: 'click', caption: 'Pin it back' },
  { shot: '15-pin-back', kind: 'outro', caption: '' }
]

/** Frame timings per kind (30 fps): scene length, cursor glide, and when the change happens. */
export const TIMING: Record<Kind, { frames: number; move?: [number, number]; action: number }> = {
  // Title card with the icon, then the window comes in.
  intro: { frames: 130, move: [80, 115], action: 0 },
  key: { frames: 105, action: 30 },
  show: { frames: 120, action: 20 },
  click: { frames: 90, move: [6, 34], action: 40 },
  'double-click': { frames: 95, move: [6, 34], action: 40 },
  hover: { frames: 90, move: [6, 40], action: 40 },
  // Drag: glide to the handle, press, glide to the drop point (preview appears), release at `action`.
  drag: { frames: 125, move: [6, 30], action: 86 },
  outro: { frames: 120, action: 0 }
}
/** Intro: the title card holds, then fades as the window rises in. */
export const INTRO_CARD_OUT: [number, number] = [45, 70]
export const DRAG_MOVE: [number, number] = [38, 72]
export const DRAG_PREVIEW: [number, number] = [56, 64]
