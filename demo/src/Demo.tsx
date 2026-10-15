import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from 'remotion'
import { DRAG_MOVE, DRAG_PREVIEW, INTRO_CARD_OUT, SCENES, TIMING, type Scene } from './scenes'

interface Point {
  x: number
  y: number
}
interface Rect extends Point {
  w: number
  h: number
}
/** Geometry tests/demo.js records per shot, as fractions of the window. */
interface ShotMeta {
  focus?: Rect | null
  from?: Point
  to?: Point
}
export interface DemoProps extends Record<string, unknown> {
  data: { width: number; height: number; shots: Record<string, ShotMeta> } | null
}

const W = 1920
const H = 1080
const WINDOW_W = W * 0.84
const MAX_ZOOM = 1.9
const CAMERA_FRAMES = 26
const ACCENT = '#7aa2f7'
const FONT = "'Inter', 'Ubuntu', 'Noto Sans', system-ui, sans-serif"

const ease = Easing.bezier(0.45, 0, 0.2, 1)
/** 0 → 1 between frames f0 and f1, eased and clamped. */
const tween = (f: number, f0: number, f1: number): number =>
  interpolate(f, [f0, f1], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease })
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k
const lerpPoint = (a: Point, b: Point, k: number): Point => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) })

interface Camera {
  x: number
  y: number
  zoom: number
}

/** Precomputed per scene: where it starts, its camera, and the cursor's start and end. */
interface Planned extends Scene {
  start: number
  camera: Camera
  cursorFrom: Point
  cursorTo: Point
  before: string
}

