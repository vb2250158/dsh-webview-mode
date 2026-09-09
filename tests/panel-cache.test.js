import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

test('returning to a conversation reuses its connected panel and React root', async () => {
  let factory
  let roots = 0, renders = 0
  const children = []
  const context = {
    window: { __ModuleLoader__: { load(module) { factory = module.factory } } },
    document: {
      createElement: () => ({ dataset: {}, style: {} }),
      body: { append(element) { children.push(element) } },
    },
  }
  const source = (await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')).replace('function cachedPanel(', 'globalThis.cachedPanel = function cachedPanel(')
  runInNewContext(source, context)
  factory(name => name === 'react' ? { createElement: (...args) => args } : { createRoot() { roots++; return { render() { renders++ } } } })
  const first = context.cachedPanel('agent-a', {})
  first.container.style.display = 'none'
  const second = context.cachedPanel('agent-b', {})
  second.container.style.display = 'none'
  const returned = context.cachedPanel('agent-a', {})
  assert.equal(returned, first)
  assert.notEqual(second.container, first.container)
  assert.equal(roots, 2)
  assert.equal(renders, 2)
  assert.equal(children.length, 2)
  assert.equal(children[0], first.container)
})
