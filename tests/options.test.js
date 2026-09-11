import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

test('extension options accept exact HTTP origins and reject paths and credentials', async () => {
  const context = { URL, document: { getElementById: () => ({ addEventListener() {} }) }, chrome: { storage: { sync: { get: async () => ({}) } } } }
  runInNewContext(await readFile(new URL('../extension/options.js', import.meta.url), 'utf8'), context)
  assert.equal(context.parseOrigins('https://dsh.example/\nhttps://dsh.example')[0], 'https://dsh.example')
  assert.equal(context.parseOrigins('http://localhost:4321')[0], 'http://localhost:4321')
  for (const value of ['', 'file:///tmp', 'https://user:secret@example.com', 'https://example.com/path', 'https://example.com/?q=1', 'https://example.com/#hash']) assert.throws(() => context.parseOrigins(value))
})
