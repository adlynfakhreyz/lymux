// Integration test for the control socket: launches lymux with a throwaway profile, drives it with the generated
// `lymux` CLI (what agents get on PATH) and its MCP server, and checks the results and the saved session.
// Run after a build: node tests/control-test.mjs
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import electron from 'electron'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const profile = mkdtempSync(join(tmpdir(), 'lymux-control-'))
const cli = join(profile, 'bin', 'lymux')
const app = spawn(electron, ['.', '--no-sandbox'], {
  env: { ...process.env, LYMUX_USER_DATA: profile, LYMUX_PANE_ID: '', LYMUX_SOCKET: '' },
  stdio: 'ignore'
})

/** Run the CLI (in tests/fixtures, so relative file paths work); resolves { code, out, err } (never rejects). */
const lymux = (args, env = {}) =>
  new Promise((resolve) =>
    execFile(cli, args, { cwd: fixtures, env: { ...process.env, LYMUX_PANE_ID: '', LYMUX_SOCKET: '', ...env } }, (error, out, err) =>
      resolve({ code: error ? (error.code ?? 1) : 0, out: out.trim(), err: err.trim() })
    )
  )
const ok = async (...args) => {
  const r = await lymux(...args)
  assert.equal(r.code, 0, `lymux ${args[0].join(' ')} failed: ${r.err}`)
  return r.out
}
const json = async (args, env) => JSON.parse(await ok([...args, '--json'], env))
/** The saved session once it satisfies `ready`: saves are debounced by 1s, and the cwd poll can push them back. */
const saved = async (ready) => {
  let s
  for (let i = 0; i < 20; i++) {
    await sleep(500)
    s = JSON.parse(readFileSync(join(profile, 'session.json'), 'utf8'))
    if (ready(s)) break
  }
  return s
}

/** The split whose children include pane `id`. */
const parentOf = (node, id) =>
  node.type === 'split' && (node.children.some((c) => c.id === id) ? node : node.children.map((c) => parentOf(c, id)).find(Boolean))

const results = []
const check = async (name, fn) => {
  try {
    await fn()
    results.push(`ok   ${name}`)
  } catch (err) {
    results.push(`FAIL ${name}: ${err.message}`)
  }
}

