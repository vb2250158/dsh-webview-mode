import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

test('link tracking does not register on ordinary top-level websites', async () => {
  const window = { addEventListener() { assert.fail('Top-level page must not capture links') } }
  window.top = window
  window.parent = window
  runInNewContext(await readFile(new URL('../extension/frame-links.js', import.meta.url), 'utf8'), { window })
})
