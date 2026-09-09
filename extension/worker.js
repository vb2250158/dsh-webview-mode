/** Only extension-created tabs are debugger targets; cookies stay in this Chrome profile. */
const origins = new Set(['http://127.0.0.1:3180', 'http://localhost:3180'])
let pending = Promise.resolve()
const attached = new Set()
const width = 1100
const height = 850
function url(value) {
  if (value === 'about:blank') return value
  const parsed = new URL(value.includes('://') ? value : `https://${value}`)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('请输入 HTTP 或 HTTPS 网页地址')
  return parsed.href
}
async function ownedTabs(sessionId, archive) {
  const storage = await chrome.storage.session.get('conversations')
  const conversations = storage.conversations || {}
  let state = conversations[sessionId]
  if (!state) {
    state = { tabs: [], active: archive.active }
    for (const item of archive.tabs) {
      const tab = await chrome.tabs.create({ url: url(item.url), active: false })
      state.tabs.push({ id: item.id, browserId: tab.id })
    }
    conversations[sessionId] = state
    await chrome.storage.session.set({ conversations })
  }
  const live = []
  for (const tab of state.tabs) {
    try { await chrome.tabs.get(tab.browserId); live.push(tab) }
    catch { /* The user may close an extension-owned browser tab outside the panel. */ }
  }
  state.tabs = live
  return { state, conversations }
}
async function send(tabId, method, params = {}) {
  if (!attached.has(tabId)) {
    await chrome.debugger.attach({ tabId }, '1.3')
    attached.add(tabId)
    await chrome.debugger.sendCommand({ tabId }, 'Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  }
  return chrome.debugger.sendCommand({ tabId }, method, params)
}
chrome.debugger.onDetach.addListener(source => attached.delete(source.tabId))

async function execute(request) {
  if (request?.action === 'ping') return { connected: true, version: chrome.runtime.getManifest().version }
  if (!request || typeof request.sessionId !== 'string' || request.sessionId.length > 256 || !request.sessionId || request.archive?.sessionId !== request.sessionId || !Array.isArray(request.archive.tabs) || request.archive.tabs.length > 100) throw new Error('Invalid conversation request')
  const { state, conversations } = await ownedTabs(request.sessionId, request.archive)
  let current = state.tabs.find(tab => tab.id === state.active) || state.tabs[0]
  async function create() {
    if (state.tabs.length >= 100) throw new Error('当前对话最多打开 100 个标签页')
    const browser = await chrome.tabs.create({ url: 'about:blank', active: false })
    const tab = { id: crypto.randomUUID(), browserId: browser.id }
    state.tabs.push(tab)
    return tab
  }
  if (!current) current = await create()
  switch (request.action) {
    case 'frame': case 'snapshot': break
    case 'navigate': await chrome.tabs.update(current.browserId, { url: url(request.url) }); break
    case 'new': current = await create(); break
    case 'select': {
      const selected = state.tabs.find(tab => tab.id === request.tabId)
      if (!selected) throw new Error('标签页已经关闭')
      current = selected
      break
    }
    case 'close': {
      const selected = state.tabs.find(tab => tab.id === request.tabId)
      if (!selected) throw new Error('标签页已经关闭')
      await chrome.tabs.remove(selected.browserId)
      state.tabs = state.tabs.filter(tab => tab !== selected)
      if (selected === current) current = state.tabs[0] || await create()
      break
    }
    case 'reload': await chrome.tabs.reload(current.browserId); break
    case 'back': await chrome.tabs.goBack(current.browserId); break
    case 'forward': await chrome.tabs.goForward(current.browserId); break
    case 'click': {
      if (Number.isInteger(request.ref)) {
        const { model } = await send(current.browserId, 'DOM.getBoxModel', { backendNodeId: request.ref })
        request.x = (model.content[0] + model.content[4]) / 2
        request.y = (model.content[1] + model.content[5]) / 2
      }
      if (!Number.isFinite(request.x) || !Number.isFinite(request.y)) throw new Error('Invalid pointer')
      const point = { x: Math.max(0, Math.min(width, request.x)), y: Math.max(0, Math.min(height, request.y)), button: 'left', clickCount: 1 }
      await send(current.browserId, 'Input.dispatchMouseEvent', { ...point, type: 'mousePressed' })
      await send(current.browserId, 'Input.dispatchMouseEvent', { ...point, type: 'mouseReleased' })
      break
    }
    case 'scroll': {
      request.x ??= width / 2; request.y ??= height / 2; request.deltaX ??= 0
      if (![request.x, request.y, request.deltaX, request.deltaY].every(Number.isFinite)) throw new Error('Invalid scroll')
      await send(current.browserId, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x: request.x, y: request.y, deltaX: request.deltaX, deltaY: request.deltaY })
      break
    }
    case 'key': {
      const codes = { Enter: 13, Backspace: 8, Tab: 9, Escape: 27, Delete: 46, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 }
      if (typeof request.key !== 'string') throw new Error('Invalid key')
      if (request.key.length === 1) await send(current.browserId, 'Input.insertText', { text: request.key })
      else {
        if (!codes[request.key]) throw new Error('Unsupported key')
        await send(current.browserId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: request.key, windowsVirtualKeyCode: codes[request.key] })
        await send(current.browserId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: request.key, windowsVirtualKeyCode: codes[request.key] })
      }
      break
    }
    case 'text': {
      if (typeof request.text !== 'string' || request.text.length > 100000) throw new Error('Invalid text')
      await send(current.browserId, 'Input.insertText', { text: request.text })
      break
    }
    default: throw new Error('Unsupported action')
  }
  state.active = current.id
  await chrome.storage.session.set({ conversations })
  const tabs = await Promise.all(state.tabs.map(async item => {
    const tab = await chrome.tabs.get(item.browserId)
    return { id: item.id, url: tab.url || 'about:blank', title: tab.title || '' }
  }))
  const frame = await send(current.browserId, 'Page.captureScreenshot', { format: 'jpeg', quality: 75 })
  let content
  if (request.action !== 'frame') {
    const tree = await send(current.browserId, 'Accessibility.getFullAXTree')
    content = (tree.nodes || []).filter(node => !node.ignored && node.name?.value).slice(0, 250).map(node => `[ref=${node.backendDOMNodeId ?? ''}] ${node.role?.value || ''}: ${String(node.name.value).slice(0, 500)}`).join('\n')
  }
  return { active: current.id, tabs, image: frame.data, width, height, content }
}
chrome.runtime.onMessage.addListener((request, sender, reply) => {
  if (!sender.tab || sender.frameId !== 0 || !origins.has(new URL(sender.url).origin)) return false
  const operation = pending.then(() => execute(request))
  pending = operation.catch(() => {}) // Failure is delivered through the message reply.
  operation.then(value => reply({ value }), error => reply({ error: error.message }))
  return true
})
