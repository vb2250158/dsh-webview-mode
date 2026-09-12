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

check('snapshot is bounded and excludes sensitive inputs and hidden text', t => {
  const f = fixture('<title>Title</title><p>Hello</p><input value="Visible"><input type="password" value="PASSWORD"><textarea>Visible default</textarea><div hidden>HIDDEN</div><script>SECRET SCRIPT</script>' + '<button>Action</button>'.repeat(220))
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

check('associated labels identify controls and snapshots verify current writes and selections', t => {
  const f = fixture('<label for="field">Account</label><input id="field" value="initial"><label>Biography<textarea>default</textarea></label><label><input type="checkbox" checked>Enabled</label><input type="radio"><select><option value="a">A</option><option value="b" label="Bee">B</option></select>'); t.after(f.close)
  let s = f.execute({ action: 'snapshot' })
  assert.equal(s.elements[0].name, 'Account')
  assert.equal(s.elements[0].type, 'text')
  assert.equal(s.elements[0].value, 'initial')
  assert.equal(s.elements[1].name, 'Biography')
  assert.equal(s.elements[2].checked, true)
  assert.equal(s.elements[3].checked, false)
  f.execute({ action: 'text', snapshotId: s.snapshotId, ref: 1, text: 'written' })
  f.execute({ action: 'text', snapshotId: s.snapshotId, ref: 2, text: 'current\ntext' })
  f.execute({ action: 'choose', snapshotId: s.snapshotId, ref: 5, value: 'b' })
  s = f.execute({ action: 'snapshot' })
  assert.equal(s.elements[0].value, 'written')
  assert.equal(s.elements[1].value, 'current\ntext')
  assert.equal(s.elements[4].options[0].selected, false)
  assert.equal(s.elements[4].options[1].selected, true)
  assert.equal(s.elements[4].options[1].name, 'Bee')
  f.execute({ action: 'click', snapshotId: s.snapshotId, ref: 3 })
  s = f.execute({ action: 'snapshot' })
  assert.equal(s.elements[2].checked, false)
  f.doc.querySelector('label').textContent = 'Different account'
  assert.throws(() => f.execute({ action: 'text', snapshotId: s.snapshotId, ref: 1, text: 'no' }), /changed/)
})

check('values use an allowlist and password/file controls are never read or referenced', t => {
  const f = fixture('<input type="password" aria-label="PRIVATE PASSWORD"><input type="file" title="PRIVATE FILE"><input type="hidden" value="PRIVATE HIDDEN"><input type="number" value="123"><input type="checkbox" value="PRIVATE CHECK"><input type="text"><textarea></textarea>'); t.after(f.close)
  for (const input of f.doc.querySelectorAll('input[type="password"],input[type="file"]')) Object.defineProperty(input, 'value', { get() { throw Error('sensitive value read') } })
  f.doc.querySelector('input[type="text"]').value = '"\\'.repeat(10000)
  f.doc.querySelector('textarea').value = '"\\'.repeat(10000)
  const s = f.execute({ action: 'snapshot' })
  assert.doesNotMatch(JSON.stringify(s), /PRIVATE|password|file/)
  assert.ok(s.elements.every(item => !['hidden', 'number', 'checkbox'].includes(item.type) || !Object.hasOwn(item, 'value')))
  assert.ok(s.elements.every(item => item.value === undefined || item.value.length <= 10000))
  assert.ok(JSON.stringify(s).length <= 24000)
  for (const type of ['text', 'search', 'email', 'url', 'tel']) {
    f.doc.body.innerHTML = `<input type="${type}" value="visible">`
    assert.equal(f.execute({ action: 'snapshot' }).elements[0].value, 'visible')
  }
})

check('resolved destinations and option definitions invalidate stale refs', t => {
  const f = fixture('<base href="https://site.example/one/"><a href="next">Next</a><form action="submit"><button>Submit</button></form><select><option value="a">A</option><option value="b">B</option></select>'); t.after(f.close)
  let s = f.execute({ action: 'snapshot' })
  assert.equal(s.elements[0].href, 'https://site.example/one/next')
  f.doc.querySelector('base').href = 'https://site.example/two/'
  for (const ref of [1, 2]) assert.throws(() => f.execute({ action: 'click', snapshotId: s.snapshotId, ref }), /changed/)
  s = f.execute({ action: 'snapshot' })
  f.doc.querySelector('form').action = '/different'
  assert.throws(() => f.execute({ action: 'click', snapshotId: s.snapshotId, ref: 2 }), /changed/)
  const option = f.doc.querySelectorAll('option')[1]
  for (const mutate of [() => { option.value = 'c' }, () => { option.label = 'Changed' }, () => { option.disabled = true }, () => { option.remove() }]) {
    s = f.execute({ action: 'snapshot' })
    mutate()
    assert.throws(() => f.execute({ action: 'choose', snapshotId: s.snapshotId, ref: 3, value: 'a' }), /changed/)
  }
})

check('href metadata omits unsafe, credential-bearing and oversized URLs', t => {
  const f = fixture('<a href="/ok">OK</a><a href="javascript:void(0)">Script</a><a href="https://user:fake@example.com/">Credentials</a><a href="/' + 'x'.repeat(2001) + '">Long</a>'); t.after(f.close)
  const s = f.execute({ action: 'snapshot' })
  assert.equal(s.elements[0].href, 'https://site.example/ok')
  for (const item of s.elements.slice(1)) assert.equal(Object.hasOwn(item, 'href'), false)
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
