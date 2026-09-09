import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BrowserBroker } from '../lib/broker.js'

test('commands are claimed once, isolated by session, and complete the waiting tool', async () => {
  const broker = new BrowserBroker(1000)
  const result = broker.request('a', { action: 'navigate', url: 'https://example.com' })
  assert.equal(broker.next('b'), null)
  const job = broker.next('a')
  assert.equal(broker.next('a'), null)
  assert.throws(() => broker.complete('b', job.token, 'wrong'), /不属于/)
  broker.complete('a', job.token, 'page snapshot')
  assert.deepEqual(await result, { text: 'page snapshot' })
})
test('disconnect timeout and cancellation reject instead of reporting success', async () => {
  const broker = new BrowserBroker(10)
  await assert.rejects(broker.request('a', { action: 'snapshot' }), /设置|连接/)
  assert.equal(broker.next('a'), null)
  const abort = new AbortController()
  const result = broker.request('b', { action: 'click', ref: 4 }, abort.signal)
  abort.abort()
  await assert.rejects(result, /取消/)
  assert.equal(broker.next('b'), null)
})
