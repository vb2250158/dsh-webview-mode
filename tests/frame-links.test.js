import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

test('new-tab links route to DSH only for trusted clicks in its direct child frame', async () => {
  const source = await readFile(new URL('../extension/frame-links.js', import.meta.url), 'utf8')
  const handlers = {}, sent = []
  const parent = { postMessage: (...args) => sent.push(args) }
  class Anchor { target = '_blank'; href = 'https://example.com/next'; hasAttribute() { return false } }
  const context = { setInterval() {}, window: { top: parent, parent, addEventListener: (name, fn) => { handlers[name] = fn } }, location: { ancestorOrigins: ['http://127.0.0.1:3180'] }, HTMLAnchorElement: Anchor, URL, document: { querySelector: () => null } }
  runInNewContext(source, context)
  let prevented = false
  const event = { isTrusted: true, button: 0, composedPath: () => [new Anchor()], preventDefault() { prevented = true }, stopImmediatePropagation() {} }
  handlers.click(event)
  assert.equal(prevented, true)
  assert.equal(sent.filter(item => item[0].source === 'dsh-iframe-link')[0][0].url, 'https://example.com/next')
  assert.equal(sent.filter(item => item[0].source === 'dsh-iframe-link')[0][1], 'http://127.0.0.1:3180')
  handlers.click({ ...event, isTrusted: false })
  assert.equal(sent.filter(item => item[0].source === 'dsh-iframe-link').length, 1)
  const otherHandlers = []
  runInNewContext(source, { ...context, location: { ancestorOrigins: ['https://unrelated.example'] }, window: { ...context.window, addEventListener: name => otherHandlers.push(name) } })
  assert.equal(otherHandlers.length, 0)
})
