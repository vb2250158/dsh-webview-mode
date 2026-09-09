import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { webcrypto } from 'node:crypto'

test('iframe navigation persists the displayed URL and rejects script URLs without extension calls', async () => {
  let factory, cursor = 0
  const hooks = [], effects = [], writes = []
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }),
    useState(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = initial; return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value }] },
    useRef(initial) { const index = cursor++; return hooks[index] ||= { current: initial } },
    useEffect(effect) { const index = cursor++; if (!(index in hooks)) { hooks[index] = true; effects.push(effect) } },
    useSyncExternalStore: () => null,
  }
  const handlers = {}
  const context = { window: { addEventListener(name, listener) { handlers[name] = listener }, removeEventListener() {}, __ModuleLoader__: { load(value) { factory = value.factory } } }, URL, crypto: webcrypto, location: { origin: 'http://127.0.0.1:3180' } }
  const source = (await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')).replace('function Panel(', 'globalThis.TestPanel = function Panel(')
  runInNewContext(source, context)
  factory(name => name === 'react' ? React : { createPortal() {} })
  const initial = { version: 1, sessionId: 'test', revision: 0, active: null, tabs: [] }
  const service = { read: async () => ({ ok: true, value: initial }), write: async value => { writes.push(value); return { ok: true, value: { ...value, revision: value.revision + 1 } } } }
  const render = () => { cursor = 0; return context.TestPanel({ sessionId: 'test', service, close() {} }) }
  const find = (node, predicate) => { if (!node || typeof node !== 'object') return; if (predicate(node)) return node; for (const child of node.children || []) { const found = find(child, predicate); if (found) return found } }
  const settle = () => new Promise(resolve => setImmediate(resolve))
  render(); effects.splice(0).forEach(effect => effect()); await settle()
  async function navigate(url) {
    let tree = render()
    find(tree, node => node.props['aria-label'] === '网页地址').props.onChange({ target: { value: url } })
    tree = render()
    find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} })
    await settle()
    return render()
  }
  let tree = await navigate('https://example.com/')
  assert.equal(find(tree, node => node.type === 'iframe').props.src, 'https://example.com/')
  assert.equal(writes.length, 1)
  assert.equal(writes[0].tabs[0].url, 'https://example.com/')
  assert.equal(find(tree, node => node.type === 'img'), undefined)
  const frame = find(tree, node => node.type === 'iframe')
  const sourceWindow = {}
  frame.props.ref({ contentWindow: sourceWindow, getClientRects: () => [{}] })
  handlers.message({ source: sourceWindow, data: { source: 'dsh-iframe-link', url: 'https://example.com/video' } })
  handlers.message({ source: sourceWindow, data: { source: 'dsh-iframe-link', url: 'https://example.com/video' } })
  await settle()
  tree = render()
  assert.equal(writes.at(-1).tabs.length, 2)
  assert.equal(writes.at(-1).tabs.filter(tab => tab.url === 'https://example.com/video').length, 1)
  const beforeInvalid = writes.length

  tree = await navigate('javascript:alert(1)')
  assert.equal(writes.length, beforeInvalid)
  assert.ok(find(tree, node => node.props.role === 'alert'))
  assert.equal(find(tree, node => node.type === 'iframe').props.src, 'https://example.com/')
})
