import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { BrowserBroker } from '../lib/broker.js'

// Exercise the registered tool and real broker without booting a second DSH host.
test('registered Agent interface exposes DOM actions and owns requests by the executing session', async () => {
  const source = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
  const apply = source.slice(source.indexOf('export function apply')).replace('export function apply', 'function apply')
  const broker = new BrowserBroker(1000)
  let tool
  const context = { WebviewArchive: class { constructor() { this.broker = broker } }, defineTool: value => value }
  runInNewContext(apply, context)
  context.apply({ tools: { register(value) { tool = value } } }, { commandTimeoutMs: 1000 })
  try {
    assert.equal(tool.name, 'conversation_browser')
    for (const action of ['status', 'snapshot', 'click', 'text', 'choose', 'scroll']) assert.ok(tool.parameters.action.enum.includes(action))
    assert.ok(tool.parameters.snapshotId)
    assert.throws(() => tool.execute({ action: 'status' }, {}), /conversation agent/)
    const controller = new AbortController()
    const pending = tool.execute({ action: 'status', sessionId: 'forged-other' }, { agent: { session: { id: 'owner' } }, signal: controller.signal })
    assert.equal(broker.next('forged-other'), null)
    const claimed = broker.next('owner')
    assert.equal(claimed.action.action, 'status')
    broker.complete('owner', claimed.token, '{"visible":false}')
    const output = await pending
    assert.equal(output.text, '{"visible":false}')
    assert.equal(tool.output.render({}, output)[0].text, output.text)
    assert.equal(tool.isConcurrencySafe(), false)
  } finally { broker.dispose() }
})
