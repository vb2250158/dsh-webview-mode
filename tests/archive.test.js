import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArchiveStore } from '../lib/archive.js'

test('session archives survive reopening and never inherit another conversation tabs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-webview-test-'))
  try {
    const store = new ArchiveStore(root)
    const first = await store.read('conversation-a')
    const next = await store.write({ ...first, active: 'tab-a', tabs: [{ id: 'tab-a', title: 'Example', url: 'https://example.com/' }] })
    assert.deepEqual(await new ArchiveStore(root).read('conversation-a'), next)
    assert.equal((await store.read('conversation-b')).tabs.length, 0)
    await assert.rejects(store.write(first), /另一页面更新/)
    assert.throws(() => store.write({ ...next, revision: next.revision, tabs: [{ id: 'tab-a', title: '', url: 'file:///C:/secret' }] }))
  } finally { await rm(root, { recursive: true, force: true }) }
})
