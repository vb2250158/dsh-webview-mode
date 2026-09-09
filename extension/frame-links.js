/** Route user-activated new-tab links only from direct DSH child frames. */
const dshOrigins = ['http://127.0.0.1:3180', 'http://localhost:3180']
if (window !== window.top && window.parent === window.top && dshOrigins.includes(location.ancestorOrigins?.[0])) {
  const parentOrigin = location.ancestorOrigins[0]
  function route(event) {
    if (!event.isTrusted || event.defaultPrevented) return
    const link = event.composedPath().find(node => node instanceof HTMLAnchorElement)
    if (!link || link.hasAttribute('download')) return
    const target = link.target || document.querySelector('base[target]')?.target || ''
    const newTab = (target && !['_self', '_parent', '_top'].includes(target.toLowerCase())) || event.ctrlKey || event.metaKey || event.button === 1
    if (!newTab || (event.button !== 0 && event.button !== 1)) return
    let url
    try { url = new URL(link.href) } catch { return }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return
    event.preventDefault()
    event.stopImmediatePropagation()
    window.parent.postMessage({ source: 'dsh-iframe-link', url: url.href }, parentOrigin)
  }
  window.addEventListener('click', route, true)
  window.addEventListener('auxclick', route, true)
}

// Report durable navigation metadata; never copy page forms or credentials.
if (window !== window.top && window.parent === window.top && dshOrigins.includes(location.ancestorOrigins?.[0])) {
  let previous = ''
  function reportLocation() {
    const value = JSON.stringify([location.href, document.title])
    if (value === previous) return
    previous = value
    window.parent.postMessage({ source: 'dsh-iframe-location', url: location.href, title: document.title }, location.ancestorOrigins[0])
  }
  window.addEventListener('pageshow', reportLocation)
  window.addEventListener('hashchange', reportLocation)
  window.addEventListener('popstate', reportLocation)
  setInterval(reportLocation, 1000)
  reportLocation()
}
