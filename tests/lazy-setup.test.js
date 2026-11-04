import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { webcrypto } from 'node:crypto'

const source = await readFile(process.env.DSH_WEBVIEW_TEST_CLIENT || new URL('../lib/client.js', import.meta.url), 'utf8')
const settle = () => new Promise(resolve => setImmediate(resolve))
const config = (connectionTimeoutMs = 1234) => ({ ok: true, value: { connectionTimeoutMs, extensionDirectory: 'C:/actual-extension' } })

async function harness({ setup = async () => config(), url = 'https://dsh.test' } = {}) {
  let factory, setupCalls = 0, mountDisposals = 0, clock = 1000, cursor = 0
  const hooks = [], effectQueue = [], componentStops = [], ownerStops = []
  const slots = new Map(), events = new Map(), messages = [], timers = []
  const listeners = new Set()
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }),
    useState(initial) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = initial
      return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value }]
    },
    useEffect(effect, dependencies) {
      const index = cursor++
      const previous = hooks[index]
      if (previous && dependencies.every((value, i) => value === previous[i])) return
      hooks[index] = dependencies
      effectQueue.push(effect)
    },
  }
  const window = {
    __ModuleLoader__: { load(entry) { factory = entry.factory } },
    addEventListener(_type, callback) { listeners.add(callback) },
    removeEventListener(_type, callback) { listeners.delete(callback) },
    postMessage(message) {
      messages.push(message)
      queueMicrotask(() => {
        for (const receive of [...listeners]) receive({ source: window, origin: 'https://dsh.test', data: {
          source: 'dsh-webview-bridge', id: message.id, value: { protocol: 1, configured: true, version: '0.2.3', actions: [] },
        } })
      })
    },
  }
  runInNewContext(source, {
    window, location: new URL(url), crypto: webcrypto, localStorage: {}, AbortController,
    Date: { now: () => clock }, console,
    setTimeout(callback, delay) { const timer = { callback, delay, at: clock + delay, active: true }; timers.push(timer); return timer },
    clearTimeout(timer) { if (timer) timer.active = false }, setInterval() { throw new Error('Apply must not start task polling') }, clearInterval() {},
  })
  const plugin = factory(name => { assert.equal(name, 'react'); return React })
  const service = { setup() { setupCalls++; return setup() } }
  const ctx = {
    remote: { async $mount() { return () => { mountDisposals++ } } },
    reflect: { get: name => name === 'remote.webviewArchive' ? service : undefined },
    sidebarRight: { mounted: { getSnapshot: () => 's' }, tabsIn: () => [], active: () => undefined, isExpanded: () => false },
    sidebarBrowser: {},
    effect(install) { const stop = install(); if (typeof stop === 'function') ownerStops.push(stop) },
    on(name, callback) {
      const callbacks = events.get(name) || new Set()
      callbacks.add(callback); events.set(name, callbacks)
      const stop = () => { callbacks.delete(callback) }
      ownerStops.push(stop)
      return stop
    },
    slots: {
      inject(_name, install) { install() },
      register(options, component) { slots.set(options.name, { options, component }); return () => slots.delete(options.name) },
    },
  }
  const opening = plugin.apply(ctx)
  const api = {
    opening, messages, timers, hooks, listeners,
    get setupCalls() { return setupCalls },
    get mountDisposals() { return mountDisposals },
    get slotCount() { return slots.size },
    get activeTimers() { return timers.filter(timer => timer.active) },
    readSetup() { return slots.get('plugins.bundle.config').options.inject().readSetup() },
    status(expiresAt = 9000) { return slots.get('conversation.session.header.utilities').options.inject().adapter.command('s', { action: { action: 'status' }, expiresAt }) },
    renderSetup() {
      const seat = slots.get('plugins.bundle.config')
      cursor = 0
      return seat.component(seat.options.inject())
    },
    runEffects() { for (const effect of effectQueue.splice(0)) { const stop = effect(); if (typeof stop === 'function') componentStops.push(stop) } },
    closeSetup() { for (const stop of componentStops.splice(0)) stop() },
    reset() { for (const callback of events.get('connection/reset') || []) callback() },
    advanceClock(value) {
      clock = value
      for (const timer of [...timers]) {
        if (timer.active && timer.at <= clock) { timer.active = false; timer.callback() }
      }
    },
    async dispose() {
      api.closeSetup()
      for (const stop of ownerStops.splice(0).reverse()) stop()
      const stop = await opening
      stop?.()
    },
  }
  return api
}

