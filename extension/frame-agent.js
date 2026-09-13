/** Isolated-world DOM executor: page scripts never receive the runtime result channel. */
if (window !== window.top && window.parent === window.top) {
  let controller = createFrameDomController()
  let nonce = null
  let epoch = 0
  chrome.storage.onChanged.addListener(() => { nonce = null; setFrameEventBinding(null); epoch++; controller = createFrameDomController() })
  // Reloading the extension orphans this script along with the top-level bridge: its chrome.*
  // handles die with the old extension and every later call throws "Extension context
  // invalidated", which nothing in here can recover from. Say so explicitly instead of
  // letting the raw throw bubble into the page's error surface.
  const lost = () => {
    try { return !chrome.runtime?.id } catch { return true }
  }
  window.addEventListener('message', async event => {
    if (event.source !== window.parent || event.origin !== location.ancestorOrigins?.[0] || event.data?.source !== 'dsh-frame-bind') return
    if (lost()) return
    const generation = epoch
    let trustedOrigins = []
    try {
      ;({ trustedOrigins = [] } = await chrome.storage.sync.get('trustedOrigins'))
    } catch { return }
    if (!trustedOrigins.includes(event.origin)) return
    const candidate = event.data.nonce
    try {
      const result = await chrome.runtime.sendMessage({ kind: 'bind-frame', nonce: candidate })
      if (generation === epoch && result?.value?.connected) {
        nonce = candidate
        setFrameEventBinding(candidate)
        window.parent.postMessage({ source: 'dsh-frame-ready', nonce }, event.origin)
      }
    } catch { /* Extension reload invalidates this document; the pending DSH request expires explicitly. */ }
  })
  chrome.runtime.onMessage.addListener((request, sender, reply) => {
    if (sender.id !== chrome.runtime.id || request?.kind !== 'frame-command') return false
    try {
      if (!nonce || request.nonce !== nonce) throw new Error('Iframe binding changed; request a snapshot')
      if (!Number.isFinite(request.deadline) || Date.now() >= request.deadline) throw new Error('Browser operation expired before execution')
      if (document.visibilityState !== 'visible') throw new Error('Iframe is not visible')
      // DOM commands are synchronous: no command can wait past its deadline in an executor queue.
      reply({ value: controller.execute(request.action) })
    } catch (error) { reply({ error: error.message }) }
    return false
  })
}
