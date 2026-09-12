/** Validate exact trusted origins; deployment addresses are user-owned settings. */
function parseOrigins(text) {
  const values = text.split(/\r?\n/).map(value => value.trim()).filter(Boolean)
  if (values.length > 20) throw new Error('最多填写 20 个来源；留空撤销全部授权')
  return [...new Set(values.map(value => {
    const url = new URL(value)
    if (![url.origin, `${url.origin}/`].includes(value) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('仅允许 HTTP(S) 来源，不含账号、路径、查询或锚点')
    return url.origin
  }))]
}
const originsInput = document.getElementById('origins')
const status = document.getElementById('status')
chrome.storage.sync.get('trustedOrigins').then(value => { originsInput.value = (value.trustedOrigins || []).join('\n') }, error => { status.textContent = error.message })
document.getElementById('settings').addEventListener('submit', async event => {
  event.preventDefault()
  try {
    const trustedOrigins = parseOrigins(originsInput.value)
    await chrome.storage.sync.set({ trustedOrigins })
    status.textContent = '已保存。请刷新 DSH；旧页面操作连接已撤销。'
  } catch (error) { status.textContent = error.message }
})
