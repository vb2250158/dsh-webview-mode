/** Route commands only to registered direct iframe documents in a configured DSH tab. */
const bindings = new Map()
const challenges = new Map()
let epoch = 0
chrome.storage.onChanged.addListener(() => { epoch++; bindings.clear(); challenges.clear() })
chrome.tabs.onRemoved.addListener(tabId => {
  for (const [key, binding] of bindings) if (binding.tabId === tabId) bindings.delete(key)
})
async function execute(request, sender) {
  if (!sender.tab || !sender.documentId) throw new Error('Missing browser document identity')
  const generation = epoch
  const { trustedOrigins = [] } = await chrome.storage.sync.get('trustedOrigins')
  const top = await chrome.webNavigation.getFrame({ tabId: sender.tab.id, frameId: 0 })
  if (generation !== epoch) throw new Error('Extension settings changed')
  // Deliberately reachable before an origin is authorized: the options page is where
  // authorization is granted, so gating this on it would deadlock first-time setup.
  // The action reads no page, no tab and no archived data, so it grants nothing; it
  // is still restricted to the current top-level DSH document.
  if (request?.kind === 'open-options') {
    if (!top || sender.frameId !== 0 || sender.documentId !== top.documentId) throw new Error('Only the current DSH document may open extension options')
    await chrome.runtime.openOptionsPage()
    return { opened: true }
  }
  if (!top || !trustedOrigins.includes(new URL(top.url).origin)) throw new Error('DSH origin is not configured in extension options')
  if (request?.kind === 'status') {
    if (sender.frameId !== 0 || sender.documentId !== top.documentId || !trustedOrigins.includes(new URL(sender.url).origin)) throw new Error('Only the current DSH document may query capabilities')
    return { protocol: 1, configured: true, version: chrome.runtime.getManifest().version, id: chrome.runtime.id, actions: ['snapshot', 'click', 'text', 'choose', 'scroll'] }
  }
  if (typeof request?.nonce !== 'string' || !/^[a-f0-9-]{36}$/.test(request.nonce)) throw new Error('Invalid frame binding')
  const key = `${sender.tab.id}:${request.nonce}`
  if (request.kind === 'prepare-frame') {
    if (sender.frameId !== 0 || sender.documentId !== top.documentId) throw new Error('Only DSH may prepare a binding')
    for (const [id, challenge] of challenges) if (challenge.deadline < Date.now()) challenges.delete(id)
    if (!Number.isFinite(request.deadline) || request.deadline <= Date.now() || request.deadline > Date.now() + 120000) throw new Error('Invalid binding deadline')
    challenges.set(key, { documentId: sender.documentId, deadline: request.deadline })
    return { prepared: true }
  }
  if (request.kind === 'bind-frame') {
    const challenge = challenges.get(key)
    if (!challenge || challenge.documentId !== top.documentId || !Number.isFinite(challenge.deadline) || challenge.deadline <= Date.now()) throw new Error('Missing or expired DSH binding challenge')
    challenges.delete(key)
    const frame = await chrome.webNavigation.getFrame({ tabId: sender.tab.id, frameId: sender.frameId })
    if (generation !== epoch) throw new Error('Extension settings changed')
    if (!frame || frame.parentFrameId !== 0 || frame.documentId !== sender.documentId) throw new Error('Only direct current iframe documents may bind')
    // A new bind for the same frame replaces its previous document and capability.
    for (const [id, binding] of bindings) if (binding.tabId === sender.tab.id && binding.frameId === sender.frameId) bindings.delete(id)
    bindings.set(key, { tabId: sender.tab.id, frameId: sender.frameId, documentId: sender.documentId, topDocumentId: top.documentId })
    return { connected: true }
  }
  if (request.kind === 'frame-event') {
    const binding = bindings.get(key)
    if (!binding || binding.frameId !== sender.frameId || binding.documentId !== sender.documentId || binding.topDocumentId !== top.documentId) throw new Error('Unbound iframe event')
    const current = await chrome.webNavigation.getFrame({ tabId: sender.tab.id, frameId: sender.frameId })
    if (generation !== epoch || bindings.get(key) !== binding || current?.documentId !== sender.documentId || current.parentFrameId !== 0) throw new Error('Iframe event document changed')
    const event = request.event
    if (!event || !['location', 'link'].includes(event.type)) throw new Error('Unsupported iframe event')
    const url = new URL(event.type === 'location' ? current.url : event.url)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.origin === new URL(top.url).origin) throw new Error('Unsupported iframe event URL')
    return chrome.tabs.sendMessage(sender.tab.id, { kind: 'frame-event', nonce: request.nonce, event: { type: event.type, url: url.href, ...(event.type === 'location' ? { title: String(event.title || '').slice(0, 4096) } : {}) } }, { documentId: top.documentId })
  }
  if (sender.frameId !== 0 || sender.documentId !== top.documentId || !trustedOrigins.includes(new URL(sender.url).origin)) throw new Error('Only the current DSH document may issue commands')
  const binding = bindings.get(key)
  if (request.kind === 'binding-status') return { connected: !!binding && binding.topDocumentId === sender.documentId }
  if (!binding || binding.topDocumentId !== sender.documentId) throw new Error('Iframe is not connected; reload the extension and DSH, then retry a snapshot')
  if (request.kind === 'cancel-frame') { binding.cancelled = true; return { cancelled: true } }
  if (request.kind !== 'frame-command') throw new Error('Unsupported browser request')
  if (!Number.isFinite(request.deadline) || request.deadline <= Date.now()) throw new Error('Browser operation expired before dispatch')
  const current = await chrome.webNavigation.getFrame({ tabId: binding.tabId, frameId: binding.frameId })
  if (!current || current.documentId !== binding.documentId || current.parentFrameId !== 0) {
    bindings.delete(key)
    throw new Error('Iframe navigated; request a new snapshot')
  }
  if (binding.cancelled || bindings.get(key) !== binding || request.deadline <= Date.now()) throw new Error('Browser operation cancelled or expired before dispatch')
  if (binding.dispatched) throw new Error('Browser operation already dispatched; do not replay')
  binding.dispatched = true
  return chrome.tabs.sendMessage(binding.tabId, request, { documentId: binding.documentId })
}
chrome.runtime.onMessage.addListener((request, sender, reply) => {
  void execute(request, sender).then(value => reply({ value }), error => reply({ error: error.message }))
  return true
})
