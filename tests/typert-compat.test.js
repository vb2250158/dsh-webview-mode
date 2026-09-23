import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TYPERT } from '../lib/typert.host.js'

test('Host codecs expose the same Zod schema to both supported loader versions', () => {
  for (const invocation of TYPERT.invocations) {
    for (const codec of [...invocation.parameters.map(parameter => parameter.codec), invocation.result]) {
      assert.ok('_zod' in codec.schema, `${invocation.method} uses a Zod v4 schema`)
      assert.equal(codec.create(), codec.schema, `${invocation.method} has one schema for both loader fields`)
    }
  }
})
