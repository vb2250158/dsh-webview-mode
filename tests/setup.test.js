import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { webcrypto } from 'node:crypto'

test('the settings section reports the handshake and exposes the extension setup actions', async () => {
  let factory, cursor = 0
  const hooks = [], effects = [], copied = [], kinds = []
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }),
    useState(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = initial; return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value }] },
    useEffect(effect) { const index = cursor++; if (!(index in hooks)) { hooks[index] = true; effects.push(effect) } },
  }
  const listeners = new Set()
  const state = { respond: true }
  const window = {
    addEventListener(_name, fn) { listeners.add(fn) },
    removeEventListener(_name, fn) { listeners.delete(fn) },
    postMessage(message) {
      kinds.push(message.request.kind)
      if (!state.respond) return
      queueMicrotask(() => {
        for (const fn of [...listeners]) fn({
          source: window, origin: 'https://dsh.example',
          data: { source: 'dsh-webview-bridge', id: message.id, value: { protocol: 1, configured: false, version: '0.2.2', id: 'test-extension', actions: [] } },
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
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  const button = (tree, label) => find(tree, node => node.type === 'button' && node.children[0] === label)

  render()
  effects.splice(0).forEach(effect => effect())
  await settle()
  let tree = render()
  assert.equal(kinds[0], 'status')
  assert.match(find(tree, node => node.props.role === 'status').children[0], /扩展已安装，但本页来源尚未授权/)
  assert.deepEqual(['打开扩展选项页', '复制扩展管理页地址', '复制本页来源', '复制扩展目录', '重新检测'].filter(label => !button(tree, label)), [])

  await button(tree, '复制本页来源').props.onClick()
  assert.deepEqual(copied.at(-1), 'https://dsh.example', 'the origin is what the options page asks for')
  await button(tree, '复制扩展管理页地址').props.onClick()
  assert.deepEqual(copied.at(-1), 'chrome://extensions/?id=test-extension', 'the handshake id produces a deep link to this extension card')
  await button(tree, '复制扩展目录').props.onClick()
  assert.deepEqual(copied.at(-1), 'C:/ext')
  await button(tree, '打开扩展选项页').props.onClick()
  assert.deepEqual(kinds, ['status', 'open-options'])
  tree = render()
  assert.match(find(tree, node => node.props.role === 'status' && node.children[0] !== undefined).children[0], /扩展状态/)

  // Without a handshake there is no id, so the deep link degrades to the plain page
  // rather than sending the user to a link that cannot resolve.
  state.respond = false
  await button(tree, '重新检测').props.onClick()
  await sleep(120)
  tree = render()
  assert.match(find(tree, node => node.props.role === 'status').children[0], /未检测到扩展响应/)
  await button(tree, '复制扩展管理页地址').props.onClick()
  assert.deepEqual(copied.at(-1), 'chrome://extensions')
})