export function Demo({ data }: DemoProps): React.JSX.Element | null {
  const frame = useCurrentFrame()
  if (!data) return null

  // Window placement on the 1920x1080 stage.
  const winH = WINDOW_W * (data.height / data.width)
  const win = { x: (W - WINDOW_W) / 2, y: (H - winH) / 2 - 24 }
  const toStage = (p: Point): Point => ({ x: win.x + p.x * WINDOW_W, y: win.y + p.y * winH })

  const fit = (focus?: Rect | null): Camera => {
    if (!focus) return { x: W / 2, y: H / 2, zoom: 1 }
    const tl = toStage(focus)
    const w = focus.w * WINDOW_W
    const h = focus.h * winH
    const zoom = Math.max(1, Math.min(MAX_ZOOM, W / (w * 1.35), H / (h * 1.35)))
    const half = { x: W / 2 / zoom, y: H / 2 / zoom }
    return {
      x: Math.min(Math.max(tl.x + w / 2, half.x), W - half.x),
      y: Math.min(Math.max(tl.y + h / 2, half.y), H - half.y),
      zoom
    }
  }

  // Plan every scene in order: each starts where the previous one left the cursor and the picture.
  const plan: Planned[] = []
  let start = 0
  let cursor: Point = toStage({ x: 0.62, y: 0.6 })
  for (const [i, s] of SCENES.entries()) {
    const meta = data.shots[s.shot] ?? {}
    const preview = data.shots[`${s.shot}-preview`]
    const to = s.kind === 'drag' ? preview?.to : meta.to
    const cursorTo = to && s.kind !== 'key' && s.kind !== 'outro' ? toStage(to) : cursor
    plan.push({
      ...s,
      start,
      camera: fit(s.kind === 'outro' ? null : meta.focus),
      cursorFrom: cursor,
      cursorTo,
      before: i === 0 ? s.shot : SCENES[i - 1].shot
    })
    cursor = cursorTo
    start += TIMING[s.kind].frames
  }

  const index = plan.findLastIndex((p) => p.start <= frame)
  const scene = plan[index]
  const f = frame - scene.start
  const t = TIMING[scene.kind]
  const preview = data.shots[`${scene.shot}-preview`]

  // Camera: ease from the previous scene's framing, zooming in log space so it feels even.
  const prevCam = index > 0 ? plan[index - 1].camera : scene.camera
  // Keyboard and "show" steps change the picture first, then the camera moves to what changed (it may be a pane that
  // didn't exist before); pointer steps frame the target first.
  const camStart = scene.kind === 'key' || scene.kind === 'show' ? t.action + 4 : 0
  const kc = tween(f, camStart, camStart + CAMERA_FRAMES)
  const cam: Camera = {
    x: lerp(prevCam.x, scene.camera.x, kc),
    y: lerp(prevCam.y, scene.camera.y, kc),
    zoom: Math.exp(lerp(Math.log(prevCam.zoom), Math.log(scene.camera.zoom), kc))
  }

  // Cursor path and button state.
  let pos = scene.cursorFrom
  let pressed = 0
  if (scene.kind === 'drag' && preview?.from) {
    const grab = toStage(preview.from)
    pos = lerpPoint(lerpPoint(scene.cursorFrom, grab, tween(f, ...t.move!)), scene.cursorTo, tween(f, ...DRAG_MOVE))
    pressed = f >= 34 && f < t.action ? 1 : 0
  } else if (t.move) {
    pos = lerpPoint(scene.cursorFrom, scene.cursorTo, tween(f, ...t.move))
  }
  const clicks = scene.kind === 'click' ? [t.action] : scene.kind === 'double-click' ? [t.action, t.action + 7] : []
  for (const c of clicks) if (f >= c - 2 && f < c + 3) pressed = 1

  // Pictures: the previous still, then (for drags) the drop preview, then this scene's still.
  const fade = scene.kind === 'hover' ? 12 : 6
  const afterIn = scene.kind === 'intro' || scene.kind === 'outro' ? 1 : tween(f, t.action + 2, t.action + 2 + fade)
  const previewIn = scene.kind === 'drag' ? tween(f, ...DRAG_PREVIEW) : 0

  const lit = scene.kind === 'key' && f >= t.action - 2 && f < t.action + 12
  const captionIn = tween(f, 0, 10) * (1 - tween(f, t.frames - 6, t.frames))

  // Title cards: the intro card gives way to the window; the outro card settles over it.
  const windowIn = scene.kind === 'intro' ? tween(f, ...INTRO_CARD_OUT) : 1
  const card = scene.kind === 'intro' ? 1 - windowIn : scene.kind === 'outro' ? tween(f, 10, 40) : 0

  return (
    <AbsoluteFill style={{ background: 'linear-gradient(135deg, #1f2a5e 0%, #3a2a66 50%, #682a5c 100%)', overflow: 'hidden' }}>
      <AbsoluteFill
        style={{
          transformOrigin: '0 0',
          transform: `translate(${W / 2 - cam.x * cam.zoom}px, ${H / 2 - cam.y * cam.zoom}px) scale(${cam.zoom})`,
          opacity: windowIn * (1 - 0.65 * (scene.kind === 'outro' ? card : 0)),
          translate: `0 ${(1 - windowIn) * 60}px`
        }}
      >
        <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 20% 10%, rgba(120,150,255,0.35), transparent 60%)' }} />
        <div
          style={{
            position: 'absolute',
            left: win.x,
            top: win.y,
            width: WINDOW_W,
            height: winH,
            borderRadius: 14,
            overflow: 'hidden',
            // The app is translucent (desktop blur shows through it); a soft tint stands in for the blur, which is
            // too slow to render with backdrop-filter.
            background: 'rgba(24, 26, 44, 0.55)',
            boxShadow: '0 30px 90px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.12)'
          }}
        >
          <Still name={scene.before} opacity={1} />
          {scene.kind === 'drag' && <Still name={`${scene.shot}-preview`} opacity={previewIn} />}
          <Still name={scene.shot} opacity={afterIn} />
        </div>
        {clicks.map((c) => (
          <Ripple key={c} at={pos} progress={(f - c) / 14} zoom={cam.zoom} />
        ))}
        <Cursor at={pos} zoom={cam.zoom} pressed={pressed} />
      </AbsoluteFill>
      {scene.caption && (scene.kind !== 'intro' || windowIn > 0) && (
        <Caption text={scene.caption} keys={scene.keys} lit={lit} opacity={captionIn * windowIn} />
      )}
      {card > 0 && (
        <TitleCard
          opacity={card}
          subtitle={scene.kind === 'intro' ? 'A terminal multiplexer for Linux' : 'github.com/adlynfakhreyz/lymux'}
        />
      )}
    </AbsoluteFill>
  )
}

