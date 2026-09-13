import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

let chromium
try {
  const require = createRequire(process.env.DSH_DOM_TEST_RESOLVE_FROM || import.meta.url)
  ;({ chromium } = require('playwright'))
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error
}
const extensionPath = fileURLToPath(new URL('../extension/', import.meta.url))
const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
const start = client.indexOf('    function extensionRequest(')
const end = client.indexOf('    function Panel(', start)
assert.ok(start >= 0 && end > start, 'Expected the two current client bridge helpers')
const helpers = client.slice(start, end)

async function serve(t, handler) {
  const server = createServer(handler)
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  t.after(async () => {
    const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    server.closeAllConnections()
    await closed
  })
  return `http://127.0.0.1:${server.address().port}`
}

// Opt-in dependency resolution uses already installed Playwright; no browser download occurs.
test('real extension commands operate only the bound visible iframe document', {
  skip: !chromium && 'Set DSH_DOM_TEST_RESOLVE_FROM to an existing Playwright-owning package.json',
  timeout: 90000,
}, async t => {
  const childOrigin = await serve(t, (_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><title>Frame fixture</title><label>Text<input aria-label="Text"></label><button onclick="document.querySelector(\'output\').textContent=\'clicked\'">Click me</button><output>waiting</output>')
  })
  const topOrigin = await serve(t, (_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end(`<!doctype html><title>Top fixture</title><iframe sandbox="allow-scripts allow-same-origin allow-forms" style="width:700px;height:400px" src="${childOrigin}/frame"></iframe>`)
  })
  const profile = await mkdtemp(join(tmpdir(), 'dsh-frame-browser-'))
  let context
  t.after(async () => {
    try { if (context) await context.close() }
    finally { await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
  })
  context = await chromium.launchPersistentContext(profile, {
    headless: false,
    ...(process.env.DSH_EXTENSION_BROWSER_EXECUTABLE ? { executablePath: process.env.DSH_EXTENSION_BROWSER_EXECUTABLE } : {}),
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    timeout: 30000,
  })
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 20000 })
  await worker.evaluate(async origin => { await chrome.storage.sync.set({ trustedOrigins: [origin] }) }, topOrigin)
  const page = context.pages()[0] || await context.newPage()
  await page.goto(topOrigin, { waitUntil: 'load' })
  await page.addScriptTag({ content: helpers })
  const capabilities = await page.evaluate(() => extensionRequest({ kind: 'status' }, Date.now() + 10000))
  assert.equal(capabilities.configured, true)
  assert.equal(capabilities.version, '0.2.3')
  const initialTabs = context.pages().length
  const command = action => page.evaluate(async action => {
    const nonce = crypto.randomUUID(), deadline = Date.now() + 10000
    await extensionRequest({ kind: 'prepare-frame', nonce, deadline }, deadline)
    await bindFrame(document.querySelector('iframe'), nonce, deadline)
    const result = await extensionRequest({ kind: 'frame-command', nonce, deadline, action }, deadline)
    if (result.error) throw new Error(result.error)
    return result.value
  }, action)
  let snapshot = await command({ action: 'snapshot' })
  assert.equal(snapshot.title, 'Frame fixture')
  const input = snapshot.elements.find(element => element.name === 'Text')
  assert.ok(input)
  await command({ action: 'text', snapshotId: snapshot.snapshotId, ref: input.ref, text: 'real extension input' })
  const frame = page.frames().find(frame => frame.url().startsWith(childOrigin))
  assert.ok(frame)
  assert.equal(await frame.locator('input').inputValue(), 'real extension input')
  snapshot = await command({ action: 'snapshot' })
  assert.equal(snapshot.elements.find(element => element.name === 'Text').value, 'real extension input')
  const button = snapshot.elements.find(element => element.name.trim() === 'Click me')
  assert.ok(button)
  await command({ action: 'click', snapshotId: snapshot.snapshotId, ref: button.ref })
  assert.equal(await frame.locator('output').textContent(), 'clicked')
  assert.equal(context.pages().length, initialTabs)
  await frame.goto(`${childOrigin}/replacement`, { waitUntil: 'load' })
  await assert.rejects(command({ action: 'click', snapshotId: snapshot.snapshotId, ref: button.ref }), /navigated|not connected|binding changed|Snapshot expired/)
  assert.equal(await frame.locator('output').textContent(), 'waiting')
  assert.equal(context.pages().length, initialTabs)

  // The non-configured origin has the top bridge too, but must never receive a response.
  await page.goto(`${childOrigin}/untrusted`, { waitUntil: 'load' })
  await page.addScriptTag({ content: helpers })
  const unconfigured = await page.evaluate(() => extensionRequest({ kind: 'status' }, Date.now() + 10000))
  assert.equal(unconfigured.configured, false)
  const rejected = await page.evaluate(async () => {
    const deadline = Date.now() + 1000
    try { await extensionRequest({ kind: 'prepare-frame', nonce: crypto.randomUUID(), deadline }, deadline); return false }
    catch { return true }
  })
  assert.equal(rejected, true)
  assert.equal(context.pages().length, initialTabs)
})
