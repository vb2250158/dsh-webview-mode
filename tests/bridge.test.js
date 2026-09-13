import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

async function loadBridge(trustedOrigins) {
  const posted = []
  const sent = []
  const listeners = []
  const window = { addEventListener(_name, fn) { listeners.push(fn) }, postMessage(message) { posted.push(message) } }
  window.top = window
  const chrome = {
    storage: { sync: { get: async () => ({ trustedOrigins }) }, onChanged: { addListener() {} } },
    runtime: {
      id: 'test-extension',
      getManifest: () => ({ version: '0.2.2' }),
      onMessage: { addListener() {} },
      sendMessage: async request => { sent.push(request); return { value: { forwarded: request.kind } } },
    },
  }
  runInNewContext(await readFile(new URL('../extension/bridge.js', import.meta.url), 'utf8'), { window, chrome, location: { origin: 'https://dsh.example' } })
  const deliver = request => Promise.all([...listeners].map(fn => fn({ source: window, origin: 'https://dsh.example', data: { source: 'dsh-webview-client', id: 'request-1', request } })))
  return { posted, sent, deliver }
}

test('an unauthorized origin is answered only by the handshake and may only open the options page', async () => {
  const bridge = await loadBridge([])
  await bridge.deliver({ kind: 'snapshot' })
  assert.deepEqual(bridge.sent, [], 'page operations never reach the worker')
  assert.deepEqual(bridge.posted, [], 'a denied request is not answered at all')
  await bridge.deliver({ kind: 'status' })
  assert.deepEqual(bridge.sent, [], 'the handshake is answered by the content script itself')
  assert.equal(bridge.posted[0].source, 'dsh-webview-bridge')
  assert.equal(bridge.posted[0].id, 'request-1')
  assert.equal(bridge.posted[0].value.configured, false)
  assert.equal(bridge.posted[0].value.id, 'test-extension', 'the id lets the settings page deep-link to this extension')
  assert.equal(bridge.posted[0].value.actions.length, 0)
  await bridge.deliver({ kind: 'open-options' })
  assert.deepEqual(bridge.sent, [{ kind: 'open-options' }], 'the options page stays reachable before authorization')
  assert.equal(bridge.posted.at(-1).value.forwarded, 'open-options')
})

test('a trusted origin forwards every request and relays the worker outcome', async () => {
  const bridge = await loadBridge(['https://dsh.example'])
  await bridge.deliver({ kind: 'snapshot' })
  assert.deepEqual(bridge.sent, [{ kind: 'snapshot' }])
  assert.equal(bridge.posted.at(-1).value.forwarded, 'snapshot')
  assert.equal(bridge.posted.at(-1).id, 'request-1')
  await bridge.deliver({ kind: 'status' })
  assert.equal(bridge.sent.length, 2, 'a trusted origin reaches the worker for the handshake too')
})
