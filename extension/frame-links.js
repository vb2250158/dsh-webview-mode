/** Isolated-world events use only a worker-verified browser document binding. */
let setFrameEventBinding = () => {}
if (window !== window.top && window.parent === window.top) {
  let nonce = null
  let previousLocation = ''
  let interval = null
  let locationPending = false
  let generation = 0

  function stopPolling() {
    if (interval !== null) clearInterval(interval)
    interval = null
  }

  function httpUrl(value) {
    let url
    try { url = new URL(value) } catch { return null }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    return url.href
  }

  async function send(event) {
    if (!nonce) return false
    const currentGeneration = generation
    try {
      const response = await chrome.runtime.sendMessage({ kind: 'frame-event', nonce, event })
      if (response?.error) throw new Error(response.error)
      return currentGeneration === generation
    } catch {
      // Revoked bindings and extension reloads must not leave link interception active.
      if (currentGeneration === generation) {
        window.parent.postMessage({ source: 'dsh-frame-disconnected', nonce }, '*')
        setFrameEventBinding(null)
      }
      return false
    }
  }

  async function reportLocation() {
    if (!nonce || locationPending || document.visibilityState !== 'visible') return
    const url = httpUrl(location.href)
    if (!url) return
    const title = document.title.slice(0, 1000)
    const value = JSON.stringify([url, title])
    if (value === previousLocation) return
    const currentGeneration = generation
    locationPending = true
    const delivered = await send({ type: 'location', url, title })
    if (currentGeneration !== generation) return
    locationPending = false
    if (delivered) previousLocation = value
  }

  // frame-agent calls this only after runtime bind-frame confirms the document identity.
  setFrameEventBinding = candidate => {
    generation++
    nonce = typeof candidate === 'string' && /^[a-f0-9-]{36}$/.test(candidate) ? candidate : null
    previousLocation = ''
    locationPending = false
    stopPolling()
    if (!nonce) return
    interval = setInterval(reportLocation, 1000)
    void reportLocation()
  }

  function route(event) {
    if (!nonce || document.visibilityState !== 'visible' || !event.isTrusted || event.defaultPrevented) return
    if (event.button !== 0 && event.button !== 1) return
    const link = event.composedPath().find(node => node instanceof HTMLAnchorElement)
    if (!link || link.hasAttribute('download')) return
    const target = link.target || document.querySelector('base[target]')?.target || ''
    const newTab = (target && !['_self', '_parent', '_top'].includes(target.toLowerCase())) || event.ctrlKey || event.metaKey || event.button === 1
    if (!newTab) return
    const url = httpUrl(link.href)
    if (!url) return
    event.preventDefault()
    event.stopImmediatePropagation()
    void send({ type: 'link', url })
  }

  window.addEventListener('click', route, true)
  window.addEventListener('auxclick', route, true)
  window.addEventListener('hashchange', reportLocation)
  window.addEventListener('popstate', reportLocation)
  window.addEventListener('pageshow', () => {
    if (nonce && interval === null) interval = setInterval(reportLocation, 1000)
    void reportLocation()
  })
  window.addEventListener('pagehide', () => setFrameEventBinding(null))
  document.addEventListener('visibilitychange', reportLocation)
  chrome.storage.onChanged.addListener(() => setFrameEventBinding(null))
}
