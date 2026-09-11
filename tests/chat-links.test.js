import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

test('chat links open in the conversation browser and release their listener', async () => {
  let factory, listener
  const opened = []
  const context = {
    URL, location: { origin: 'https://dsh.example' },
    window: { __ModuleLoader__: { load(module) { factory = module.factory } } },
  }
  const source = (await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'))
    .replace('function installChatLinks(', 'globalThis.installChatLinks = function installChatLinks(')
  runInNewContext(source, context)
  factory(() => ({}))
  const chat = {
    contains: link => !link.outside,
    addEventListener(type, callback) { assert.equal(type, 'click'); listener = callback },
    removeEventListener(type, callback) { assert.equal(type, 'click'); assert.equal(callback, listener); listener = null },
  }
  const dispose = context.installChatLinks(chat, url => opened.push(url))
  function click(href, options = {}, linkOptions = {}) {
    let prevented = false
    const link = { getAttribute: () => href, hasAttribute: () => false, closest: () => ({}), ...linkOptions }
    listener({ button: 0, target: { closest: () => link }, preventDefault() { prevented = true }, ...options })
    return prevented
  }
  assert.equal(click('https://example.com/editor'), true)
  assert.equal(click('http://localhost:8081/battle'), true)
  assert.deepEqual(opened, ['https://example.com/editor', 'http://localhost:8081/battle'])
  for (const options of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }]) {
    assert.equal(click('https://example.com', options), false)
  }
  for (const href of ['#footnote', '/api/attachment/file', 'mailto:a@example.com', 'javascript:alert(1)', 'https://', 'https://dsh.example/settings', 'https://user:pass@example.com']) {
    assert.equal(click(href), false)
  }
  assert.equal(click('https://example.com', {}, { outside: true }), false)
  assert.equal(click('https://example.com', {}, { closest: () => null }), false)
  assert.equal(click('https://example.com', {}, { hasAttribute: () => true }), false)
  assert.equal(opened.length, 2)
  dispose()
  assert.equal(listener, null)
})
