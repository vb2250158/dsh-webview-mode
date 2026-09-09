/** DSH host registration for conversation-owned browser archives. */
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { BrowserBroker } from './broker.js'
import { ArchiveStore } from './archive.js'

export const name = 'webview-mode'
export const inject = ['sessions', 'tools']
export const Config = z.object({
  commandTimeoutMs: z.number().min(5000).max(120000).default(45000),
  dataDirectory: z.string().default(join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'webview-mode', 'archives')),
})
const initializers = []

class WebviewArchive extends TypertRemoteService {
  constructor(ctx, config) {
    super(ctx, 'webviewArchive')
    this.sessions = ctx.sessions
    this.broker = new BrowserBroker(config.commandTimeoutMs)
    ctx.effect(() => () => this.broker.dispose())
    this.store = new ArchiveStore(config.dataDirectory)
    for (const initialize of initializers) initialize.call(this)
  }
  async next(request) {
    if (!this.sessions.get(request.sessionId)) throw new Error('当前对话尚未加载')
    return this.broker.next(request.sessionId, request.token)
  }
  async complete(request) {
    if (!this.sessions.get(request.sessionId)) throw new Error('当前对话尚未加载')
    return this.broker.complete(request.sessionId, request.token, request.text, request.error)
  }
  async visibility(request) {
    if (!this.sessions.get(request.sessionId)) throw new Error('当前对话尚未加载')
    return this.store.setVisibility(request.sessionId, request.open)
  }
  async setup() {
    return { extensionDirectory: fileURLToPath(new URL('../extension/', import.meta.url)) }
  }
  async read(request) {
    if (!this.sessions.get(request.sessionId)) throw new Error('当前对话尚未加载')
    return this.store.read(request.sessionId)
  }
  async write(request) {
    if (!this.sessions.get(request.sessionId)) throw new Error('当前对话尚未加载')
    return this.store.write(request)
  }
}
for (const method of ['read', 'write', 'setup', 'next', 'complete', 'visibility']) Remote(method)(WebviewArchive.prototype[method], {
  private: false, static: false, name: method,
  addInitializer(initialize) { initializers.push(initialize) },
})

export function apply(ctx, config) {
  const service = new WebviewArchive(ctx, config)
  ctx.tools.register(defineTool({
    name: 'conversation_browser',
    description: 'Manage the iframe browser in this conversation: navigate(url), new, select(tabId), close(tabId), reload. Navigation only requests display; loading may be blocked by the website. This trial cannot inspect or interact with cross-origin page content. Do not claim to have read a page. Browser login is subject to third-party cookie rules.',
    parameters: {
      action: { type: 'string', required: true, enum: ['navigate', 'new', 'select', 'close', 'reload'] },
      url: { type: 'string' }, ref: { type: 'integer' }, text: { type: 'string' }, key: { type: 'string' }, deltaY: { type: 'number' }, tabId: { type: 'string' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } }, render: (_args, value) => [{ type: 'text', text: value.text }] },
    timeoutMs: config.commandTimeoutMs + 5000,
    isConcurrencySafe: () => false,
    execute(args, exec) {
      if (!exec.agent) throw new Error('Browser tool requires a conversation agent')
      return service.broker.request(exec.agent.session.id, args, exec.signal)
    },
    presentCall: args => ({ card: 'generic', title: '对话浏览器', kind: 'other', rawInput: args.action }),
  }))
}
