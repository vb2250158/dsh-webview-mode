/** Main-world window.open routing, restricted to direct DSH child frames. */
(() => {
  const parentOrigin = location.ancestorOrigins?.[0]
  if (window === window.top || window.parent !== window.top || !['http://127.0.0.1:3180', 'http://localhost:3180'].includes(parentOrigin)) return
  const original = window.open
  let usedGesture = false
  const resetGesture = event => { if (event.isTrusted) usedGesture = false }
  window.addEventListener('pointerdown', resetGesture, true)
  window.addEventListener('keydown', resetGesture, true)
  window.open = function(url, target = '_blank', features) {
    if (String(target).toLowerCase() === '_self') return original.call(window, url, target, features)
    if (!navigator.userActivation?.isActive || usedGesture) return null
    let address
    try { address = new URL(url, document.baseURI) } catch { return null }
    if (!['http:', 'https:'].includes(address.protocol) || address.username || address.password) return null
    usedGesture = true
    window.parent.postMessage({ source: 'dsh-iframe-link', url: address.href }, parentOrigin)
    // A plugin tab has no synchronous WindowProxy; do not fabricate one.
    return null
  }
})()
