# Spec: file viewer panes (PDF, spreadsheets, Markdown)

Status: **draft for review**. Nothing is implemented yet. Target: v0.7.0.

## Problem

Coding agents (and people) keep producing files you want to look at next to the terminal: a README an agent just
wrote, a PDF report, a CSV of test results, an Excel sheet from a client. Today you leave lymux to open them, and the
agent has no way to show you something. cmux has a built-in browser pane for the same reason.

## Goal

A pane can show a file instead of a shell. It sits in the layout like any terminal pane, so it can be split, dragged,
docked, swapped, resized and closed, and it is saved and restored with the session. It is read-only. Opening one is a
single command, so agents can use it too:

```bash
lymux open docs/report.pdf            # opens beside the current pane
lymux open results.xlsx --down -d     # below, without taking focus
lymux open README.md                  # rendered Markdown, re-renders when the file changes
```

## Formats

| Kind | Extensions | Renders as | Library |
|---|---|---|---|
| Markdown | `.md` `.markdown` | GitHub-style: headings, tables, task lists, code blocks with syntax colour, images, links | `markdown-it` + `highlight.js`, sanitized with `DOMPurify` |
| PDF | `.pdf` | Pages in a continuous scroll, selectable text, fit-to-width | `pdfjs-dist` (Mozilla pdf.js) |
| Spreadsheet | `.xlsx` `.xls` `.ods` `.csv` `.tsv` | A grid with column letters and row numbers, one tab per sheet | SheetJS Community Edition (`xlsx`, Apache-2.0) |

All three are loaded with dynamic `import()` the first time a viewer of that kind opens, so startup time and memory for
people who never open a file stay the same.

## User experience

**Opening a file**

1. `lymux open <file> [--right|--left|--down|--up] [-d] [-p PANE]`. Same placement rules as `lymux split`: it goes
   next to `-p` (by default your own pane) and takes focus unless `-d` is given. Prints the new pane id.
2. **Ctrl+click a file path in a terminal**. lymux detects paths ending in a supported extension in terminal output
   (like `ls` output or an agent saying "wrote docs/plan.md") and opens them to the right. Relative paths resolve
   against the pane's current directory.
3. **Drag a file from the file manager onto a pane**: the existing drop overlay appears, and the file opens on the
   edge you drop it on.

If the file is already open in this workspace, it is focused instead of opened twice.

**The viewer pane**

- The header looks like a terminal pane's: a drag grip, then the file name and kind (`README.md · Markdown`), then
  buttons: reload, open in the default app, close.
- Markdown and spreadsheet views **re-render when the file changes on disk** (debounced 200ms) and keep their scroll
  position, so you can watch an agent write a document. PDFs reload only from the reload button, because PDFs are often
  rewritten in several steps.
- Zoom (Ctrl+= / Ctrl+- / Ctrl+0 and Ctrl+scroll) zooms the **focused** viewer by itself. When a terminal is focused it
  keeps changing the terminal font size as it does today.
- Links in Markdown open in the default browser. Relative links to other supported files open in the same viewer pane.
  Images load from relative paths next to the file.
- Spreadsheets: sheet tabs along the bottom, a sticky header row and column, and cells shown as their formatted values
  (dates, percentages). Formulas show their cached result. The grid is virtualized, so 100k-row CSVs scroll smoothly.
- PDF: page counter (`3 / 12`) in the header and continuous scroll. Ctrl+F search is phase 2.
- Theme: Markdown and spreadsheets use the app's dark translucent style. PDF pages stay white (they are documents), on
  the translucent pane background.
- Missing or unreadable file: the pane stays and says so (`File not found: ~/x/report.pdf`), and reload tries again.
  This also covers a restored session whose file was deleted.

## Agent control (CLI and MCP)

| CLI | MCP tool | Does |
|---|---|---|
| `lymux open FILE [--right\|...] [-d] [-p PANE]` | `open_file` | Open a viewer pane; returns its pane id |
| `lymux read -p VIEWER` | `read_pane` | Returns the file's text: Markdown source, PDF text page by page, a sheet as TSV (`--sheet NAME`) |
| `lymux reload -p VIEWER` | `reload_pane` | Re-read the file |
| `lymux list` | `list_workspaces` | Viewer panes appear with `kind: "viewer"` and their file instead of a cwd |

