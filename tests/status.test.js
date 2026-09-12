import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { webcrypto } from 'node:crypto'

for (const scenario of [
  { name: 'connected', value: { protocol: 1, configured: true, version: 'test', actions: ['snapshot'] } },
  { name: 'unconfigured', value: { protocol: 1, configured: false, version: 'test', actions: [] } },
  { name: 'incompatible', value: { protocol: 99 } },
  { name: 'unavailable', error: 'Extension context invalidated' },
]) test(`status reports ${scenario.name} without opening or mounting a browser panel`, async () => {
  let factory, poll, complete
  const effects = [], listeners = new Set()
  const React = { createElement: () => null, useRef: () => ({ current: null }), useSyncExternalStore: (_subscribe, snapshot) => snapshot(), useEffect: fn => effects.push(fn), useLayoutEffect: fn => effects.push(fn) }
  const window = { __ModuleLoader__: { load(value) { factory = value.factory } }, addEventListener: (_name, fn) => listeners.add(fn), removeEventListener: (_name, fn) => listeners.delete(fn), postMessage(message) { queueMicrotask(() => { for (const fn of listeners) fn({ source: window, origin: 'https://dsh.example', data: { source: 'dsh-webview-bridge', id: message.id, value: scenario.value, error: scenario.error } }) }) } }
  const source = (await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')).replace('function Entry(', 'globalThis.TestEntry = function Entry(').replace('let connectionTimeoutMs', 'let connectionTimeoutMs = 1000')
  const context = { window, location: { origin: 'https://dsh.example' }, crypto: webcrypto, setTimeout, clearTimeout, queueMicrotask, setInterval(fn) { poll = fn; return 1 }, clearInterval() {} }
  runInNewContext(source, context)
  factory(name => name === 'react' ? React : { createRoot() { assert.fail('status must not mount a panel') } })
  const archived = { tabs: [{ id: 'saved', url: 'https://page.example/', title: 'saved' }], active: 'saved', open: false }
  const service = { read: async () => ({ ok: true, value: archived }), next: async () => ({ ok: true, value: { token: 'request', action: { action: 'status' }, expiresAt: Date.now() + 10000 } }), complete: async value => { complete = value }, visibility() { assert.fail('status must not change visibility') } }
  context.TestEntry({ sessionId: 'test', service })
  const cleanups = effects.map(fn => fn()).filter(fn => typeof fn === 'function')
  try {
    await poll()
    const result = JSON.parse(complete.text)
    assert.equal(result.visible, false)
    assert.equal(result.metadataSource, 'archive-not-live-page')
    assert.equal(result.extension.state, scenario.name)
    if (scenario.error) assert.equal(result.extension.reason, scenario.error)
    assert.equal(listeners.size, 0, 'handshake listeners are released after every outcome')
    assert.equal(result.tabs[0].id, 'saved')
    assert.equal(complete.token, 'request')
  } finally { for (const cleanup of cleanups) cleanup() }
})
