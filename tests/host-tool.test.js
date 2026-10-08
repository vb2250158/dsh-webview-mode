import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { BrowserBroker } from '../lib/broker.js'
import { ArchiveStore } from '../lib/archive.js'

test('cold migration reads preserve archives without allowing unloaded conversation commands', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-browser-cold-read-'))
  let service
  try {
    const source = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
    const implementation = source.slice(source.indexOf('class WebviewArchive'), source.indexOf('for (const method')).replaceAll('import.meta.url', JSON.stringify(import.meta.url))
    const context = { TypertRemoteService: class {}, BrowserBroker, ArchiveStore, initializers: [] }
    runInNewContext(implementation + '\nglobalThis.Archive = WebviewArchive', context)
    service = new context.Archive({ sessions: { get: () => undefined }, effect() {} }, { commandTimeoutMs: 1000, dataDirectory: root })
    const saved = await service.store.write({ version: 1, sessionId: 'cold', revision: 0, open: false, active: 'old', tabs: [{ id: 'old', url: 'https://fixture.test/', title: 'Saved' }] })
    const before = await readFile(service.store.path('cold'), 'utf8')
    assert.deepEqual(await service.read({ sessionId: 'cold' }), saved)
    assert.equal(await readFile(service.store.path('cold'), 'utf8'), before)
    assert.deepEqual((await service.read({ sessionId: 'missing' })).tabs, [])
    await assert.rejects(stat(service.store.path('missing')), { code: 'ENOENT' })
    await assert.rejects(service.read({ sessionId: '' }))
    for (const method of ['next', 'complete', 'visibility', 'write']) {
      await assert.rejects(service[method]({ sessionId: 'cold' }), /当前对话尚未加载/)
    }
  } finally {
    service?.broker.dispose()
    const ownedRoot = resolve(root)
    assert.equal(dirname(ownedRoot), resolve(tmpdir()))
    assert.ok(basename(ownedRoot).startsWith('dsh-browser-cold-read-'))
    await rm(ownedRoot, { recursive: true, force: true })
  }
})

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