`send`, `keys` and `wait` on a viewer pane return a clear error ("pane X is a file viewer").

## Design

**Layout and session.** A pane leaf gets an optional `view` field. Sessions without it load as terminals, so old
sessions still load (per AGENTS.md):

```ts
type LayoutNode =
  | { type: 'pane'; id: string; cwd?: string; view?: { path: string; kind: 'markdown' | 'pdf' | 'sheet' } }
  | { type: 'split'; ... }
```

`SplitView` renders `ViewerPane` for leaves with a `view`, and `TerminalPane` otherwise. All layout functions (split,
move, swap, remove) already treat leaves generically, so drag, dock and swap work unchanged. A viewer pane never spawns a
pty. The cwd poll and `meta` skip viewer panes.

**Keeping state across re-mounts.** Splitting re-parents panes and re-mounts their components. Like the terminal
registry, a small viewer registry keeps each viewer's rendered DOM and scroll position alive outside React.

**File access (main process).** The renderer cannot read files itself, and it shouldn't be able to read arbitrary
ones. New IPC:

- `file:open(path)`: checks the path exists and is a regular file of a supported kind, records it as allowed, and
  returns `{ path, kind, size, mtime }`
- `file:read(path)`: returns the bytes, only for allowed paths (the opened file, plus images in its folder for Markdown)
- `file:watch(path)` / `file:unwatch(path)`: `fs.watch` with a debounce; sends `file:changed` to the renderer
- `file:openExternal(path)`: `shell.openPath`

Size limit: 50 MB for PDFs and 25 MB for spreadsheets and Markdown. Above that, the pane offers "open in the default app"
instead.

**Security.** Markdown HTML is sanitized (no scripts, iframes or event handlers), and the renderer gets a CSP that blocks
remote scripts. Remote images in Markdown are blocked by default, with a "load remote images" button, so opening a file
does not phone home. Links go through `shell.openExternal` for `http(s)` only. pdf.js runs with scripting disabled and
its worker bundled locally.

**Bundle size.** About +3.5 MB unpacked (pdf.js 2.5 MB, SheetJS 1 MB, markdown-it and highlight.js 0.4 MB). The .deb is
~100 MB today, so this adds about 3%.

## Phases

1. **Viewer pane plus Markdown**: the `view` field, `ViewerPane`, viewer registry, file IPC, live reload, `lymux open`,
   `read`, `reload`, the MCP tools, and an e2e test. This is the foundation, and Markdown is what agents produce most.
2. **PDF**: pdf.js viewer, page counter, zoom, text for `read`.
3. **Spreadsheets**: SheetJS plus a virtualized grid, sheet tabs, TSV for `read`.
4. **Opening from the UI**: Ctrl+click file paths in terminal output, and dragging files in from the file manager.
5. Later: Ctrl+F search in all three, images (`.png .jpg .svg`), Mermaid diagrams in Markdown, an HTML preview.

Each phase is its own PR and minor version, with a new demo scene in SCRIPT.md and README updates (Features, Shortcuts,
Agents and scripts).

## Testing

- `tests/viewer-e2e.js` (LYMUX_EVAL): open fixture files (`tests/fixtures/sample.md`, `.pdf`, `.xlsx`, `.csv`) and check
  the rendered DOM (a heading, a table, a page canvas, cell text). Drag a viewer pane to swap with a terminal. Check
  that the session saves and restores `view`.
- `tests/control-test.mjs`: `lymux open`, `read` on each kind, `reload`, the error from `send` on a viewer, and
  `open_file` over MCP.
- Live reload: append to the Markdown fixture and check the new text appears without the scroll position jumping.

## Out of scope

Editing files, Word/PowerPoint (`.docx`, `.pptx`), a general web browser pane, and viewers in a separate window.

## Open questions for you

1. **Placement default.** Should `lymux open` and Ctrl+click open to the right (like split), or reuse an existing viewer
   pane in the workspace, so a second file replaces the first instead of adding panes?
2. **Zoom keys.** Is "zoom follows the focused pane" right, or should Ctrl+= stay terminal-only and viewers get their own
   zoom (e.g. Ctrl+scroll only)?
3. **PDF live reload.** Off by default, as written, or on?
4. **Remote images in Markdown.** Blocked until you click, as written, or always load?
5. **More formats in phase 1?** Images are nearly free to add once the pane exists.