/** The cat icon, the name and one line under it, centred on the stage. */
function TitleCard({ opacity, subtitle }: { opacity: number; subtitle: string }): React.JSX.Element {
  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 18,
        opacity,
        transform: `scale(${0.96 + 0.04 * opacity})`,
        fontFamily: FONT,
        color: '#f0f0f5'
      }}
    >
      <Img src={staticFile('icon.png')} style={{ width: 260, height: 260, filter: 'drop-shadow(0 20px 50px rgba(0,0,0,0.45))' }} />
      <div style={{ fontSize: 104, fontWeight: 700, letterSpacing: '0.02em' }}>lymux</div>
      <div style={{ fontSize: 36, color: 'rgba(240,240,245,0.75)' }}>{subtitle}</div>
    </AbsoluteFill>
  )
}

function Still({ name, opacity }: { name: string; opacity: number }): React.JSX.Element | null {
  if (opacity <= 0) return null
  return <Img src={staticFile(`${name}.png`)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity }} />
}

/** Arrow cursor, kept close to a constant on-screen size while the camera zooms. */
function Cursor({ at, zoom, pressed }: { at: Point; zoom: number; pressed: number }): React.JSX.Element {
  const scale = (1 / Math.sqrt(zoom)) * (1 - 0.15 * pressed)
  return (
    <svg
      width={34}
      height={50}
      viewBox="-2 -2 17 25"
      style={{
        position: 'absolute',
        left: at.x - 3,
        top: at.y - 3,
        transformOrigin: '3px 3px',
        transform: `scale(${scale})`,
        filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.45))'
      }}
    >
      <path d="M0 0 L0 16 L4.2 12.4 L7 18.6 L9.6 17.4 L6.9 11.4 L12 11.4 Z" fill="#fff" stroke="#16161c" strokeWidth={1.2} strokeLinejoin="round" />
    </svg>
  )
}

function Ripple({ at, progress, zoom }: { at: Point; progress: number; zoom: number }): React.JSX.Element | null {
  if (progress < 0 || progress > 1) return null
  const r = (8 + 26 * ease(progress)) / Math.sqrt(zoom)
  return (
    <div
      style={{
        position: 'absolute',
        left: at.x - r,
        top: at.y - r,
        width: r * 2,
        height: r * 2,
        borderRadius: '50%',
        border: `${3 / Math.sqrt(zoom)}px solid rgba(255,255,255,${0.75 * (1 - progress)})`
      }}
    />
  )
}

function Caption({ text, keys = [], lit, opacity }: { text: string; keys?: string[]; lit: boolean; opacity: number }): React.JSX.Element {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 46 - (1 - opacity) * 12,
        display: 'flex',
        justifyContent: 'center',
        opacity
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '14px 30px',
          borderRadius: 999,
          background: 'rgba(18,18,26,0.82)',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.14), 0 12px 40px rgba(0,0,0,0.35)',
          color: '#f0f0f5',
          fontFamily: FONT,
          fontSize: 30,
          fontWeight: 500
        }}
      >
        <span>{text}</span>
        {keys.length > 0 && (
          <span style={{ display: 'flex', gap: 8 }}>
            {keys.map((k) => (
              <kbd
                key={k}
                style={{
                  fontFamily: FONT,
                  fontSize: 23,
                  fontWeight: 700,
                  padding: '5px 14px',
                  borderRadius: 8,
                  background: lit ? ACCENT : 'rgba(255,255,255,0.15)',
                  color: lit ? '#101018' : '#f0f0f5',
                  boxShadow: '0 0 0 1px rgba(255,255,255,0.28)',
                  transform: lit ? 'translateY(1px)' : 'none'
                }}
              >
                {k}
              </kbd>
            ))}
          </span>
        )}
      </div>
    </div>
  )
}
