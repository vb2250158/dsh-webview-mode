import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

// An existing workspace dependency may be supplied explicitly; never install one here.
let JSDOM
try {
  const require = createRequire(process.env.DSH_DOM_TEST_RESOLVE_FROM || import.meta.url)
  ;({ JSDOM } = require('jsdom'))
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error
}
const source = await readFile(new URL('../extension/frame-dom.js', import.meta.url), 'utf8')
function fixture(html) {
  const dom = new JSDOM(html, { url: 'https://site.example/page', runScripts: 'outside-only' })
  const w = dom.window
  w.HTMLElement.prototype.getClientRects = function () { return [{}] }
  w.HTMLElement.prototype.scrollIntoView = function () { w.document.elementFromPoint = () => this }
  w.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 10, height: 10 })
  w.eval(source)
  const controller = w.createFrameDomController()
  return { w, doc: w.document, execute: controller.execute, close: () => w.close() }
}
const check = (name, fn) => test(name, { skip: !JSDOM && 'jsdom unavailable; set DSH_DOM_TEST_RESOLVE_FROM to an existing workspace package.json' }, fn)

check('snapshot is bounded and excludes input values, sensitive inputs and hidden text', t => {
  const f = fixture('<title>Title</title><p>Hello</p><input value="SECRET"><input type="password" value="PASSWORD"><textarea>DEFAULT SECRET</textarea><div hidden>HIDDEN</div><script>SECRET SCRIPT</script>' + '<button>Action</button>'.repeat(220))
  t.after(f.close)
  const s = f.execute({ action: 'snapshot' })
  assert.equal(s.url, 'https://site.example/page')
  assert.equal(s.title, 'Title')
  assert.equal(s.elements.length, 200)
  assert.ok(s.content.includes('Hello'))
  assert.doesNotMatch(JSON.stringify(s), /SECRET|PASSWORD|HIDDEN/)
  f.doc.body.innerHTML = '<select>' + ('<option value="' + 'x'.repeat(2000) + '">' + 'y'.repeat(2000) + '</option>').repeat(20) + '</select><p>' + '"\\'.repeat(30000) + '</p>'
  assert.ok(JSON.stringify(f.execute({ action: 'snapshot' })).length <= 24000)
})

check('refs expire on new snapshots, URL changes and unavailable nodes', t => {
  const f = fixture('<button>Action</button>'); t.after(f.close)
  const a = f.execute({ action: 'snapshot' })
  const b = f.execute({ action: 'snapshot' })
  assert.throws(() => f.execute({ action: 'click', snapshotId: a.snapshotId, ref: 1 }), /expired/)
  assert.throws(() => f.execute({ action: 'click', snapshotId: b.snapshotId, ref: 99 }), /Unknown/)
  const button = f.doc.querySelector('button')
  for (const attr of ['hidden', 'disabled', 'inert']) {
    button.setAttribute(attr, '')
    assert.throws(() => f.execute({ action: 'click', snapshotId: b.snapshotId, ref: 1 }), /unavailable/)
    button.removeAttribute(attr)
  }
  button.style.display = 'none'
  assert.throws(() => f.execute({ action: 'click', snapshotId: b.snapshotId, ref: 1 }), /unavailable/)
  button.style.display = ''
  f.doc.body.setAttribute('inert', '')
  assert.throws(() => f.execute({ action: 'click', snapshotId: b.snapshotId, ref: 1 }), /unavailable/)
  f.doc.body.removeAttribute('inert')
  f.w.history.replaceState(null, '', '/other')
  assert.throws(() => f.execute({ action: 'scroll', snapshotId: b.snapshotId, deltaY: 1 }), /expired/)
  f.w.history.replaceState(null, '', '/page')
  button.remove()
  assert.throws(() => f.execute({ action: 'click', snapshotId: b.snapshotId, ref: 1 }), /unavailable/)
})

check('recycled elements with changed labels or links require a fresh snapshot', t => {
  const f = fixture('<button>Save</button><a href="/safe">Next</a>'); t.after(f.close)
  const snapshot = f.execute({ action: 'snapshot' })
  f.doc.querySelector('button').textContent = 'Delete'
  f.doc.querySelector('a').setAttribute('href', '/different')
  for (const ref of [1, 2]) assert.throws(() => f.execute({ action: 'click', snapshotId: snapshot.snapshotId, ref }), /changed/)
})

