import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

test('retired MAIN popup adapter cannot override window.open or send page messages', async () => {
  const original = () => undefined
  const window = { open: original, postMessage() { assert.fail('No page message channel') } }
  runInNewContext(await readFile(new URL('../extension/frame-popups.js', import.meta.url), 'utf8'), { window })
  assert.equal(window.open, original)
})