function find(node, predicate) {
  if (!node || typeof node !== 'object') return undefined
  if (predicate(node)) return node
  for (const child of node.children || []) { const found = find(child, predicate); if (found) return found }
}

test('activation does not read setup and registers UI while setup could remain pending', async () => {
  const pending = Promise.withResolvers()
  const h = await harness({ setup: () => pending.promise })
  let activated = false
  void h.opening.then(() => { activated = true })
  try {
    await settle()
    assert.equal(activated, true, 'Only Remote namespace mounting belongs to activation')
    assert.equal(h.setupCalls, 0)
    assert.equal(h.slotCount, 2)
  } finally { pending.resolve(config()); await h.dispose() }
  assert.equal(h.mountDisposals, 1)
  assert.equal(h.listeners.size, 0)
})

test('settings and Agent status share one pending read and use the actual Host values', async () => {
  const pending = Promise.withResolvers()
  const h = await harness({ setup: () => pending.promise })
  await h.opening
  try {
    let tree = h.renderSetup()
    assert.match(find(tree, node => node.props.role === 'status').children[0], /正在读取浏览器配置/)
    assert.equal(find(tree, node => node.type === 'button' && node.props['aria-label'] === '复制插件目录').props.disabled, true)
    h.runEffects()
    const status = h.status()
    assert.equal(h.setupCalls, 1)
    assert.equal(h.messages.length, 0, 'No handshake is sent with fabricated configuration')
    pending.resolve(config(1234))
    assert.equal((await status).extension.state, 'connected')
    await settle()
    tree = h.renderSetup()
    assert.ok(find(tree, node => node.type === 'code' && node.children[0] === 'C:/actual-extension'))
    assert.equal(find(tree, node => node.type === 'button' && node.props['aria-label'] === '复制插件目录').props.disabled, false)
    assert.deepEqual(h.timers.map(timer => timer.delay), [8000, 1234, 1234])
    assert.equal(h.activeTimers.length, 0)
    await h.status()
    assert.equal(h.setupCalls, 2, 'Completed values are not cached across later actions')
  } finally { await h.dispose() }
})

test('setup failures stay local and a later demand reads current configuration', async () => {
  let attempt = 0
  const h = await harness({ setup: async () => ++attempt === 1
    ? { ok: false, error: { message: 'actual setup failure' } }
    : config(2345) })
  await h.opening
  try {
    const failed = await h.status()
    assert.equal(failed.extension.state, 'unavailable')
    assert.equal(failed.extension.reason, 'actual setup failure')
    assert.equal(h.messages.length, 0)
    assert.equal(h.activeTimers.length, 0, 'A rejected read releases its status deadline timer')
    const current = await h.status()
    assert.equal(current.extension.state, 'connected')
    assert.equal(h.setupCalls, 2)
    assert.equal(h.timers.at(-1).delay, 2345)
  } finally { await h.dispose() }
})

test('a setup page shows configuration failure and makes no extension request', async () => {
  const h = await harness({ setup: async () => { throw new Error('configuration transport failed') } })
  await h.opening
  try {
    h.renderSetup(); h.runEffects(); await settle()
    const tree = h.renderSetup()
    assert.match(find(tree, node => node.props.role === 'status').children[0], /配置读取失败.*configuration transport failed/)
    assert.equal(find(tree, node => node.type === 'button' && node.props['aria-label'] === '复制插件目录').props.disabled, true)
    assert.equal(h.messages.length, 0)
  } finally { await h.dispose() }
})

