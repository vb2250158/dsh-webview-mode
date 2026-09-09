/** The bridge accepts only the configured local DSH page, never embedded documents. */
if (window === window.top && ['http://127.0.0.1:3180', 'http://localhost:3180'].includes(location.origin)) {
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'dsh-webview-client' || typeof event.data.id !== 'string') return
    const id = event.data.id
    chrome.runtime.sendMessage(event.data.request).then(
      value => window.postMessage({ source: 'dsh-webview-bridge', id, ...value }, location.origin),
      error => window.postMessage({ source: 'dsh-webview-bridge', id, error: error.message }, location.origin),
    )
  })
}
