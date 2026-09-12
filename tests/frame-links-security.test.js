import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'

const source = await readFile(new URL('../extension/frame-links.js', import.meta.url), 'utf8')
const nonce = '11111111-1111-4111-8111-111111111111'
const secondNonce = '22222222-2222-4222-8222-222222222222'

function fixture({ nested = false, top = false, send } = {}) {
  const listeners = new Map()
  const messages = []
  const intervals = new Set()
  const settings = []
  const parent = { postMessage(message) { assert.equal(message.source, 'dsh-frame-disconnected'); assert.equal(typeof message.nonce, 'string'); assert.equal(message.event, undefined) } }
  const window = {
    parent, top: nested ? {} : parent,
    addEventListener(type, handler) { listeners.set(type, handler) },
    postMessage() { throw new Error('Page message channel must not carry frame events') },
  }
  if (top) window.top = window
  class HTMLAnchorElement {
    constructor(href, target = '_blank', download = false) { Object.assign(this, { href, target, download }) }
    hasAttribute(name) { return name === 'download' && this.download }
  }
  const document = {
    title: 'Actual document', visibilityState: 'visible',
    querySelector() { return null },
    addEventListener(type, handler) { listeners.set(type, handler) },
  }
  const context = vm.createContext({
    window, document, HTMLAnchorElement, URL,
    location: { href: 'https://site.example/page' },
    chrome: {
      runtime: { async sendMessage(message) { messages.push(message); return send ? send(message) : { value: { delivered: true } } } },
      storage: { onChanged: { addListener(handler) { settings.push(handler) } } },
    },
    setInterval(handler) { intervals.add(handler); return handler },
    clearInterval(handler) { intervals.delete(handler) },
  })
  vm.runInContext(source, context)
  return {
    messages, listeners, intervals, document, context,
    bind(value = nonce) { context.candidate = value; vm.runInContext('setFrameEventBinding(candidate)', context) },
    settingsChanged() { for (const handler of settings) handler() },
    click(options = {}) {
      const event = {
        isTrusted: true, defaultPrevented: false, button: 0,
        composedPath: () => [new HTMLAnchorElement(options.href ?? 'https://site.example/new', options.target, options.download)],
        preventDefault() { this.prevented = true },
        stopImmediatePropagation() { this.stopped = true },
        ...options,
      }
      listeners.get('click')?.(event)
      return event
    },
  }
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

test('unbound scripts cannot report metadata, intercept clicks, or accept forged page messages', () => {
  const f = fixture()
  assert.equal(f.listeners.has('message'), false)
  assert.equal(f.click().prevented, undefined)
  assert.equal(f.messages.length, 0)
  assert.equal(f.intervals.size, 0)
})

test('verified binding reports actual metadata and real user links only over runtime', async () => {
  const f = fixture()
  f.bind()
  await flush()
  assert.deepEqual(JSON.parse(JSON.stringify(f.messages[0])), {
    kind: 'frame-event', nonce, event: { type: 'location', url: 'https://site.example/page', title: 'Actual document' },
  })
  assert.equal(f.click().prevented, true)
  assert.equal(f.messages[1].event.type, 'link')
  assert.equal(f.messages[1].nonce, nonce)
  assert.equal(f.intervals.size, 1)
  for (const poll of f.intervals) await poll()
  assert.equal(f.messages.length, 2)
  f.document.title = 'SPA updated'
  for (const poll of f.intervals) await poll()
  assert.equal(f.messages.at(-1).event.title, 'SPA updated')
})

test('synthetic events, unsafe URLs, downloads, ordinary links, and hidden frames never route', async () => {
  const f = fixture()
  f.bind()
  await flush()
  for (const options of [
    { isTrusted: false }, { defaultPrevented: true }, { button: 2 },
    { href: 'javascript:alert(1)' }, { href: 'https://user:pass@site.example/' },
    { href: 'not a URL' }, { download: true }, { target: '_self' },
  ]) assert.equal(f.click(options).prevented, undefined)
  f.document.visibilityState = 'hidden'
  assert.equal(f.click().prevented, undefined)
  assert.equal(f.messages.length, 1)
})

test('modifier and middle-button anchor links retain useful routing', async () => {
  const f = fixture()
  f.bind()
  await flush()
  for (const options of [{ target: '_self', ctrlKey: true }, { target: '_self', metaKey: true }, { target: '_self', button: 1 }, { target: 'named' }]) {
    assert.equal(f.click(options).prevented, true)
  }
  assert.equal(f.messages.length, 5)
})

test('configuration revocation and pagehide clear binding and polling', async () => {
  const f = fixture()
  f.bind()
  await flush()
  f.settingsChanged()
  assert.equal(f.intervals.size, 0)
  assert.equal(f.click().prevented, undefined)
  f.bind(secondNonce)
  await flush()
  assert.equal(f.messages.at(-1).nonce, secondNonce)
  f.listeners.get('pagehide')()
  assert.equal(f.intervals.size, 0)
  assert.equal(f.click().prevented, undefined)
})

test('runtime failure disables interception without falling back to page messaging', async () => {
  const f = fixture({ send: async () => ({ error: 'Binding revoked' }) })
  f.bind()
  await flush()
  assert.equal(f.click().prevented, undefined)
  assert.equal(f.intervals.size, 0)
})

test('old asynchronous failure cannot revoke a replacement binding', async () => {
  let rejectOld
  const f = fixture({ send: message => message.nonce === nonce
    ? new Promise((resolve, reject) => { rejectOld = reject })
    : Promise.resolve({ value: { delivered: true } }) })
  f.bind()
  f.bind(secondNonce)
  rejectOld(new Error('Old document revoked'))
  await flush()
  assert.equal(f.click().prevented, true)
  assert.equal(f.messages.at(-1).nonce, secondNonce)
  assert.equal(f.intervals.size, 1)
})

test('top and nested frames register no event forwarding', () => {
  for (const options of [{ nested: true }, { top: true }]) {
    const f = fixture(options)
    f.bind()
    assert.equal(f.listeners.size, 0)
    assert.equal(f.messages.length, 0)
  }
})

test('manifest injects only isolated frame scripts and retires MAIN popup interception', async () => {
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'))
  assert.equal(manifest.content_scripts.some(script => script.world === 'MAIN'), false)
  assert.equal(manifest.content_scripts.some(script => script.js.includes('frame-popups.js')), false)
  const scripts = manifest.content_scripts.find(script => script.js.includes('frame-links.js')).js
  assert.ok(scripts.indexOf('frame-links.js') < scripts.indexOf('frame-agent.js'))
  const retired = await readFile(new URL('../extension/frame-popups.js', import.meta.url), 'utf8')
  vm.runInNewContext(retired, { window: new Proxy({}, { get() { throw new Error('Retired script must be inert') } }) })
})