test('closing a pending setup page does not start a late extension handshake', async () => {
  const pending = Promise.withResolvers()
  const h = await harness({ setup: () => pending.promise })
  await h.opening
  try {
    h.renderSetup(); h.runEffects(); h.closeSetup()
    pending.resolve(config()); await settle()
    assert.equal(h.messages.length, 0)
    assert.equal(h.timers.length, 0)
  } finally { await h.dispose() }
})

test('status finishes at its deadline while the shared setup RPC remains pending', async () => {
  const pending = Promise.withResolvers()
  const h = await harness({ setup: () => pending.promise })
  await h.opening
  let finished = false
  const status = h.status(2000).then(value => { finished = true; return value })
  try {
    assert.equal(h.setupCalls, 1)
    h.advanceClock(2000)
    await settle()
    assert.equal(finished, true, 'An unresolved configuration read must not retain the Bridge polling lock')
    const result = await status
    assert.equal(result.extension.state, 'unavailable')
    assert.match(result.extension.reason, /expired/)
    assert.equal(h.messages.length, 0)
    assert.equal(h.activeTimers.length, 0)
  } finally { pending.resolve(config()); await status; await h.dispose() }
})

test('a settings reader still completes after the sharing status waiter expires', async () => {
  const pending = Promise.withResolvers()
  const h = await harness({ setup: () => pending.promise })
  await h.opening
  try {
    h.renderSetup(); h.runEffects()
    const status = h.status(2000)
    h.advanceClock(2000)
    assert.equal((await status).extension.state, 'unavailable')
    assert.equal(h.messages.length, 0)
    assert.equal(h.activeTimers.length, 0)
    pending.resolve(config()); await settle()
    const tree = h.renderSetup()
    assert.match(find(tree, node => node.props.role === 'status').children[0], /已连接/)
    assert.equal(h.setupCalls, 1, 'Expiry does not cancel or duplicate the shared configuration request')
    assert.equal(h.messages.length, 1, 'Only the still-mounted settings reader probes the extension')
    assert.equal(h.activeTimers.length, 0)
  } finally { pending.resolve(config()); await h.dispose() }
})

test('unload releases a pending status waiter and its timer before setup responds', async () => {
  const pending = Promise.withResolvers()
  const h = await harness({ setup: () => pending.promise })
  await h.opening
  const status = h.status(2000)
  const rejection = assert.rejects(status, /unloaded/)
  await h.dispose()
  await rejection
  assert.equal(h.activeTimers.length, 0)
  assert.equal(h.messages.length, 0)
  pending.resolve(config()); await settle()
  assert.equal(h.messages.length, 0)
})

test('an already expired status makes no setup RPC or deadline timer', async () => {
  const h = await harness()
  await h.opening
  try {
    assert.equal((await h.status(1000)).extension.state, 'unavailable')
    assert.equal(h.setupCalls, 0)
    assert.equal(h.timers.length, 0)
    assert.equal(h.messages.length, 0)
  } finally { await h.dispose() }
})

test('Host reset retires a pending read without letting it clear the replacement request', async () => {
  const old = Promise.withResolvers(), next = Promise.withResolvers()
  let calls = 0
  const h = await harness({ setup: () => ++calls === 1 ? old.promise : next.promise })
  await h.opening
  try {
    const retired = h.readSetup()
    const rejection = assert.rejects(retired, /connection changed/)
    h.reset()
    const replacement = h.readSetup()
    old.resolve(config(1000)); await rejection
    const shared = h.readSetup()
    assert.equal(h.setupCalls, 2)
    next.resolve(config(2000))
    assert.equal((await replacement).connectionTimeoutMs, 2000)
    assert.equal((await shared).connectionTimeoutMs, 2000)
  } finally { await h.dispose() }
})

test('Desktop settings and status never request Web extension configuration', async () => {
  const h = await harness({ url: 'dsh-app://app/' })
  await h.opening
  try {
    h.renderSetup(); h.runEffects()
    assert.equal((await h.status()).extension.state, 'not-applicable')
    assert.equal(h.setupCalls, 0)
    assert.equal(h.messages.length, 0)
  } finally { await h.dispose() }
})
