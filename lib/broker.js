/** Session-owned browser commands; a claim is delivered once and never replayed automatically. */
import { randomUUID } from 'node:crypto'

export class BrowserBroker {
  constructor(timeoutMs) { this.timeoutMs = timeoutMs; this.jobs = new Map() }
  request(sessionId, action, signal) {
    if (signal?.aborted) return Promise.reject(new Error('Browser operation cancelled'))
    if (this.jobs.has(sessionId)) return Promise.reject(new Error('当前对话有浏览器操作正在执行'))
    return new Promise((resolve, reject) => {
      const token = randomUUID()
      const finish = (error, value) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        this.jobs.delete(sessionId)
        if (error) reject(new Error(error)); else resolve(value)
      }
      const abort = () => finish('浏览器操作已取消；已发出的页面操作可能已执行，请先检查页面')
      const timer = setTimeout(() => finish('浏览器未及时完成操作。请打开当前对话，在设置 > 浏览器中完成扩展连接；不要直接重复有副作用的操作。'), this.timeoutMs)
      signal?.addEventListener('abort', abort, { once: true })
      this.jobs.set(sessionId, { token, action, expiresAt: Date.now() + this.timeoutMs, claimed: false, finish })
    })
  }
  next(sessionId, token) {
    const job = this.jobs.get(sessionId)
    if (token !== undefined) return { active: !!job && job.token === token && job.expiresAt > Date.now() }
    if (!job || job.claimed) return null
    job.claimed = true
    return { token: job.token, action: job.action, expiresAt: job.expiresAt }
  }
  complete(sessionId, token, text, error) {
    const job = this.jobs.get(sessionId)
    if (!job || !job.claimed || job.token !== token) throw new Error('浏览器操作已结束或不属于当前对话')
    job.finish(error, { text })
    return { completed: true }
  }
  dispose() { for (const job of [...this.jobs.values()]) job.finish('浏览器插件已停止') }
}
