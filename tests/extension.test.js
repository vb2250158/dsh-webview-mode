import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

test('commands target the exact registered iframe document, never a new browser tab', async () => {
  let listener, changed, removed
  const sent = []
  const top = { documentId: 'top', url: 'https://dsh.example/', parentFrameId: -1 }
  const frame = { documentId: 'child', url: 'https://page.example/', parentFrameId: 0 }
  const chrome = {
    storage: { sync: { get: async () => ({ trustedOrigins: ['https://dsh.example'] }) }, onChanged: { addListener(fn) { changed = fn } } },
    webNavigation: { getFrame: async ({ frameId }) => frameId === 0 ? top : frame },
    tabs: { onRemoved: { addListener(fn) { removed = fn } }, sendMessage: async (...args) => { sent.push(args); return { value: { content: 'actual iframe' } } } },
    runtime: { onMessage: { addListener(fn) { listener = fn } } },
  }
  runInNewContext(await readFile(new URL('../extension/worker.js', import.meta.url), 'utf8'), { chrome, URL, Date })
  const parent = { tab: { id: 1 }, frameId: 0, documentId: 'top', url: top.url }
  const child = { ...parent, frameId: 2, documentId: 'child', url: frame.url }
  const nonce = '12345678-1234-1234-1234-123456789abc'
  const deadline = Date.now() + 10000
  const call = (kind, sender = parent, extra = {}) => new Promise(resolve => listener({ kind, nonce, deadline, ...extra }, sender, resolve))
  assert.match((await call('bind-frame', child)).error, /challenge/)
  assert.equal((await call('prepare-frame')).value.prepared, true)
  assert.equal((await call('bind-frame', child)).value.connected, true)
  assert.match((await call('bind-frame', child)).error, /challenge/)
  assert.equal((await call('frame-command')).value.value.content, 'actual iframe')
  assert.equal(sent[0][0], 1)
  assert.equal(sent[0][2].documentId, 'child')
  assert.match((await call('frame-command')).error, /already dispatched/)
  assert.match((await call('frame-command', { ...parent, tab: { id: 9 } })).error, /not connected/)
  assert.match((await call('frame-command', child)).error, /Only the current DSH/)
  assert.match((await call('frame-command', parent, { deadline: 0 })).error, /expired/)
  frame.documentId = 'replacement'
  assert.match((await call('frame-command')).error, /navigated/)
  await call('prepare-frame')
  frame.parentFrameId = 2
  assert.match((await call('bind-frame', { ...child, documentId: 'replacement' })).error, /direct/)
  frame.parentFrameId = 0
  await call('prepare-frame')
  await call('bind-frame', { ...child, documentId: 'replacement' })
  changed()
  assert.match((await call('frame-command')).error, /not connected/)
  // Hold the final frame lookup so cancellation wins before dispatch.
  await call('prepare-frame')
  await call('bind-frame', { ...child, documentId: 'replacement' })
  let entered, release
  const waiting = new Promise(resolve => { entered = resolve })
  chrome.webNavigation.getFrame = async ({ frameId }) => {
    if (frameId === 0) return top
    entered()
    return new Promise(resolve => { release = () => resolve(frame) })
  }
  const pending = call('frame-command')
  await waiting
  assert.equal((await call('cancel-frame')).value.cancelled, true)
  release()
  assert.match((await pending).error, /cancelled/)
  assert.equal(sent.length, 1)

  // A settings change while binding is suspended must not revive that binding.
  await call('prepare-frame')
  let bindingEntered, bindingRelease
  const bindingWaiting = new Promise(resolve => { bindingEntered = resolve })
  chrome.webNavigation.getFrame = async ({ frameId }) => {
    if (frameId === 0) return top
    bindingEntered()
    return new Promise(resolve => { bindingRelease = () => resolve(frame) })
  }
  const binding = call('bind-frame', { ...child, documentId: 'replacement' })
  await bindingWaiting
  changed()
  bindingRelease()
  assert.match((await binding).error, /settings changed/)
  assert.match((await call('frame-command')).error, /not connected/)
  removed(1)
  assert.equal(sent.length, 1)
})
