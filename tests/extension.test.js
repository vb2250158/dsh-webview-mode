import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { webcrypto } from 'node:crypto'

test('bridge manages only its own tabs and restores conversation-specific URLs', async () => {
  const tabs = new Map([[99, { id: 99, url: 'https://private.example/', title: 'Existing user tab' }]])
  const captures = []
  let listener, saved = {}, next = 100
  const chrome = {
    storage: { session: { get: async () => structuredClone(saved), set: async value => { saved = structuredClone(value) } } },
    tabs: {
      create: async ({ url }) => { const tab = { id: next++, url, title: 'Browser tab' }; tabs.set(tab.id, tab); return tab },
      get: async id => { if (!tabs.has(id)) throw new Error('Closed'); return tabs.get(id) },
      update: async (id, value) => Object.assign(tabs.get(id), value),
      remove: async id => tabs.delete(id),
    },
    debugger: {
      attach: async ({ tabId }) => { assert.notEqual(tabId, 99) },
      sendCommand: async ({ tabId }, method) => { captures.push(tabId); return { data: 'frame' } },
      onDetach: { addListener() {} },
    },
    runtime: { getManifest: () => ({ version: '0.1.0' }), onMessage: { addListener(value) { listener = value } } },
  }
  runInNewContext(await readFile(new URL('../extension/worker.js', import.meta.url), 'utf8'), { chrome, crypto: webcrypto, URL, console })
  const empty = sessionId => ({ version: 1, sessionId, revision: 0, tabs: [], active: null })
  const call = request => new Promise(resolve => listener(request, { tab: { id: 1 }, frameId: 0, url: 'http://127.0.0.1:3180/' }, resolve))
  const ping = await call({ action: 'ping' })
  assert.equal(ping.value.connected, true)
  assert.equal(tabs.size, 1)
  const first = (await call({ sessionId: 'a', archive: empty('a'), action: 'frame' })).value
  const second = (await call({ sessionId: 'b', archive: empty('b'), action: 'frame' })).value
  assert.notEqual(first.active, second.active)
  const failure = await call({ sessionId: 'a', archive: empty('a'), action: 'select', tabId: second.active })
  assert.match(failure.error, /已经关闭/)
  const restored = (await call({ sessionId: 'c', archive: { ...empty('c'), active: 'saved', tabs: [{ id: 'saved', url: 'https://example.com/', title: 'Saved' }] }, action: 'frame' })).value
  assert.equal(restored.tabs[0].url, 'https://example.com/')
  assert.ok(captures.every(id => id !== 99))
  assert.equal(listener({}, { tab: { id: 99 }, frameId: 0, url: 'https://example.com/' }, () => {}), false)
})
