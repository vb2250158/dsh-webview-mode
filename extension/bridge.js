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
    const forward = () => chrome.runtime.sendMessage(event.data.request).then(reply, error => reply({ error: error.message }))
    const { trustedOrigins = [] } = await chrome.storage.sync.get('trustedOrigins')
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
