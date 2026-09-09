import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

test('script popups become plugin links without opening external windows', async () => {
  const source = await readFile(new URL('../extension/frame-popups.js', import.meta.url), 'utf8')
  const sent = [], external = []
  const parent = { postMessage: message => sent.push(message) }
  const original = (...args) => external.push(args)
  const context = { navigator: { userActivation: { isActive: true } }, window: { top: parent, parent, open: original, addEventListener() {} }, URL, document: { baseURI: 'https://example.com/path/' }, location: { ancestorOrigins: ['http://127.0.0.1:3180'] } }
  runInNewContext(source, context)
  assert.equal(context.window.open('../next', '_blank'), null)
  assert.equal(sent[0].url, 'https://example.com/next')
  context.window.open('https://example.com/named', 'detail')
  assert.equal(sent.length, 1)
  context.window.open('javascript:alert(1)')
  assert.equal(sent.length, 1)
  assert.equal(external.length, 0)
  context.navigator.userActivation.isActive = false
  context.window.open('https://example.com/retry')
  assert.equal(sent.length, 1)
  const other = { ...context, navigator: { userActivation: { isActive: true } }, window: { top: parent, parent, open: original, addEventListener() {} }, location: { ancestorOrigins: ['https://unrelated.example'] } }
  runInNewContext(source, other)
  assert.equal(other.window.open, original)
})
