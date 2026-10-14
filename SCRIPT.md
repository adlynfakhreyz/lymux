# Demo script

The scene-by-scene script for the README video (`docs/demo.gif`, full quality in `dist/lymux-demo.mp4`). Like the
README, it is a living document: **every user-facing feature gets a scene**, and this file changes in the same PR as
the feature.

## How the video is made

`npm run demo` (`scripts/demo.sh`) runs three steps:

1. **Stills from the real app.** `tests/demo.js` drives a lymux window at 1.5x scale with a throwaway profile. At each
   step it logs `LYMUX_SHOT <name>`, and the main process saves a PNG of the window (`LYMUX_SHOTS`). It also returns
   per-shot geometry (`focus`: what the camera frames; `from`/`to`: cursor points) as `shots.json`.
2. **Animation.** `demo/` is a Remotion project. `demo/src/scenes.ts` lists the scenes, and `demo/src/Demo.tsx` draws
   them: the window on a gradient, a camera easing in on each scene's focus, a cursor that glides, clicks and drags,
   caption pills with keycaps, and crossfades between stills.
3. **GIF** for the README, made by ffmpeg from the MP4.

Each scene below is one shot in `tests/demo.js` and one entry in `demo/src/scenes.ts`, with the same name.
"Kind" sets the scene's timing and motion (`TIMING` in `scenes.ts`, 30 fps):

| Kind | Length | What it animates |
|---|---|---|
| `intro` | 4.3s | Title card (icon, name, tagline), then the window rises in |
| `key` | 3.5s | Keycaps light up, the picture changes, then the camera moves to what changed |
| `show` | 4s | The picture changes (output arriving, an agent acting), then the camera moves to what changed |
| `click` / `double-click` | 3s | Cursor glides to the target and clicks (ripples) |
| `hover` | 3s | Cursor glides to the target; the picture changes on arrival |
| `drag` | 4.2s | Cursor grabs, drags (drop preview appears), releases |
| `outro` | 4s | Title card with the GitHub link over the dimmed window |

## Rules

- The shell starts in `~` and stays there. No `cd` into the project.
- Use commands a developer would really run, not filler like `ls` or `uptime`. Each pane should have a reason to exist.
- Agent prompts are natural, like the user would really type them. Don't hint ("no need to look anything up") and don't
  feed the agent the README.