check('obscured elements do not receive clicks', t => {
  const f = fixture('<button>Action</button><div>Overlay</div>'); t.after(f.close)
  const snapshot = f.execute({ action: 'snapshot' })
  const button = f.doc.querySelector('button')
  let clicks = 0
  button.addEventListener('click', () => clicks++)
  button.scrollIntoView = () => { f.doc.elementFromPoint = () => f.doc.querySelector('div') }
  assert.throws(() => f.execute({ action: 'click', snapshotId: snapshot.snapshotId, ref: 1 }), /obscured/)
  assert.equal(clicks, 0)
})

check('text uses native setters and dispatches input/change; unsupported editors reject', t => {
  const f = fixture('<input><textarea></textarea><input type="submit"><input type="number"><div contenteditable="true">Edit</div>'); t.after(f.close)
  const s = f.execute({ action: 'snapshot' })
  const input = f.doc.querySelector('input')
  const events = []
  Object.defineProperty(input, 'value', { set() { throw Error('own setter must not run') }, get() { return 'override' } })
  input.addEventListener('input', () => events.push('input'))
  input.addEventListener('change', () => events.push('change'))
  const run = (ref, text) => f.execute({ action: 'text', snapshotId: s.snapshotId, ref, text })
  run(1, 'abc'); run(2, 'def')
  assert.deepEqual(events, ['input', 'change'])
  assert.equal(Object.getOwnPropertyDescriptor(f.w.HTMLInputElement.prototype, 'value').get.call(input), 'abc')
  assert.equal(f.doc.querySelector('textarea').value, 'def')
  for (const ref of [3, 4]) assert.throws(() => run(ref, 'x'), /not a text/)
  assert.throws(() => run(1, 'x'.repeat(10001)), /limit/)
  input.readOnly = true
  assert.throws(() => run(1, 'x'), /read-only/)
  input.readOnly = false
  input.type = 'password'
  assert.throws(() => run(1, 'x'), /unavailable/)
  input.type = 'file'
  assert.throws(() => run(1, 'x'), /unavailable/)
  const editable = f.doc.querySelector('div')
  Object.defineProperty(editable, 'isContentEditable', { value: true })
  run(5, '<b>literal</b>')
  assert.equal(editable.innerHTML, '&lt;b&gt;literal&lt;/b&gt;')
})

check('choose validates options and scroll validates snapshot, ref and finite delta', t => {
  const f = fixture('<select><option value="a">A</option><option value="b">B</option><option disabled value="c">C</option></select>'); t.after(f.close)
  const s = f.execute({ action: 'snapshot' })
  assert.equal(s.elements[0].options[1].value, 'b')
  const events = []
  const select = f.doc.querySelector('select')
  select.addEventListener('input', () => events.push('input')); select.addEventListener('change', () => events.push('change'))
  const choose = value => f.execute({ action: 'choose', snapshotId: s.snapshotId, ref: 1, value })
  choose('b'); assert.equal(select.value, 'b'); assert.deepEqual(events, ['input', 'change'])
  for (const value of ['c', 'missing', 3]) assert.throws(() => choose(value))
  const deltas = []
  f.w.scrollBy = request => deltas.push(request.top)
  select.scrollBy = request => deltas.push(request.top)
  f.execute({ action: 'scroll', snapshotId: s.snapshotId, deltaY: 10000 })
  f.execute({ action: 'scroll', snapshotId: s.snapshotId, ref: 1, deltaY: -10000 })
  assert.deepEqual(deltas, [10000, -10000])
  for (const deltaY of [10001, -10001, NaN, Infinity, '1']) assert.throws(() => f.execute({ action: 'scroll', snapshotId: s.snapshotId, deltaY }))
  assert.throws(() => f.execute({ action: 'scroll', deltaY: 1 }), /expired/)
  assert.throws(() => f.execute({ action: 'eval', code: 'anything' }), /Unsupported/)
})

check('click permits buttons, returns blank links to parent, and rejects unsafe links', t => {
  const f = fixture('<button>Go</button><a href="/next" target="_blank">Next</a><a href="javascript:alert(1)">Bad</a><a href="/file" download>Download</a><a href="https://user:pass@example.com">Credential</a>'); t.after(f.close)
  const s = f.execute({ action: 'snapshot' })
  let clicks = 0
  f.doc.querySelector('button').addEventListener('click', () => clicks++)
  f.doc.querySelector('a').addEventListener('click', () => { throw Error('must not click blank link') })
  const click = ref => f.execute({ action: 'click', snapshotId: s.snapshotId, ref })
  click(1); assert.equal(clicks, 1)
  assert.equal(click(2).openUrl, 'https://site.example/next')
  for (const ref of [3, 4, 5]) assert.throws(() => click(ref), /not allowed/)
})
