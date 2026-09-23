import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { webcrypto } from 'node:crypto'

test('the settings section guides installation in three steps and reports the handshake', async () => {
  let factory, cursor = 0
  const hooks = [], effects = [], copied = [], kinds = []
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }),
    useState(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = initial; return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value }] },
    useEffect(effect) { const index = cursor++; if (!(index in hooks)) { hooks[index] = true; effects.push(effect) } },
  }
  const listeners = new Set()
  const window = {
    addEventListener(_name, fn) { listeners.add(fn) },
    removeEventListener(_name, fn) { listeners.delete(fn) },
    postMessage(message) {
      kinds.push(message.request.kind)
      queueMicrotask(() => {
        for (const fn of [...listeners]) fn({
          source: window, origin: 'https://dsh.example',
          data: { source: 'dsh-webview-bridge', id: message.id, value: { protocol: 1, configured: false, version: '0.2.3', id: 'test-extension', actions: [] } },
        })
      })
    },
    __ModuleLoader__: { load(value) { factory = value.factory } },
  }
  // No navigator.clipboard: the LAN gateway on plain HTTP is not a secure context, so the
  // field fallback is the path that actually runs there.
  const document = {
    createElement: () => ({ value: '', setAttribute() {}, style: {}, select() { copied.push(this.value) }, remove() {} }),
    body: { append() {} },
    execCommand: () => true,
  }
  const context = {
    window, document, navigator: {}, location: { origin: 'https://dsh.example' },
    crypto: webcrypto, setTimeout, clearTimeout, queueMicrotask, setInterval: () => 1, clearInterval() {},
  }
  const source = (await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'))
    .replace('function Setup(', 'globalThis.TestSetup = function Setup(')
    .replace('let connectionTimeoutMs', 'let connectionTimeoutMs = 20')
    .replace('let extensionDirectory', "let extensionDirectory = 'C:/ext'")
  runInNewContext(source, context)
  factory(name => name === 'react' ? React : {})
  const render = () => { cursor = 0; return context.TestSetup() }
  const find = (node, predicate) => {
    if (!node || typeof node !== 'object') return undefined
    if (predicate(node)) return node
    for (const child of node.children || []) { const found = find(child, predicate); if (found) return found }
  }
  const settle = () => new Promise(resolve => setImmediate(resolve))
  const button = (tree, label) => find(tree, node => node.type === 'button' && node.children[0] === label)

  render()
  effects.splice(0).forEach(effect => effect())
  await settle()
  let tree = render()
  assert.equal(kinds[0], 'status')
  assert.match(find(tree, node => node.props.role === 'status').children[0], /扩展已安装，但本页来源尚未授权/)
  const steps = find(tree, node => node.type === 'ol').children
  assert.equal(steps.length, 3)
  assert.match(steps[0].children[1].children[0], /Chrome 地址栏.*开发者模式/)
  assert.match(steps[1].children[1].children[0], /加载已解压的扩展程序.*重新加载/)
  assert.match(steps[2].children[1].children[0], /扩展程序选项.*DSH 来源.*刷新本页/)
  assert.equal(find(tree, node => node.type === 'button' && node.children[0] === '重新检测'), undefined)

  await steps[0].children.at(-1).props.onClick()
  assert.deepEqual(copied.at(-1), 'chrome://extensions')
  await steps[1].children.at(-1).props.onClick()
  assert.deepEqual(copied.at(-1), 'C:/ext')
  await steps[2].children.at(-1).props.onClick()
  assert.deepEqual(copied.at(-1), 'https://dsh.example', 'the origin is what the options page asks for')
  assert.deepEqual(kinds, ['status'])
  tree = render()
  assert.match(find(tree, node => node.props.role === 'status' && node.children[0] !== undefined).children[0], /扩展状态/)

  // A companion older than the required version reports "not configured" for an origin that is
  // merely unauthorized, while it cannot run the setup actions at all. The panel has to name the
  // version and the reload step, otherwise it sends the user after a problem they do not have.
  hooks[0] = { protocol: 1, configured: false, version: '0.2.1' }
  tree = render()
  const stale = find(tree, node => node.props.role === 'status')
  assert.match(stale.children[0], /扩展为 0\.2\.1，需要 0\.2\.3/)
  assert.doesNotMatch(stale.children[0], /尚未授权/)
  hooks[0] = { error: '扩展未响应' }
  tree = render()
  assert.match(find(tree, node => node.props.role === 'status').children[0], /未检测到扩展响应/)
  await find(tree, node => node.type === 'ol').children[0].children.at(-1).props.onClick()
  assert.deepEqual(copied.at(-1), 'chrome://extensions')
  assert.equal(button(tree, '复制路径').props.disabled, false)
})

test('the settings section asks for a page refresh when the extension was reloaded', async () => {
  let factory, cursor = 0
  const hooks = [], effects = [], listeners = new Set()
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }),
    useState(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = initial; return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value }] },
    useEffect(effect) { const index = cursor++; if (!(index in hooks)) { hooks[index] = true; effects.push(effect) } },
  }
  const window = {
    addEventListener(_name, fn) { listeners.add(fn) },
    removeEventListener(_name, fn) { listeners.delete(fn) },
    postMessage(message) {
      // This is what an orphaned content script now replies: it cannot reach the extension any
      // more, and only a page refresh re-injects a live one.
      queueMicrotask(() => {
        for (const fn of [...listeners]) fn({
          source: window, origin: 'https://dsh.example',
          data: { source: 'dsh-webview-bridge', id: message.id, error: 'Extension was reloaded; reconnect to the extension.' },
        })
      })
    },
    __ModuleLoader__: { load(value) { factory = value.factory } },
  }
  const document = {
    createElement: () => ({ value: '', setAttribute() {}, style: {}, select() {}, remove() {} }),
    body: { append() {} }, execCommand: () => true,
  }
  const context = {
    window, document, navigator: {}, location: { origin: 'https://dsh.example' },
    crypto: webcrypto, setTimeout, clearTimeout, queueMicrotask, setInterval: () => 1, clearInterval() {},
  }
  const source = (await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'))
    .replace('function Setup(', 'globalThis.TestSetup = function Setup(')
    .replace('let connectionTimeoutMs', 'let connectionTimeoutMs = 20')
    .replace('let extensionDirectory', "let extensionDirectory = 'C:/ext'")
  runInNewContext(source, context)
  factory(name => name === 'react' ? React : {})
  const render = () => { cursor = 0; return context.TestSetup() }
  const find = (node, predicate) => {
    if (!node || typeof node !== 'object') return undefined
    if (predicate(node)) return node
    for (const child of node.children || []) { const found = find(child, predicate); if (found) return found }
  }

  render()
  effects.splice(0).forEach(effect => effect())
  await new Promise(resolve => setImmediate(resolve))
  const line = find(render(), node => node.props.role === 'status').children[0]
  // Reloading again is the wrong advice here: the extension is already current, and the dead
  // script in this page is the whole problem. Name the refresh, not another reload.
  assert.match(line, /扩展已重新加载，本页脚本已失效：请刷新本页/)
  assert.doesNotMatch(line, /重新加载扩展/)
})