- Show the video camera zooming, not the app's font zoom.
- Nothing private on screen: no account pages or dashboards (ngrok's showed the account email), no tokens or emails.
  Check the stills in `dist/demo-shots/` before using a run.
- Claude's part is not scripted, so its exact words and commands change between runs. `tests/demo.js` waits for the
  result (e.g. the pane Claude opens) and fails if it never comes; just run it again.

## Scenes

Layout for scenes 1–7: **Claude Code tall on the left, the dev server top-right, the pane Claude opens bottom-right.**

| # | Shot | Kind | On screen | Caption / keys | Feature |
|---|---|---|---|---|---|
| 1 | `01-intro` | intro | Title card (cat icon, "lymux", "A terminal multiplexer for Linux"), then the window with `claude` started in the only pane | Claude Code in one pane | — |
| 2 | `02-split-right` | key | Split right; the new pane runs `python3 -m http.server 8000`. Camera moves to it | Split right for a dev server · Ctrl Shift D | Split panes |
| 3 | `03-claude-ask` | show | The prompt is typed into Claude: *"is my server on :8000 working? use lymux to open a pane under it that keeps checking it"* | Ask Claude about your server | — |
| 4 | `04-claude-opens-pane` | show | Claude curls the server, reads `lymux help`, and runs `lymux split -p <server> --down --cmd …`. A pane appears under the server, running a check loop that prints `200` and response times, while the server log fills with requests. Camera zooms on the new pane | Claude opens a pane with the lymux CLI | **Agent control** (`lymux split`, `lymux wait`, `lymux read`) |
| 5 | `05-claude-answer` | show | Claude answers in its own words (server is up, which pane it opened, how to stop it). Camera on Claude | …and tells you what it found | Agent control |
| 6 | `06-swap` (+ `-preview`) | drag | Drag the server pane's header onto the middle of Claude's pane; the swap target shows, then they swap | Drop a pane in the middle of another to swap | Drag to swap |
| 7 | `07-dock` (+ `-preview`) | drag | Drag that pane onto the server's bottom edge; back to the 3-pane layout | Drop on an edge to dock it there | Drag to dock |
| 8 | `08-new-workspace` | key | A second workspace appears in the sidebar. Camera on the sidebar | New workspace · Ctrl Shift N | Workspaces |
| 9 | `09-rename` | double-click | Double-click the new workspace and rename it to `scratch` | Double-click to rename | Rename |
| 10 | `10-split-down` | key | Split down inside `scratch` | Split down · Ctrl Shift E | Split panes |
| 11 | `11-reorder` (+ `-preview`) | drag | Drag `scratch` above `main`; an insertion line shows where it lands | Drag to reorder workspaces | Workspace reorder |
| 12 | `12-switch-workspace` | key | Switch to `main` and back | Switch workspace · Ctrl PgUp / PgDn | Workspace switching |
| 13 | `13-auto-hide` | click | Click the pin; the sidebar hides and the panes take the full width | Auto-hide the sidebar | Sidebar modes |
| 14 | `14-slide-out` | hover | Pointer to the left edge; the sidebar slides out over the panes | It slides out at the left edge | Sidebar modes |
| 15 | `15-pin-back` | click | Click the pin again | Pin it back | Sidebar modes |
| 16 | `15-pin-back` | outro | Title card: icon, "lymux", github.com/adlynfakhreyz/lymux | — | — |

Total ≈ 60s. Features shown in every frame without a scene of their own: translucency, bundled fonts and prompt glyphs,
the cwd/branch in the sidebar, and session restore (not filmable in one run; mentioned in the README).

### Planned scenes

| Shot | Kind | On screen | Caption | Feature | Status |
|---|---|---|---|---|---|
| `NN-file-viewer` | show | From a pane, `lymux open notes.md` (then a PDF and a spreadsheet) opens a viewer pane in a split, rendered beside the terminal | Open PDFs, spreadsheets and Markdown in a pane | File viewer pane | **Planned:** `lymux open` shows a PDF, Markdown file or spreadsheet in a split. Write the full scene from what ships, once it merges. |

## Adding a feature to the demo

1. **Write the scene here first**: a row in the Scenes table (or move it out of Planned). Name the shot, the kind,
   what happens on screen, the caption (and keys), and the feature. Put it where it fits the story, and keep the
   whole video around a minute: merge or trim scenes rather than only adding.
2. **Drive it in `tests/demo.js`.** Do the action the way a user would (keyboard shortcut via `press`, drag via
   `drag`/`dragPane`, a command via `run`, an agent prompt typed into the Claude pane), wait for the result, then
   `await shot('NN-name', { focus, to, from })`:
   - `focus`: the rect the camera should frame after the change (`rect(el)`, `paneTop(id)`), or omit it for the whole window.
   - `to` / `from`: where the cursor goes (`point(el, fx, fy)`); drags record them for you.
   - Wait on real state (`panes(n)`, a selector appearing), not fixed sleeps, when the timing varies.
3. **Add the scene to `demo/src/scenes.ts`** with the same shot name, a kind and the caption. A new kind of motion
   needs a `TIMING` entry and handling in `demo/src/Demo.tsx`.
4. **Renumber** the shots after it in both files, in order.
5. **Run `npm run demo`**, look through `dist/demo-shots/` (nothing private; the scene shows what it says), and watch
   `dist/lymux-demo.mp4`. `cd demo && npm run studio` previews changes to the animation without re-shooting.
6. Commit `SCRIPT.md`, `tests/demo.js`, `demo/src/scenes.ts` and the new `docs/demo.gif` with the feature. Upload the
   MP4 to the release.

### Example: agent control

Scene 4 is the pattern for showing anything an agent does through lymux. The user's prompt goes into the Claude pane,
and Claude decides the commands, typically:

```bash
lymux list                                                     # find the server's pane
P=$(lymux split -p <server> --down --cmd 'while true; do curl …; sleep 5; done' -d)
lymux wait -p "$P" --idle 6 --timeout 15                       # let it print
lymux read -p "$P" --lines 6                                   # and read it back
```

`tests/demo.js` doesn't script those commands. It waits until the third pane exists (`panes(3, 180000)`), so the
split "appears by itself". For a scripted version that needs no agent (e.g. for CI), run the same commands with
`api.pty.write` into a pane instead of typing a prompt.
