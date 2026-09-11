/* Classic content-script helper. All snapshot strings are untrusted page data.
 * The caller owns frame authentication and user authorization. No listeners are installed.
 */
function createFrameDomController() {
  const textTypes = new Set(['text', 'search', 'email', 'url', 'tel'])
  let snapshotId = null
  let snapshotUrl = null
  let refs = new Map()
  const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  const textareaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
  function available(element) {
    if (!(element instanceof HTMLElement) || !element.isConnected || element.ownerDocument !== document) return false
    if (element.matches(':disabled') || element.disabled) return false
    for (let node = element; node instanceof HTMLElement; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (node.hidden || node.inert || node.hasAttribute('inert') || node.getAttribute('aria-disabled') === 'true' || node.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0' || style.contentVisibility === 'hidden') return false
    }
    return element.getClientRects().length > 0
  }
  function sensitive(element) {
    return element instanceof HTMLInputElement && ['password', 'file'].includes(element.type)
  }
  // Walk text nodes instead of reading input values, textarea defaults, or script content.
  function pageText(root, limit) {
    let text = ''
    function visit(node) {
      if (text.length >= limit) return
      if (node.nodeType === 3) { text += (node.textContent || '').slice(0, limit - text.length); return }
      if (!(node instanceof HTMLElement) || !available(node) || ['INPUT', 'TEXTAREA', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(node.tagName)) return
      for (const child of node.childNodes) visit(child)
      if (text.length < limit) text += ' '
    }
    visit(root)
    return text.slice(0, limit)
  }
  function role(element) {
    return element.getAttribute('role') || ({ A: 'link', BUTTON: 'button', SELECT: 'combobox', TEXTAREA: 'textbox', INPUT: 'input' }[element.tagName]) || (element.isContentEditable ? 'textbox' : 'element')
  }
  function semantics(element) {
    return JSON.stringify([element.tagName, element.getAttribute('type'), element.getAttribute('role'), element.getAttribute('aria-label'), element.getAttribute('title'), element.getAttribute('href'), element.getAttribute('target'), element.getAttribute('formaction'), element.getAttribute('name'), pageText(element, 500)])
  }
  function snapshot() {
    refs = new Map()
    snapshotId = crypto.randomUUID()
    snapshotUrl = document.URL
    // The complete serialized output, including metadata and options, fits the protocol budget.
    const result = { snapshotId, url: snapshotUrl, title: '', content: '', elements: [] }
    const size = () => JSON.stringify(result).length
    if (size() > 24000) throw new Error('Snapshot URL exceeds output limit')
    result.title = String(document.title).slice(0, 1000)
    if (size() > 24000) result.title = ''
    for (const element of document.querySelectorAll('a[href],button,input,textarea,select,[contenteditable],[role],[tabindex]')) {
      if (result.elements.length >= 200) break
      if (!available(element) || sensitive(element)) continue
      const item = { ref: result.elements.length + 1, role: role(element).slice(0, 100), name: (element.getAttribute('aria-label') || element.getAttribute('title') || pageText(element, 500)).slice(0, 500) }
      if (element instanceof HTMLSelectElement) item.options = []
      result.elements.push(item)
      if (size() > 24000) { result.elements.pop(); break }
      if (element instanceof HTMLSelectElement) {
        for (const option of element.options) {
          const entry = { value: option.value, name: option.textContent || '', disabled: option.disabled || option.parentElement?.disabled === true }
          item.options.push(entry)
          if (size() > 24000) { item.options.pop(); break }
        }
      }
      refs.set(item.ref, { element, semantics: semantics(element) })
    }
    const content = pageText(document.body, 24000)
    let low = 0, high = content.length
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      result.content = content.slice(0, mid)
      if (size() <= 24000) low = mid
      else high = mid - 1
    }
    result.content = content.slice(0, low)
    return result
  }
  function unobstructed(element) {
    element.scrollIntoView({ block: 'center', inline: 'center' })
    const rect = element.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    if (!hit || (hit !== element && !element.contains(hit))) throw new Error('Element is obscured; take a new snapshot')
  }
  function events(element) {
    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }
  function execute(request) {
    if (!request || typeof request !== 'object' || !['snapshot', 'click', 'text', 'choose', 'scroll'].includes(request.action)) throw new Error('Unsupported DOM action')
    if (request.action === 'snapshot') return snapshot()
    if (!snapshotId || request.snapshotId !== snapshotId || document.URL !== snapshotUrl) throw new Error('Snapshot expired; take a new snapshot')
    let element
    if (request.action !== 'scroll' || request.ref !== undefined) {
      if (!Number.isSafeInteger(request.ref) || !refs.has(request.ref)) throw new Error('Unknown element ref')
      const reference = refs.get(request.ref)
      element = reference.element
      if (!available(element) || sensitive(element)) throw new Error('Element unavailable')
      if (reference.semantics !== semantics(element)) throw new Error('Element changed; take a new snapshot')
    }
    if (request.action !== 'scroll') unobstructed(element)
    switch (request.action) {
      case 'click': {
        const link = element.closest('a[href]')
        if (link) {
          if (!(link instanceof HTMLElement) || !available(link) || link.hasAttribute('download')) throw new Error('Link is not allowed')
          const url = new URL(link.getAttribute('href'), document.baseURI)
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Link URL is not allowed')
          const target = (link.getAttribute('target') || document.querySelector('base[target]')?.getAttribute('target') || '').toLowerCase()
          if (target && target !== '_self') return { openUrl: url.href }
        }
        element.click()
        break
      }
      case 'text':
        if (typeof request.text !== 'string' || request.text.length > 10000) throw new Error('Text exceeds limit or is not a string')
        if (element.readOnly) throw new Error('Element is read-only')
        if (element instanceof HTMLInputElement && textTypes.has(element.type)) inputSetter.call(element, request.text)
        else if (element instanceof HTMLTextAreaElement) textareaSetter.call(element, request.text)
        else if (!(element instanceof HTMLInputElement) && element.isContentEditable) element.textContent = request.text
        else throw new Error('Element is not a text editor')
        events(element)
        break
      case 'choose': {
        if (!(element instanceof HTMLSelectElement) || typeof request.value !== 'string') throw new Error('Choose requires a select value')
        const option = Array.from(element.options).find(item => item.value === request.value)
        if (!option || option.disabled || option.parentElement?.disabled) throw new Error('Option unavailable')
        selectSetter.call(element, request.value)
        events(element)
        break
      }
      case 'scroll':
        if (typeof request.deltaY !== 'number' || !Number.isFinite(request.deltaY) || Math.abs(request.deltaY) > 10000) throw new Error('Scroll delta exceeds limit')
        ;(element || window).scrollBy({ top: request.deltaY, left: 0, behavior: 'instant' })
        break
    }
    return { ok: true }
  }
  return { execute }
}
