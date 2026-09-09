import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

test('split drag is clamped, saved, and releases iframe input on cancellation', async () => {
  let factory, handle
  const saved = new Map(), values = new Map()
  const style = { setProperty: (k, v) => values.set(k, v), removeProperty: k => values.delete(k) }
  const context = {
    window: { innerWidth: 1200, __ModuleLoader__: { load(module) { factory = module.factory } } },
    localStorage: { getItem: k => saved.get(k), setItem: (k, v) => saved.set(k, v) },
    document: { body: { append() {} }, createElement() { return handle = { style: {}, setAttribute() {}, setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() {}, remove() {} } } },
  }
  const source = (await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')).replace('function installSplitter(', 'globalThis.installSplitter = function installSplitter(')
  runInNewContext(source, context)
  factory(() => ({}))
  const container = { style: {} }
  const splitter = context.installSplitter({ style, getBoundingClientRect: () => ({ left: 100, width: 1000 }) }, { getBoundingClientRect: () => ({ right: 700, top: 0, height: 700, width: 600 }) }, container, 'a')
  handle.onpointerdown({ button: 0, pointerId: 1, preventDefault() {} })
  handle.onpointermove({ pointerId: 1, clientX: 1050 })
  assert.equal(values.get('--dsh-browser-left'), '80fr')
  assert.equal(container.style.pointerEvents, 'none')
  handle.onpointercancel()
  assert.equal(container.style.pointerEvents, '')
  assert.equal(saved.get('dsh-browser-split:a'), '80')
  splitter.dispose()
  assert.equal(values.size, 0)
})
