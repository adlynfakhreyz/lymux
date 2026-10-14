import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // cli.js is the `lymux` command, run as plain Node by the wrapper the app writes at launch.
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts'), cli: resolve('src/main/cli.ts') } } }
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react()] }
})
