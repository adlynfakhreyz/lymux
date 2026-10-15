# Release checklist

Shipping **lymux 0.7** — Markdown and images in a pane, beside the terminal.

## Before tagging

- [x] Typecheck and e2e tests pass
- [x] `lymux open` works from every pane
- [ ] Update the README demo

## Build

```bash
npm run dist   # .deb and AppImage into dist/
```

| Format   | Opens in   | Live reload |
|----------|------------|-------------|
| Markdown | viewer     | yes         |
| Images   | viewer     | yes         |
