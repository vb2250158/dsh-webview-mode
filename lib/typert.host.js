/** Typed wire descriptors for the archive service. */
import { z } from 'zod'
import { archiveSchema } from './archive.js'
const packageName = 'dsh-webview-mode'
export const TYPERT = {
  package: packageName, face: 'host', schemas: [],
  invocations: ['read', 'write', 'setup', 'next', 'complete', 'visibility'].map(method => ({
    id: `${packageName}#webviewArchive/${method}`,
    service: 'webviewArchive', namespace: 'webviewArchive', method,
    invocation: { kind: 'direct' },
    parameters: [{ name: 'request', wire: 'request', source: 'json', codec: {
      mode: 'strict', typeSymbol: `${packageName}#${method}Request`,
      create: () => ( method === 'visibility' ? z.object({ sessionId: z.string().min(1).max(256), open: z.boolean() }) : method === 'next' ? z.object({ sessionId: z.string(), token: z.string().optional() }) : method === 'complete' ? z.object({ sessionId: z.string(), token: z.string(), text: z.string().max(100000), error: z.string().max(4096).optional() }) : method === 'setup' ? z.object({}) : method === 'read' ? z.object({ sessionId: z.string().min(1).max(256) }) : archiveSchema),
    } }],
    result: { mode: 'strict', typeSymbol: `${packageName}#${method === 'setup' ? 'Setup' : 'Archive'}`, create: () => ( ['next', 'complete'].includes(method) ? z.unknown() : method === 'setup' ? z.object({ extensionDirectory: z.string(), connectionTimeoutMs: z.number().int().min(500).max(4000) }) : archiveSchema) },
    sourceLocation: { file: 'lib/index.js', line: 23, column: 3 },
  })),
  model: { services: [], events: [], objects: [] },
}
