/** Only the configured top-level DSH page can ask for an iframe command. */
if (window === window.top) {
  window.addEventListener('message', async event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'dsh-webview-client' || typeof event.data.id !== 'string' || event.data.id.length > 100) return
    const { trustedOrigins = [] } = await chrome.storage.sync.get('trustedOrigins')
    if (!trustedOrigins.includes(location.origin)) return
    const id = event.data.id
    chrome.runtime.sendMessage(event.data.request).then(
      value => window.postMessage({ source: 'dsh-webview-bridge', id, ...value }, location.origin),
      error => window.postMessage({ source: 'dsh-webview-bridge', id, error: error.message }, location.origin),
    )
  })
}
