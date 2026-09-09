import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArchiveStore } from '../lib/archive.js'

test('panel visibility and final tab URLs survive a new store while stale clients cannot overwrite visibility', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-restore-'))
  try {
    const store = new ArchiveStore(directory)
    const old = await store.read('conversation')
    await store.setVisibility('conversation', true)
    await store.write({ ...old, tabs: [{ id: 'first', url: 'https://example.com/after-navigation', title: 'Final page' }], active: 'first' })
    let restored = await new ArchiveStore(directory).read('conversation')
    assert.equal(restored.open, true)
    assert.equal(restored.active, 'first')
    assert.equal(restored.tabs[0].url, 'https://example.com/after-navigation')
    await store.setVisibility('conversation', false)
    await store.write({ ...restored, tabs: [...restored.tabs, { id: 'second', url: 'https://example.com/second', title: 'Second' }] })
    restored = await new ArchiveStore(directory).read('conversation')
    assert.equal(restored.open, false)
    assert.deepEqual(restored.tabs.map(tab => tab.id), ['first', 'second'])
    assert.equal((await store.read('other')).tabs.length, 0)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
