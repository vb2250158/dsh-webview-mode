/** Durable browser tab metadata. Browser credentials remain owned by the browser. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

export const tabSchema = z.object({
  id: z.string().min(1).max(128),
  url: z.string().max(16384).refine(value => {
    if (value === 'about:blank') return true
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password }
    catch { return false }
  }, 'Only HTTP(S) addresses are supported'),
  title: z.string().max(4096),
})
export const archiveSchema = z.object({
  version: z.literal(1),
  open: z.boolean().default(false),
  sessionId: z.string().min(1).max(256),
  revision: z.number().int().nonnegative(),
  active: z.string().max(128).nullable(),
  tabs: z.array(tabSchema).max(100),
}).superRefine((value, ctx) => {
  const ids = new Set(value.tabs.map(tab => tab.id))
  if (ids.size !== value.tabs.length || (value.active !== null && !ids.has(value.active))) ctx.addIssue({ code: 'custom', message: 'Tab identity is inconsistent' })
})

/** Stores each conversation separately and rejects stale client writes. */
export class ArchiveStore {
  constructor(root) { this.root = root; this.pending = Promise.resolve() }

  path(sessionId) {
    z.string().min(1).max(256).parse(sessionId)
    return join(this.root, createHash('sha256').update(sessionId).digest('hex') + '.json')
  }

  async read(sessionId) {
    let text
    try { text = await readFile(this.path(sessionId), 'utf8') }
    catch (error) {
      if (error.code !== 'ENOENT') throw error
      return { version: 1, sessionId, revision: 0, open: false, active: null, tabs: [] }
    }
    const value = archiveSchema.parse(JSON.parse(text))
    if (value.sessionId !== sessionId) throw new Error('Archive session mismatch')
    return value
  }

  setVisibility(sessionId, open) {
    const operation = this.pending.then(async () => {
      const next = { ...await this.read(sessionId), open }
      await mkdir(this.root, { recursive: true })
      const temporary = join(this.root, randomUUID() + '.tmp')
      await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 })
      await rename(temporary, this.path(sessionId))
      return next
    })
    this.pending = operation.catch(() => {})
    return operation
  }
  write(request) {
    const value = archiveSchema.parse(request)
    const operation = this.pending.then(async () => {
      const previous = await this.read(value.sessionId)
      if (previous.revision !== value.revision) throw new Error('浏览器存档已在另一页面更新，请重新打开面板')
      const next = { ...value, open: previous.open, revision: value.revision + 1 }
      await mkdir(this.root, { recursive: true })
      const temporary = join(this.root, randomUUID() + '.tmp')
      await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 })
      await rename(temporary, this.path(value.sessionId))
      return next
    })
    this.pending = operation.catch(() => {}) // The returned operation preserves the failure for its caller.
    return operation
  }
}
