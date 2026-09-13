/** Only the configured top-level DSH page can ask for an iframe command. */
if (window === window.top) {
  chrome.storage.onChanged.addListener(() => window.postMessage({ source: 'dsh-webview-reset' }, location.origin))
  chrome.runtime.onMessage.addListener((request, sender) => {
    if (sender.id !== chrome.runtime.id || request?.kind !== 'frame-event') return false
    window.postMessage({ source: 'dsh-webview-event', nonce: request.nonce, event: request.event }, location.origin)
    return false
  })
  window.addEventListener('message', async event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'dsh-webview-client' || typeof event.data.id !== 'string' || event.data.id.length > 100) return
    const id = event.data.id
    const kind = event.data.request?.kind
    const reply = value => window.postMessage({ source: 'dsh-webview-bridge', id, ...value }, location.origin)
    // Reloading the extension orphans this very script: its chrome.* handles die with the old
    // extension, every later call throws "Extension context invalidated", and the throw is
    // unrecoverable from in here. Detect it before reading storage — note the storage listener
    // above cannot help, because a dead context receives no storage events either — then tell
    // the page it must reconnect instead of letting a bare exception reach the error overlay.
    const lost = () => {
      try { return !chrome.runtime?.id } catch { return true }
    }
    if (lost()) return reply({ error: 'Extension was reloaded; reconnect to the extension.' })
    const forward = () => {
      if (lost()) return reply({ error: 'Extension was reloaded; reconnect to the extension.' })
      return chrome.runtime.sendMessage(event.data.request).then(reply, error => {
        if (lost()) return reply({ error: 'Extension was reloaded; reconnect to the extension.' })
        reply({ error: error.message })
      })
    }
    let trustedOrigins = []
    try {
      ;({ trustedOrigins = [] } = await chrome.storage.sync.get('trustedOrigins'))
    } catch {
      // Reaching here means the context died between the check above and the read.
      return reply({ error: 'Extension was reloaded; reconnect to the extension.' })
    }
    if (trustedOrigins.includes(location.origin)) return forward()
    // An origin that is not authorized yet gets exactly two answers, and neither one
    // reads a page, a tab or archived data. The handshake lets the DSH settings page
    // report why the bridge is unavailable; open-options is the last step of first-time
    // setup, so gating it on the authorization it exists to grant would deadlock.
    // Every page-read and page-action request stays denied here, silently.
    if (kind === 'status') return reply({ value: { protocol: 1, configured: false, version: chrome.runtime.getManifest().version, id: chrome.runtime.id, actions: [] } })
    if (kind === 'open-options') return forward()
  })
}
