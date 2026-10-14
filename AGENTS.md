# lymux — agent guide

lymux is a terminal multiplexer for Linux (the Linux counterpart to wmux on Windows and cmux on macOS): an Electron +
React + xterm.js desktop app with a workspace sidebar, draggable split panes and session persistence. It was
previously named amux, then lynmux; old saved sessions still load. The README covers features, shortcuts and
architecture for users. This file covers what you need to work on the code.

## Layout

```
src/main/       Electron main process: window, PtyManager (node-pty, one shell per pane id), session.json, git branch
                lookup, plus the dev hooks below (index.ts)
  control.ts           control socket that lets agents drive a running window
  cli.ts / mcp.ts      the `lymux` command (on PATH in every pane) and `lymux mcp`, an MCP server over the same
                       socket; both forward to the methods in src/shared/control.ts so they stay in step
src/preload/    contextBridge exposing window.lymux (typed by LymuxApi in src/shared/types.ts)
src/shared/     types shared by all three: layout tree, Workspace, Session, UiSettings
src/renderer/   React UI
  App.tsx              session state, keyboard shortcuts (capture phase), sidebar modes, zoom
  components/          Sidebar, SplitView (layout tree → panels), TerminalPane (header drag, drop overlays)
  state/layout.ts      pure functions over the layout tree; every edit returns a new tree
  control.ts           renderer side of the control socket (list, split, send, read, wait, ...)
  terminal/            TerminalEngine interface (xterm.js today, libghostty-vt later) + registry that keeps
                       engines alive outside React so re-parenting a pane never loses scrollback
tests/*-e2e.js  end-to-end scripts that run inside the real window
tests/control-test.mjs  CLI + MCP tests against a running app (npm run test:control)
tests/demo.js   scripted demo that screenshots each step for the README video
demo/           Remotion project that animates those stills (see Demo video)
scripts/        demo.sh (builds the demo video)
```

All state lives in one `Session` object in `App.tsx`. It is auto-saved (debounced 1s) to `~/.config/lymux/session.json`.
Add new persisted fields as optional so older sessions still load.

## Commands

```bash
npm run dev          # dev app (passes --no-sandbox: Ubuntu 24.04 AppArmor blocks Chromium's sandbox unpackaged)
npm run typecheck    # tsc for node + web configs; run after every change
npm run test:e2e     # build, run every tests/*-e2e.js in the real window, then the CLI/MCP control tests
npm run dist         # AppImage + .deb into dist/
npx electron-vite build && npx electron-builder --linux deb   # just the .deb (what the user installs)
npm run demo         # demo video: real-app stills → Remotion → dist/lymux-demo.mp4 + docs/demo.gif
```

The user installs releases with `sudo apt install ./dist/lymux_<version>_amd64.deb`.

Resizing goes through `syncSize` in `terminal/registry.ts`. When a pane narrows, the shell is resized before
xterm, so a full-width prompt (powerlevel10k) redraws to fit instead of being reflowed into a leftover copy. Keep
that order if you touch resizing.

## Dev hooks (environment variables, src/main/index.ts)

- `LYMUX_USER_DATA=<dir>`: use a throwaway profile. **Always set this for test and demo runs** so they never touch
  the user's real session.
- `LYMUX_EVAL=<file.js>`: run the script in the renderer after load (delay `LYMUX_EVAL_DELAY`, default 4000ms), print
  `LYMUX_EVAL_RESULT <json>` to stdout, then quit. This is how the e2e tests work. Run one test with:
  `LYMUX_USER_DATA=$(mktemp -d) LYMUX_EVAL=tests/x-e2e.js npx electron . --no-sandbox 2>/dev/null | grep LYMUX_EVAL`
- `LYMUX_SCREENSHOT=<file.png>`: capture the window once, then quit.
- `LYMUX_SHOTS=<dir>`: save a PNG whenever the renderer logs `LYMUX_SHOT <name>` (demo stills).

E2E scripts drive the UI with synthetic DOM events (`DragEvent` with a shared `DataTransfer`, `KeyboardEvent` on
`window`, `mouseover` for hover), then read the result back from `window.lymux.session.load()` after waiting ~1.3s
for the debounced save. New UI behaviour should get an e2e test in this style.

## Conventions

- New user-facing features also go in the README Features section and get a demo scene (`SCRIPT.md`).
- Match the existing style: small pure functions, short comments that say why, no semicolons, single quotes.
- The sidebar footer lists shortcuts and drag hints. Keep it, the README Shortcuts/Features sections and the Roadmap
  in sync with behaviour changes.
- **Releases**: bump the version in `package.json` and both top-level entries in `package-lock.json`, and update the
  versioned install filenames in the README. The commit subject ends with `(vX.Y.Z)`, e.g.
  `Drag to reorder workspaces (v0.5.2)`. Commit or push only when asked.
- Never stash, reset or otherwise move the user's uncommitted work to get a clean build. Ask instead.

## Demo video

`SCRIPT.md` is the scene-by-scene script and says how to add a feature to the demo. Every user-facing feature gets a
scene, updated in the same PR as the feature.

`npm run demo` (scripts/demo.sh) makes `dist/lymux-demo.mp4` and the README's `docs/demo.gif` in three steps:

1. **Stills**: `tests/demo.js` walks through the features in the real app and logs `LYMUX_SHOT <name>`. With
   `LYMUX_SHOTS` set, the main process saves a 1.5x PNG of the window for each one into `dist/demo-shots/`. The script
   also returns per-shot geometry (camera `focus` rect, cursor `from`/`to`, as window fractions), saved as
   `shots.json`.
2. **Animation**: `demo/` is a separate Remotion project with its own package.json. `demo/src/scenes.ts` is the
   story (one scene per shot: caption, keys, how the change happens). `demo/src/Demo.tsx` draws it: the window on a
   gradient, an eased camera zooming on each scene's focus, a cursor gliding/clicking/dragging, keycap captions and
   crossfades between stills. Preview it with `cd demo && npm run studio` (needs `dist/demo-shots/` first).
3. **GIF**: ffmpeg converts the MP4 for the README.

- The story: Claude Code on the left, a dev server top-right. Claude is asked in plain words whether the server
  works, and opens the bottom-right pane itself with the `lymux` CLI. Its run is not scripted, so `tests/demo.js` waits
  for that third pane (up to 3 minutes) and fails if it never appears. Re-run, and check the stills before using a
  run. Keep the prompt natural: no README-reading and no "don't look anything up".
- Keep private details off screen: no account dashboards (ngrok's showed the account email), tokens or emails.
- Shot names in `tests/demo.js` must match `demo/src/scenes.ts`.
- The demo shell starts in `~` and stays there. Don't `cd` into the project or any other directory.
- Show the video camera zooming in and out, not the app's font zoom (`Ctrl +` / `Ctrl 0`).
- Avoid CSS `backdrop-filter` in the composition: headless rendering makes it ~1.5s per frame.
- Remotion versions are pinned in `demo/package.json`. Remotion is free for individuals and small teams; check its
  license before using it in a larger company.

## Environment notes

- Linux only (developed on Ubuntu 24.04, GNOME, Wayland). node-pty is rebuilt for Electron on `npm install`.
- The window is transparent and the renderer paints translucent backgrounds, so desktop blur shows through. Keep
  `body` transparent.
