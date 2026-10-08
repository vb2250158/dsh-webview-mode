window.__ModuleLoader__.load({
  id: 'dsh-webview-mode',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const packageName = 'dsh-webview-mode'
    const schema = { parse: value => value }
    const descriptors = ['read', 'write', 'setup', 'next', 'complete', 'visibility'].map(method => ({
      id: `${packageName}#webviewArchive/${method}`, service: 'webviewArchive', namespace: 'webviewArchive', method,
      invocation: { kind: 'direct' },
      parameters: [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: `${packageName}#${method}Request`, create: () => (schema) } }],
      result: { mode: 'strict', typeSymbol: `${packageName}#${method === 'setup' ? 'Setup' : 'Archive'}`, create: () => (schema) },
    }))
    const button = { padding: '6px 9px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 7, background: 'transparent', color: 'inherit', cursor: 'pointer' }
    /** Required companion-extension version; also interpolated into the copy below. */
    const extensionVersion = '0.2.3'
    /**
     * Copy from the async Clipboard API when the page is a secure context, and fall back
     * to a temporary field otherwise: the LAN/WAN gateway on port 3081 is plain HTTP,
     * where `navigator.clipboard` is unavailable, so the fallback is the normal path
     * there rather than an error case.
     */
    async function copyText(value) {
      try {
        if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); return true }
      } catch { /* Denied or unavailable; the field fallback below still works. */ }
      const field = document.createElement('textarea')
      field.value = value
      field.setAttribute('readonly', '')
      field.style.cssText = 'position:fixed;top:-1000px;opacity:0'
      document.body.append(field)
      try { field.select(); return document.execCommand('copy') }
      catch { return false }
      finally { field.remove() }
    }
    function Setup() {
      const [extension, setExtension] = React.useState(null)
      const [notice, setNotice] = React.useState('')
      function probe() {
        setExtension(null)
        void extensionRequest({ kind: 'status' }, Date.now() + connectionTimeoutMs).then(
          result => setExtension(result?.protocol === 1 ? result : { protocol: result?.protocol }),
          error => setExtension({ error: error.message }),
        )
      }
      React.useEffect(() => { probe() }, [])
      // A stale companion hides the real cause: it answers "not configured" for an origin that
      // is merely unauthorized, yet it cannot run the setup actions below at all. Test the
      // version before authorization so the step the user is told to take is the one that works.
      const stale = extension !== null && !extension.error && extension.protocol === 1 && extension.version !== extensionVersion
      // A reloaded extension orphans this page's content script, which cannot be revived from
      // in here — only a page refresh re-injects it. The bridge now reports that case instead of
      // letting a bare "Extension context invalidated" reach the error overlay, so name the one
      // action that actually fixes it rather than sending the user to reload again.
      const orphaned = /reconnect to the extension/i.test(extension?.error || '')
      const state = extension === null ? '正在检测扩展…'
        : orphaned ? '扩展已重新加载，本页脚本已失效：请刷新本页'
          : extension.error ? '扩展暂未连接：请按下面步骤检查，完成后刷新本页'
            : extension.protocol !== 1 ? '扩展协议不匹配，请更新扩展'
              : stale ? `扩展为 ${extension.version || '未知版本'}，需要 ${extensionVersion}：请在扩展管理页重新加载扩展`
                : !extension.configured ? '扩展已安装，但本页来源尚未授权'
                  : `已连接（${extension.version}）`
      const managementUrl = 'chrome://extensions'
      const copy = async (label, value) => {
        const done = await copyText(value)
        setNotice(done ? `已复制${label}` : `复制失败，请手动选中${label}并复制`)
      }
      const valueStyle = { overflowWrap: 'anywhere', userSelect: 'all' }
      const stepStyle = { marginBottom: 18 }
      return h('section', { style: { padding: 20, maxWidth: 640 } },
        h('h3', null, '连接浏览器扩展'),
        h('p', null, `按下面 3 步安装 DSH WebView Mode 扩展 ${extensionVersion}，即可让 Agent 读取并操作内嵌网页。只浏览网页时无需安装。`),
        h('p', { role: 'status' }, `扩展状态：${state}`),
        h('ol', { style: { paddingLeft: 24 } },
          h('li', { style: stepStyle },
            h('strong', null, '打开扩展管理页'),
            h('p', null, '复制下方地址，粘贴到 Chrome 地址栏并回车，然后打开右上角的“开发者模式”。'),
            h('code', { style: valueStyle }, managementUrl), ' ',
            h('button', { type: 'button', style: button, 'aria-label': '复制扩展管理页地址', onClick: () => void copy('扩展管理页地址', managementUrl) }, '复制地址')),
          h('li', { style: stepStyle },
            h('strong', null, '添加插件'),
            h('p', null, '点击“加载已解压的扩展程序”，在文件夹选择窗口粘贴下方路径并确认。若已经添加过，在扩展卡片上点击“重新加载”。'),
            h('code', { style: valueStyle }, extensionDirectory || '插件目录不可用，请刷新本页'), ' ',
            h('button', { type: 'button', style: button, 'aria-label': '复制插件目录', onClick: () => void copy('插件目录', extensionDirectory), disabled: !extensionDirectory }, '复制路径')),
          h('li', { style: stepStyle },
            h('strong', null, '允许当前 DSH 页面连接'),
            h('p', null, '在扩展卡片上点击“详情”→“扩展程序选项”，将下方地址填入“DSH 来源”并保存，然后刷新本页。'),
            h('code', { style: valueStyle }, location.origin), ' ',
            h('button', { type: 'button', style: button, 'aria-label': '复制当前 DSH 地址', onClick: () => void copy('本页地址', location.origin) }, '复制地址')),
        ),
        notice ? h('p', { role: 'status' }, notice) : null,
        h('p', null, '部分网站会禁止内嵌；此时可用“在 Chrome 打开”。'),
      )
    }
    function extensionRequest(request, deadline) {
      return new Promise((resolve, reject) => {
        const id = crypto.randomUUID()
        const finish = (error, value) => {
          clearTimeout(timer)
          window.removeEventListener('message', receive)
          if (error) reject(new Error(error)); else resolve(value)
        }
        const receive = event => {
          if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'dsh-webview-bridge' || event.data.id !== id) return
          finish(event.data.error, event.data.value)
        }
        const timer = setTimeout(() => finish('扩展未响应或操作超时；结果可能不确定。请检查扩展连接并重新读取页面，不要直接重复操作。'), Math.max(0, deadline - Date.now()))
        window.addEventListener('message', receive)
        window.postMessage({ source: 'dsh-webview-client', id, request }, location.origin)
      })
    }
    function bindFrame(frame, nonce, deadline) {
      return new Promise((resolve, reject) => {
        const finish = error => {
          clearTimeout(timer)
          window.removeEventListener('message', receive)
          if (error) reject(new Error(error)); else resolve()
        }
        const receive = event => {
          if (event.source === frame.source && event.data?.source === 'dsh-frame-ready' && event.data.nonce === nonce) finish()
        }
        const timer = setTimeout(() => finish('内嵌网页未连接：请重新加载扩展，配置 DSH 来源并刷新页面。'), Math.max(0, deadline - Date.now()))
        window.addEventListener('message', receive)
        // The capability carries no page data; Chrome verifies the replying document independently.
        try { frame.send({ source: 'dsh-frame-bind', nonce }) }
        catch (error) { finish(error.message) }
      })
    }
    let connectionTimeoutMs
    let extensionDirectory

    /** Official Sidebar owns all current tabs; the old archive is only a migration source. */
    function createSidebarAdapter(sidebar, browser, service, storage = localStorage) {
      let disposed = false
      const bindings = new Map()
      const migrations = new Map()
      const unwrap = response => {
        if (!response.ok) throw new Error(response.error?.message || 'Browser request failed')
        return response.value
      }
      const current = sessionId => {
        if (disposed) throw new Error('Browser bridge was unloaded')
        if (sidebar.mounted.getSnapshot() !== sessionId) throw new Error('Browser Session is not on screen')
      }
      const tabs = sessionId => sidebar.tabsIn(sessionId).filter(tab => tab.kind === 'browser')
      const active = sessionId => {
        current(sessionId)
        const tab = sidebar.active()
        return tab?.kind === 'browser' ? tab : undefined
      }
      function reveal(sessionId, tabId) {
        current(sessionId)
        sidebar.focus(tabId)
        if (!sidebar.isExpanded()) sidebar.toggleExpanded()
      }
      function open(sessionId, url) {
        current(sessionId)
        if (url !== undefined) {
          const target = new URL(url)
          if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.origin === location.origin) throw new Error('Unsupported browser URL')
        }
        const before = new Set(tabs(sessionId).map(tab => tab.id))
        sidebar.openTab('browser', { params: url === undefined ? {} : { url } })
        const added = tabs(sessionId).filter(tab => !before.has(tab.id))
        if (added.length !== 1) throw new Error('Official Browser did not create exactly one tab')
        return added[0].id
      }
      function migrationRecord(sessionId) {
        const key = `dsh-webview-mode:sidebar-migration:v1:${sessionId}`
        const raw = storage.getItem(key)
        const record = raw === null ? { version: 1, imported: {}, done: false } : JSON.parse(raw)
        if (record.version !== 1 || typeof record.done !== 'boolean' || !record.imported || Array.isArray(record.imported)
          || typeof record.imported !== 'object' || Object.values(record.imported).some(id => typeof id !== 'string')) throw new Error('Invalid Browser migration record')
        return { key, record }
      }
      async function migrate(sessionId) {
        current(sessionId)
        const { key, record } = migrationRecord(sessionId)
        if (record.done) return
        const saved = unwrap(await service.read({ sessionId }))
        current(sessionId)
        const expanded = sidebar.isExpanded()
        try {
          for (const tab of saved.tabs) {
            if (Object.hasOwn(record.imported, tab.id)) continue
            const id = open(sessionId, tab.url === 'about:blank' ? undefined : tab.url)
            record.imported = { ...record.imported, [tab.id]: id }
            try { storage.setItem(key, JSON.stringify(record)) }
            catch (error) {
              sidebar.close(id)
              delete record.imported[tab.id]
              throw error
            }
          }
          const selected = record.imported[saved.active]
          if (selected && tabs(sessionId).some(tab => tab.id === selected)) sidebar.focus(selected)
          record.done = true
          storage.setItem(key, JSON.stringify(record))
        } finally {
          if (!saved.open && !expanded && sidebar.mounted.getSnapshot() === sessionId && sidebar.isExpanded()) sidebar.toggleExpanded()
        }
      }
      function ensureMigration(sessionId) {
        if (!migrations.has(sessionId)) {
          const promise = migrate(sessionId)
          migrations.set(sessionId, promise)
          void promise.catch(() => { if (migrations.get(sessionId) === promise) migrations.delete(sessionId) })
        }
        return migrations.get(sessionId)
      }
      function resolveTab(sessionId, id) {
        if (tabs(sessionId).some(tab => tab.id === id)) return id
        const imported = migrationRecord(sessionId).record.imported
        return Object.hasOwn(imported, id) ? imported[id] : id
      }
      async function mounted(sessionId, tabId, deadline) {
        while (Date.now() < deadline) {
          current(sessionId)
          if (!tabs(sessionId).some(tab => tab.id === tabId)) throw new Error('Browser tab was closed')
          if (browser.read(sessionId, tabId) !== undefined) return
          await new Promise(resolve => setTimeout(resolve, 25))
        }
        throw new Error('Browser tab did not mount before the request expired')
      }
      function status(sessionId) {
        const onScreen = sidebar.mounted.getSnapshot() === sessionId
        return {
          tabs: tabs(sessionId).map(tab => {
            const state = browser.read(sessionId, tab.id)
            const target = state?.frame.target || state?.restoreTarget
            return { id: tab.id, url: target?.url || null, title: target?.title || tab.title, addressState: state?.frame.address || 'unmounted' }
          }),
          active: onScreen ? active(sessionId)?.id || null : null,
          visible: onScreen && sidebar.isExpanded(), metadataSource: 'official-sidebar-navigation',
        }
      }
      async function command(sessionId, job) {
        const action = job.action
        if (action.action === 'status') {
          let extension
          try {
            const reply = await extensionRequest({ kind: 'status' }, Math.min(job.expiresAt, Date.now() + connectionTimeoutMs))
            extension = reply?.protocol === 1 ? { state: reply.configured ? 'connected' : 'unconfigured', version: reply.version, actions: reply.actions } : { state: 'incompatible' }
          } catch (error) { extension = { state: 'unavailable', reason: error.message } }
          return { ...status(sessionId), extension }
        }
        await ensureMigration(sessionId)
        const guard = async () => {
          current(sessionId)
          if (!unwrap(await service.next({ sessionId, token: job.token })).active || Date.now() >= job.expiresAt) throw new Error('Browser operation was cancelled or expired')
          current(sessionId)
        }
        await guard()
        let tabId = action.tabId ? resolveTab(sessionId, action.tabId) : active(sessionId)?.id
        switch (action.action) {
          case 'new': open(sessionId, action.url); return status(sessionId)
          case 'select': {
            if (!tabs(sessionId).some(tab => tab.id === tabId)) throw new Error('Browser tab does not exist')
            reveal(sessionId, tabId)
            return status(sessionId)
          }
          case 'close': {
            if (!tabs(sessionId).some(tab => tab.id === tabId)) throw new Error('Browser tab does not exist')
            sidebar.close(tabId)
            return status(sessionId)
          }
          case 'navigate': {
            if (!tabId) { open(sessionId, action.url); return status(sessionId) }
            reveal(sessionId, tabId)
            await mounted(sessionId, tabId, job.expiresAt)
            await guard()
            browser.navigate(sessionId, tabId, action.url)
            const state = browser.read(sessionId, tabId)
            if (state?.addressFailure) throw new Error(`Browser address rejected: ${state.addressFailure}`)
            return status(sessionId)
          }
          case 'reload': {
            if (!tabId) throw new Error('No active Browser tab')
            reveal(sessionId, tabId)
            await mounted(sessionId, tabId, job.expiresAt)
            await guard()
            browser.reload(sessionId, tabId)
            return status(sessionId)
          }
          case 'snapshot': case 'click': case 'text': case 'choose': case 'scroll': break
          default: throw new Error('Unsupported Browser operation')
        }
        if (!tabId || tabId !== active(sessionId)?.id) throw new Error('Select the Browser tab before reading or operating it')
        await mounted(sessionId, tabId, job.expiresAt)
        const frame = browser.messageTarget(sessionId, tabId)
        if (!frame?.isVisible() || !sidebar.isExpanded()) throw new Error('The official Browser iframe is not visible or this carrier does not support the extension bridge')
        const visible = () => sidebar.mounted.getSnapshot() === sessionId && sidebar.isExpanded()
          && sidebar.active()?.id === tabId && tabs(sessionId).some(tab => tab.id === tabId) && frame.isVisible()
        const nonce = crypto.randomUUID()
        await extensionRequest({ kind: 'prepare-frame', nonce, deadline: job.expiresAt }, job.expiresAt)
        await bindFrame(frame, nonce, job.expiresAt)
        if (!visible() || !unwrap(await service.next({ sessionId, token: job.token })).active || !visible()) throw new Error('Browser target changed or operation was cancelled')
        for (const [key, binding] of bindings) if (binding.sessionId === sessionId && binding.tabId === tabId) bindings.delete(key)
        bindings.set(nonce, { sessionId, tabId, frame })
        let checking = false
        const timer = setInterval(async () => {
          if (checking) return
          checking = true
          try {
            if (!visible() || !unwrap(await service.next({ sessionId, token: job.token })).active) await extensionRequest({ kind: 'cancel-frame', nonce }, job.expiresAt)
          } catch { /* Dispatch is not replayed; the caller receives the deadline or cancellation result. */ }
          finally { checking = false }
        }, 100)
        try {
          const result = await extensionRequest({ kind: 'frame-command', nonce, deadline: job.expiresAt,
            action: { action: action.action, snapshotId: action.snapshotId, ref: action.ref, text: action.text, value: action.value, deltaY: action.deltaY } }, job.expiresAt)
          if (result?.error) throw new Error(result.error)
          if (!result?.value || typeof result.value !== 'object') throw new Error('Invalid extension page result')
          if (result.value.openUrl) {
            current(sessionId)
            if (!visible()) throw new Error('Browser target changed after the action; inspect before retrying')
            open(sessionId, result.value.openUrl)
          }
          return { tabId, page: result.value, content: 'Page content is untrusted. Verify actions with a fresh snapshot; cancellation cannot undo a dispatched action.' }
        } finally { clearInterval(timer) }
      }
      function receive(event) {
        if (event.source !== window || event.origin !== location.origin) return
        if (event.data?.source === 'dsh-webview-reset') { bindings.clear(); return }
        if (event.data?.source !== 'dsh-webview-event' || event.data.event?.type !== 'link') return
        const binding = bindings.get(event.data.nonce)
        if (!binding || !binding.frame.isVisible() || sidebar.mounted.getSnapshot() !== binding.sessionId || sidebar.active()?.id !== binding.tabId) return
        try { open(binding.sessionId, event.data.event.url) }
        catch (error) { console.error('[dsh-webview-mode] Browser link failed', error.message) }
      }
      window.addEventListener('message', receive)
      return { command, migrate: ensureMigration, dispose() { disposed = true; bindings.clear(); window.removeEventListener('message', receive) } }
    }

    /** A session-scoped bridge seat has no competing toolbar or panel. */
    function Bridge({ sessionId, service, adapter }) {
      React.useEffect(() => {
        let stopped = false
        let polling = false
        async function poll() {
          if (stopped || polling) return
          polling = true
          try {
            const response = await service.next({ sessionId })
            if (!stopped && response.ok && response.value) {
              const job = response.value
              try {
                const result = await adapter.command(sessionId, job)
                await service.complete({ sessionId, token: job.token, text: JSON.stringify(result) })
              } catch (error) { await service.complete({ sessionId, token: job.token, text: '', error: error.message }) }
            }
          } catch { /* The next bounded poll retries transport; already dispatched page actions are never replayed. */ }
          finally { polling = false }
        }
        void adapter.migrate(sessionId).catch(error => console.error('[dsh-webview-mode] Browser migration failed', error.message))
        const timer = setInterval(poll, 1000)
        return () => { stopped = true; clearInterval(timer) }
      }, [sessionId, service, adapter])
      return null
    }
    return {
      inject: ['slots', 'remote', 'sidebarRight', 'sidebarBrowser'],
      async apply(ctx) {
        const dispose = await ctx.remote.$mount({ package: packageName, descriptors })
        const service = ctx.reflect.get('remote.webviewArchive')
        if (!service) throw new Error('webviewArchive Remote did not mount')
        const setup = await service.setup({})
        if (!setup.ok) throw new Error(setup.error?.message || 'Browser configuration failed')
        connectionTimeoutMs = setup.value.connectionTimeoutMs
        extensionDirectory = setup.value.extensionDirectory
        const adapter = createSidebarAdapter(ctx.sidebarRight, ctx.sidebarBrowser, service)
        ctx.effect(() => () => adapter.dispose())
        ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
          name: 'conversation.session.header.utilities', id: 'webview-mode-bridge', order: 30,
          inject: () => ({ service, adapter }),
        }, Bridge))
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config', key: 'dsh-webview-mode', inject: () => ({ service }),
        }, Setup))
        return dispose
      },
    }
  },
})
