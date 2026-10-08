import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { webcrypto } from 'node:crypto'

async function harness(savedTabs = [], storageFailure = false, url = 'https://dsh.test') {
  let factory
  const listeners = new Map()
  const window = { __ModuleLoader__: { load(entry) { factory = entry.factory } },
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) }
  const context = { window, URL, location: new URL(url), crypto: webcrypto,
    setTimeout, clearTimeout, setInterval, clearInterval, console }
  const source = (await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'))
    .replace('function createSidebarAdapter(', 'globalThis.TestAdapter = function createSidebarAdapter(')
  runInNewContext(source, context)
  factory(() => ({ createElement() {} }))
  let session = 's', active, expanded = false, sequence = 0, reads = 0
  const records = [], actions = [], markers = new Map()
  const sidebar = {
    mounted: { getSnapshot: () => session }, tabsIn: () => records,
    active: () => records.find(tab => tab.id === active), isExpanded: () => expanded,
    toggleExpanded() { expanded = !expanded },
    openTab(kind, options) { const tab = { id: `tab-${++sequence}`, kind, title: options.params.url || 'Browser' }; records.push(tab); active = tab.id; expanded = true; actions.push(['open', options.params.url]) },
    focus(id) { active = id; actions.push(['focus', id]) },
    close(id) { records.splice(records.findIndex(tab => tab.id === id), 1); actions.push(['close', id]) },
  }
  const browser = {
    read: () => ({ frame: { target: { url: 'https://example.test/', title: 'Example' }, address: 'requested' } }),
    navigate: (sid, id, url) => actions.push(['navigate', sid, id, url]),
    reload: (sid, id) => actions.push(['reload', sid, id]), messageTarget: () => undefined,
  }
  const saved = { version: 1, sessionId: 's', open: false, revision: 9, active: savedTabs[0]?.id || null, tabs: savedTabs }
  const service = { read: async () => { reads++; return { ok: true, value: saved } }, next: async () => ({ ok: true, value: { active: true } }) }
  const storage = { getItem: key => markers.get(key) ?? null, setItem(key, value) { if (storageFailure) throw new Error('Storage failed'); markers.set(key, value) } }
  const adapter = context.TestAdapter(sidebar, browser, service, storage)
  const command = action => adapter.command('s', { action, token: 'test', expiresAt: Date.now() + 1000 })
  return { adapter, command, saved, records, actions, markers, listeners, get reads() { return reads }, setSession(value) { session = value }, sidebar, browser }
}

test('Desktop navigation and status do not probe Chrome; DOM commands report the missing public guest API', async () => {
  const h = await harness([], false, 'dsh-app://app/')
  try {
    await h.command({ action: 'new', url: 'https://a.test/' })
    await h.command({ action: 'navigate', url: 'https://next.test/' })
    await h.command({ action: 'reload' })
    const state = await h.command({ action: 'status' })
    assert.equal(state.carrier, 'desktop')
    assert.equal(state.dom.state, 'unsupported')
    assert.equal(state.extension.state, 'not-applicable')
    for (const action of ['snapshot', 'click', 'text', 'choose', 'scroll']) await assert.rejects(h.command({ action }), /public Sidebar Browser guest API/)
    h.setSession('other')
    await assert.rejects(h.command({ action: 'reload' }), /not on screen/)
  } finally { h.adapter.dispose() }
})

test('imports saved tabs once, retains the archive and translates old ids into official navigation', async () => {
  const original = [{ id: 'old-a', url: 'https://a.test/', title: 'A' }, { id: 'old-b', url: 'about:blank', title: 'B' }]
  const h = await harness(original)
  try {
    await Promise.all([h.adapter.migrate('s'), h.adapter.migrate('s')])
    assert.equal(h.reads, 1)
    assert.equal(h.records.length, 2)
    assert.equal(h.sidebar.active().id, 'tab-1')
    assert.equal(h.sidebar.isExpanded(), false)
    assert.deepEqual(h.saved.tabs, original)
    assert.equal(h.saved.revision, 9)
    await h.command({ action: 'select', tabId: 'old-b' })
    assert.equal(h.sidebar.active().id, 'tab-2')
    assert.equal(h.sidebar.isExpanded(), true)
    await h.command({ action: 'navigate', url: 'https://next.test/' })
    assert.ok(h.actions.some(action => action[0] === 'navigate' && action[2] === 'tab-2'))
    await h.command({ action: 'reload' })
    assert.ok(h.actions.some(action => action[0] === 'reload' && action[2] === 'tab-2'))
    await h.command({ action: 'close', tabId: 'old-b' })
    await h.adapter.migrate('s')
    assert.equal(h.records.length, 1)
  } finally { h.adapter.dispose() }
  assert.equal(h.listeners.size, 0)
})

test('a failed migration checkpoint removes only its new tab and preserves all source data', async () => {
  const h = await harness([{ id: 'old', url: 'https://a.test/', title: 'A' }], true)
  try {
    await assert.rejects(h.adapter.migrate('s'), /Storage failed/)
    assert.equal(h.records.length, 0)
    assert.equal(h.saved.tabs.length, 1)
    assert.equal(h.saved.revision, 9)
    await assert.rejects(h.adapter.migrate('s'), /Storage failed/)
    assert.equal(h.records.length, 0)
  } finally { h.adapter.dispose() }
})

test('uses official tab creation and refuses cross-Session commands and unavailable DOM bridges', async () => {
  const h = await harness()
  try {
    await h.command({ action: 'new', url: 'https://a.test/' })
    assert.equal(h.records.length, 1)
    await assert.rejects(h.command({ action: 'new', url: 'javascript:alert(1)' }), /Unsupported browser URL/)
    await assert.rejects(h.command({ action: 'new', url: 'https://user:pass@a.test/' }), /Unsupported browser URL/)
    await assert.rejects(h.command({ action: 'new', url: 'https://dsh.test/' }), /Unsupported browser URL/)
    await assert.rejects(h.command({ action: 'snapshot' }), /not visible/)
    h.setSession('other')
    await assert.rejects(h.command({ action: 'reload' }), /not on screen/)
    h.setSession('s')
    h.adapter.dispose()
    await assert.rejects(h.command({ action: 'new' }), /unloaded/)
  } finally { h.adapter.dispose() }
})