try {
  // The app writes the wrapper at launch; the socket answers once the session has loaded.
  for (let i = 0; i < 60 && !(existsSync(cli) && (await lymux(['list'])).code === 0); i++) await sleep(500)

  const first = await json(['list'])
  const [ws1] = first.workspaces
  const p1 = ws1.panes[0].id
  let p2, p3, ws2, p4

  await check('list shows one workspace with one pane', () => {
    assert.equal(first.workspaces.length, 1)
    assert.equal(ws1.panes.length, 1)
  })

  await check('split focuses the new pane; -d keeps focus', async () => {
    p2 = await ok(['split', '--right'])
    p3 = await ok(['split', '-p', p2, '--down', '-d'])
    const tree = await json(['tree'])
    assert.equal(tree.activePaneId, p2)
    assert.equal(tree.root.dir, 'row')
    assert.deepEqual(tree.root.children[1].children.map((c) => c.id), [p2, p3])
  })

  await check('send --enter --wait returns the command output', async () => {
    const r = await lymux(['send', '-p', p2, 'echo lymux-$((6*7))', '--enter', '--wait', '^lymux-42$', '--timeout', '20'])
    assert.equal(r.code, 0, r.err)
    assert.match(r.out, /^lymux-42$/m)
  })

  await check('read returns screen text', async () => {
    assert.match(await ok(['read', '-p', p2]), /^lymux-42$/m)
    assert.match(await ok(['read', '-p', p2, '--lines', '50']), /^lymux-42$/m)
  })

  await check('keys types named keys; wait --screen sees it', async () => {
    await ok(['keys', '-p', p3, 'e', 'c', 'h', 'o', 'Space', 'k', 'e', 'y', 's', '-', 'o', 'k', 'Enter'])
    const r = await lymux(['wait', '-p', p3, '--for', '^keys-ok$', '--screen', '--timeout', '20'])
    assert.equal(r.code, 0, r.err)
  })

  await check('panes see LYMUX_PANE_ID and the CLI on PATH', async () => {
    const r = await lymux(['send', '-p', p3, 'lymux current --json', '--enter', '--wait', `"pane":"${p3}"`, '--timeout', '20'])
    assert.equal(r.code, 0, r.err)
  })

  await check('the caller pane is the default target', async () => {
    assert.equal((await json(['current'], { LYMUX_PANE_ID: p3 })).pane, p3)
    assert.equal((await json(['current'])).pane, p2) // outside lymux: the focused pane
  })

  await check('new-workspace -d runs a command in a hidden pane', async () => {
    const r = await json(['new-workspace', '--name', 'agents', '--cwd', '/tmp', '-d', '--cmd', 'echo hidden-$((1+1))'])
    ws2 = r.workspace
    p4 = r.pane
    const list = await json(['list'])
    assert.equal(list.activeWorkspaceId, ws1.id)
    assert.equal(list.workspaces[1].name, 'agents')
    await ok(['wait', '-p', p4, '--for', '^hidden-2$', '--screen', '--timeout', '20'])
    assert.match(await ok(['send', '-p', p4, 'pwd', '--enter', '--wait', '^/tmp$', '--timeout', '20']), /^\/tmp$/m)
  })

  await check('wait times out with exit 1', async () => {
    const r = await lymux(['wait', '-p', p1, '--for', 'never-printed-xyz', '--timeout', '1'])
    assert.equal(r.code, 1)
    assert.match(r.err, /timed out/)
  })

  await check('wait --idle returns once output stops', async () => {
    const r = await lymux(['send', '-p', p1, 'echo a; sleep 0.3; echo b', '--enter', '--idle', '1.5', '--timeout', '20'])
    assert.equal(r.code, 0, r.err)
    assert.match(r.out, /^b$/m)
  })

  await check('rename, select, move, resize, focus, close', async () => {
    await ok(['rename-workspace', 'agents', 'bots'])
    await ok(['select-workspace', 'bots'])
    assert.equal((await json(['list'])).activeWorkspaceId, ws2)
    await ok(['move-pane', '-p', p3, '--to', p1, '--left'])
    await ok(['resize-pane', '-p', p1, '30'])
    await ok(['focus', p1])
    // Wait for a save that has all of it: an earlier save can already have ws1 active but not the new name.
    let s = await saved((s) => s.activeWorkspaceId === ws1.id && s.workspaces[1]?.name === 'bots' && s.workspaces[0].root.children?.[0]?.id === p3)
    assert.equal(s.activeWorkspaceId, ws1.id)
    assert.equal(s.workspaces[1].name, 'bots')
    const root = s.workspaces[0].root
    assert.deepEqual(root.children.map((c) => c.id), [p3, p1, p2])
    assert.equal(Math.round(root.sizes[1]), 30)
    await ok(['close-pane', p3])
    await ok(['close-workspace', 'bots'])
    s = await saved((s) => s.workspaces.length === 1)
    assert.equal(s.workspaces.length, 1)
    assert.deepEqual(s.workspaces[0].root.children.map((c) => c.id), [p1, p2])
  })

  await check('errors exit 1 with a message', async () => {
    const r = await lymux(['focus', 'nope'])
    assert.equal(r.code, 1)
    assert.match(r.err, /no pane "nope"/)
    assert.match((await lymux(['frobnicate'])).err, /unknown command/)
  })

  let v1
  await check('open shows a file beside the pane, relative to the cwd; read returns its source', async () => {
    v1 = await ok(['open', 'sample.md', '-p', p1, '--down', '-d'])
    const tree = await json(['tree'])
    assert.notEqual(tree.activePaneId, v1) // -d keeps focus
    assert.deepEqual(parentOf(tree.root, v1).children.map((c) => c.id), [p1, v1])
    const pane = (await json(['list'])).workspaces[0].panes.find((p) => p.id === v1)
    assert.equal(pane.kind, 'viewer')
    assert.equal(pane.view, 'markdown')
    assert.equal(pane.file, join(fixtures, 'sample.md'))
    assert.match(await ok(['list']), /sample\.md {2}\[markdown\]/)
    assert.match(await ok(['read', '-p', v1]), /^# Sample document$/m)
    const s = await saved((s) => JSON.stringify(s).includes('sample.md'))
    const leaf = parentOf(s.workspaces[0].root, v1).children[1]
    assert.deepEqual(leaf.view, { path: join(fixtures, 'sample.md'), kind: 'markdown' })
  })

  await check('opening an open file focuses it; --reuse replaces the last focused viewer', async () => {
    const again = await json(['open', join(fixtures, 'sample.md'), '-p', p2])
    assert.equal(again.pane, v1)
    assert.equal(again.existing, true)
    assert.equal((await json(['tree'])).activePaneId, v1)
    const reused = await json(['open', 'other.md', '--reuse', '-p', p2])
    assert.equal(reused.pane, v1)
    assert.match(await ok(['read', '-p', v1]), /^# Other document$/m)
    const fresh = await ok(['open', 'images/swatch.png', '-p', p2, '-d'])
    assert.notEqual(fresh, v1)
    assert.match(await ok(['read', '-p', fresh]), /swatch\.png: image, 48×24 px/)
    await ok(['close-pane', fresh])
  })

  await check('reload; terminal-only commands refuse viewers', async () => {
    await ok(['reload', '-p', v1])
    assert.match((await lymux(['reload', '-p', p1])).err, /is not a file viewer/)
    for (const args of [['send', '-p', v1, 'hi'], ['keys', '-p', v1, 'Enter'], ['wait', '-p', v1, '--for', 'x', '--timeout', '1'], ['send', '-p', v1, 'x', '--wait', 'x']]) {
      const r = await lymux(args)
      assert.equal(r.code, 1, args.join(' '))
      assert.match(r.err, new RegExp(`pane ${v1} is a file viewer`))
    }
  })

  await check('open rejects missing and unsupported files', async () => {
    assert.match((await lymux(['open', 'nope.md'])).err, /File not found: .*nope\.md/)
    assert.match((await lymux(['open', 'notes.txt'])).err, /Unsupported file type/)
    await ok(['close-pane', v1])
  })

  await check('mcp: initialize, list tools, call one', async () => {
    const mcp = spawn(cli, ['mcp'], { env: { ...process.env, LYMUX_PANE_ID: p2, LYMUX_SOCKET: '' } })
    const replies = []
    let buf = ''
    mcp.stdout.on('data', (d) => {
      buf += d
      for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
        replies.push(JSON.parse(buf.slice(0, nl)))
        buf = buf.slice(nl + 1)
      }
    })
    const send = (m) => mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n')
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } })
    send({ method: 'notifications/initialized' })
    send({ id: 2, method: 'tools/list' })
    send({ id: 3, method: 'tools/call', params: { name: 'send_text', arguments: { text: 'echo via-mcp', enter: true, wait_for: '^via-mcp$', timeout: 20 } } })
    send({ id: 4, method: 'tools/call', params: { name: 'focus_pane', arguments: { pane: 'nope' } } })
    send({ id: 5, method: 'tools/call', params: { name: 'open_file', arguments: { path: join(fixtures, 'sample.md'), background: true } } })
    for (let i = 0; i < 100 && replies.length < 5; i++) await sleep(250)
    mcp.stdin.end()
    const byId = Object.fromEntries(replies.map((r) => [r.id, r]))
    assert.equal(byId[1].result.serverInfo.name, 'lymux')
    assert.ok(byId[2].result.tools.some((t) => t.name === 'split_pane'))
    const sent = JSON.parse(byId[3].result.content[0].text)
    assert.equal(sent.pane, p2) // defaults to the agent's own pane
    assert.equal(sent.matched, 'via-mcp')
    assert.equal(byId[4].result.isError, true)
    assert.ok(byId[2].result.tools.some((t) => t.name === 'open_file'))
    assert.ok(byId[2].result.tools.some((t) => t.name === 'reload_pane'))
    const opened = JSON.parse(byId[5].result.content[0].text)
    assert.match(await ok(['read', '-p', opened.pane]), /^# Sample document$/m)
  })
} finally {
  app.kill('SIGTERM')
  await sleep(1500)
}

await check('socket removed on quit', () => assert.ok(!existsSync(join(profile, 'control.sock'))))

console.log(results.join('\n'))
const failed = results.filter((r) => r.startsWith('FAIL')).length
console.log(failed ? `${failed} failed` : `all ${results.length} passed`)
process.exitCode = failed ? 1 : 0
