window.__ModuleLoader__.load({
  id: 'dsh-webview-mode',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { createRoot } = require('react-dom/client')
    const packageName = 'dsh-webview-mode'
    const schema = { parse: value => value }
    const descriptors = ['read', 'write', 'setup', 'next', 'complete', 'visibility'].map(method => ({
      id: `${packageName}#webviewArchive/${method}`, service: 'webviewArchive', namespace: 'webviewArchive', method,
      invocation: { kind: 'direct' },
      parameters: [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: `${packageName}#${method}Request`, schema } }],
      result: { mode: 'strict', typeSymbol: `${packageName}#${method === 'setup' ? 'Setup' : 'Archive'}`, schema },
    }))
    const button = { padding: '6px 9px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 7, background: 'transparent', color: 'inherit', cursor: 'pointer' }
    function Setup() {
      return h('section', { style: { padding: 20 } }, h('h3', null, '内嵌网页'),
        h('p', null, '浏览网页无需扩展；接管网页的新标签链接需要配套扩展 0.1.4。'),
        h('p', null, '更新扩展后，请在 chrome://extensions 中重新加载 DSH WebView Mode，再刷新 DSH。部分网站禁止内嵌或限制第三方登录，可使用“在 Chrome 打开”。Agent 当前支持打开网址和管理标签，暂不支持读取、点击跨域网页。'))
    }
    function Panel({ sessionId, service, close }) {
      const [state, setState] = React.useState(null)
      const [address, setAddress] = React.useState('')
      const [error, setError] = React.useState('')
      const [reload, setReload] = React.useState(0)
      const frames = React.useRef(new Map())
      const sources = React.useRef(new Map())
      const archive = React.useRef(null)
      const alive = React.useRef(true)
      const queue = React.useRef(Promise.resolve())
      const unwrap = result => { if (!result.ok) throw new Error(result.error?.message || '存档操作失败'); return result.value }
      const publish = value => {
        archive.current = value
        if (alive.current) { setState(value); setAddress(value.tabs.find(tab => tab.id === value.active)?.url || '') }
      }
      React.useEffect(() => {
        alive.current = true
        queue.current = service.read({ sessionId }).then(result => publish(unwrap(result)))
        queue.current.catch(failure => { if (alive.current) setError(failure.message) })
        return () => { alive.current = false }
      }, [])
      function command(action) {
        const operation = queue.current.then(async () => {
          if (!alive.current) throw new Error('浏览器面板已关闭')
          if (action.__token && !unwrap(await service.next({ sessionId, token: action.__token })).active) throw new Error('操作已取消或超时')
          if (!archive.current) throw new Error('存档尚未加载，请重新打开面板')
          const next = { ...archive.current, tabs: archive.current.tabs.map(tab => ({ ...tab })) }
          const selected = () => next.tabs.find(tab => tab.id === next.active)
          switch (action.action) {
            case 'new': {
              const url = action.url ? new URL(action.url) : null
              if (url && (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.origin === location.origin)) throw new Error('不支持的网页地址')
              const existing = action.reuse && url ? next.tabs.find(tab => tab.url === url.href) : null
              if (existing) { next.active = existing.id; break }
              const tab = { id: crypto.randomUUID(), url: url?.href || 'about:blank', title: url?.hostname || '新标签页' }
              next.tabs.push(tab); next.active = tab.id; break
            }
            case 'navigate': {
              const url = new URL(action.url)
              if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('请输入不含账号密码的 HTTP(S) 网址')
              // Local DSH must not be embedded with script access to its parent.
              if (url.origin === location.origin) throw new Error('不能在面板中嵌入 DSH 自身')
              if (!selected()) { const tab = { id: crypto.randomUUID(), url: '', title: '' }; next.tabs.push(tab); next.active = tab.id }
              sources.current.set(next.active, url.href)
              Object.assign(selected(), { url: url.href, title: url.hostname }); break
            }
            case 'location': {
              const tab = next.tabs.find(tab => tab.id === action.tabId)
              if (!tab) return
              const url = new URL(action.url)
              if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.origin === location.origin) return
              tab.url = url.href
              tab.title = String(action.title || url.hostname).slice(0, 4096)
              break
            }
            case 'select':
              if (!next.tabs.some(tab => tab.id === action.tabId)) throw new Error('标签页不存在')
              next.active = action.tabId; break
            case 'close':
              next.tabs = next.tabs.filter(tab => tab.id !== (action.tabId || next.active))
              if (!next.tabs.some(tab => tab.id === next.active)) next.active = next.tabs[0]?.id || null
              break
            case 'reload': setReload(value => value + 1); break
            default: throw new Error('iframe 试用版暂不支持 Agent 读取或操作网页内容，请用户直接在网页中操作。不会改为控制后台标签页。')
          }
          if (JSON.stringify(next) !== JSON.stringify(archive.current)) publish(unwrap(await service.write(next)))
          if (alive.current) setError('')
          return { tabs: archive.current.tabs, active: archive.current.active, content: 'Iframe navigation requested. Page load and content are not verified; websites may deny embedding.' }
        })
        queue.current = operation.catch(failure => { if (alive.current) setError(failure.message) })
        return operation
      }
      React.useEffect(() => {
        const receive = event => {
          if (!['dsh-iframe-link', 'dsh-iframe-location'].includes(event.data?.source) || typeof event.data.url !== 'string') return
          const sender = [...frames.current.entries()].find(([, frame]) => frame?.contentWindow === event.source)
          if (!sender) return
          if (event.data.source === 'dsh-iframe-location') {
            void command({ action: 'location', tabId: sender[0], url: event.data.url, title: event.data.title }).catch(() => {})
            return
          }
          if (sender[0] !== archive.current?.active || !sender[1].getClientRects().length) return
          void command({ action: 'new', url: event.data.url, reuse: true }).catch(() => {})
        }
        window.addEventListener('message', receive)
        return () => window.removeEventListener('message', receive)
      }, [])
      const job = React.useSyncExternalStore(notify => { listeners.add(notify); return () => listeners.delete(notify) }, () => jobs.get(sessionId) ?? null)
      React.useEffect(() => {
        if (!job || !state || job.started) return
        job.started = true
        void command({ ...job.action, __token: job.token }).then(
          result => service.complete({ sessionId, token: job.token, text: JSON.stringify(result) }),
          failure => service.complete({ sessionId, token: job.token, text: '', error: failure.message }),
        ).catch(failure => { if (alive.current) setError(failure.message) }).finally(() => { jobs.delete(sessionId); for (const notify of listeners) notify() })
      }, [job, state])
      const act = (action, extra = {}) => () => { void command({ action, ...extra }).catch(() => {}) }
      const active = state?.tabs.find(tab => tab.id === state.active)
      return h('aside', { 'aria-label': '对话浏览器', style: { width: '100%', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 0, padding: 0, minHeight: 0, background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', border: 0, borderRadius: 0 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, flexShrink: 0, padding: '5px 8px' } },
          h('div', { style: { display: 'flex', gap: 4, overflowX: 'auto', flex: 1, minWidth: 0 } },
          ...(state?.tabs || []).map(tab => h('div', { key: tab.id, style: { display: 'flex', flex: '0 0 auto', maxWidth: 220, minWidth: 0, borderBottom: tab.id === state.active ? '2px solid var(--dsw-alias-brand-primary)' : '2px solid transparent' } },
            h('button', { style: { ...button, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, onClick: act('select', { tabId: tab.id }), title: tab.url }, tab.title),
            h('button', { style: button, onClick: act('close', { tabId: tab.id }), 'aria-label': `关闭 ${tab.title}` }, '×'))),
          h('button', { style: button, disabled: !state, onClick: act('new'), 'aria-label': '新建网页标签' }, '+')),
          h('button', { style: { ...button, flexShrink: 0 }, onClick: close, 'aria-label': '关闭浏览器面板' }, '×')),
        h('form', { onSubmit: event => { event.preventDefault(); void command({ action: 'navigate', url: address }).catch(() => {}) }, style: { display: 'flex', alignItems: 'center', gap: 5, padding: '4px 8px 6px', borderBottom: '1px solid var(--dsw-alias-border-l2)', flexShrink: 0 } },
          h('button', { style: button, type: 'button', onClick: act('reload') }, '刷新'),
          h('input', { 'aria-label': '网页地址', value: address, onChange: event => setAddress(event.target.value), placeholder: 'https://example.com', style: { flex: 1, minWidth: 0, padding: 6, color: 'inherit', background: 'transparent', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6 } }),
          h('button', { style: button, disabled: !state, type: 'submit' }, '打开'),
          active && active.url !== 'about:blank' ? h('a', { href: active.url, target: '_blank', rel: 'noopener noreferrer', style: { ...button, color: 'inherit' } }, '在 Chrome 打开') : null),
        error ? h('div', { role: 'alert' }, error) : null,
        h('div', { style: { flex: 1, minHeight: 0, position: 'relative', background: 'var(--dsw-alias-bg-base)' } },
          ...(state?.tabs || []).filter(tab => tab.url !== 'about:blank').map(tab => h('iframe', {
            ref: frame => { if (frame) frames.current.set(tab.id, frame); else frames.current.delete(tab.id) },
            key: `${tab.id}:${reload}`, title: `网页：${tab.title}`, src: sources.current.get(tab.id) || (sources.current.set(tab.id, tab.url), tab.url),
            allow: 'autoplay',
            sandbox: 'allow-scripts allow-same-origin allow-forms', referrerPolicy: 'strict-origin-when-cross-origin',
            style: { display: tab.id === state.active ? 'block' : 'none', width: '100%', height: '100%', border: 0, background: 'white' },
          })),
          !active || active.url === 'about:blank' ? h('p', null, state ? '输入网址开始浏览' : '正在读取标签页…') : null),
        h('small', null, '网页空白或拒绝连接？该站点可能禁止内嵌，请使用“在 Chrome 打开”。新标签无响应时，请重新加载扩展 0.1.4 并刷新 DSH。'),
      )
    }
    const jobs = new Map()
    const openSessions = new Set()
    const restored = new Set()
    let archiveService
    const listeners = new Set()
    function setOpen(sessionId, open, persist = true) {
      restored.add(sessionId)
      if (persist) void archiveService.visibility({ sessionId, open }).then(result => {
        if (!result.ok) console.error('[dsh-webview-mode] 面板状态保存失败', result.error?.message)
      }, error => console.error('[dsh-webview-mode] 面板状态保存失败', error.message))
      if (open) openSessions.add(sessionId)
      else openSessions.delete(sessionId)
      for (const notify of listeners) notify()
    }
    function useOpen(sessionId) {
      return React.useSyncExternalStore(
        notify => { listeners.add(notify); return () => listeners.delete(notify) },
        () => sessionId !== undefined && openSessions.has(sessionId),
      )
    }
    // Containers stay connected to the document: moving an iframe would reload it.
    const panels = new Map()
    function cachedPanel(sessionId, service) {
      if (panels.has(sessionId)) return panels.get(sessionId)
      const container = document.createElement('div')
      container.dataset.dshBrowserSession = sessionId
      Object.assign(container.style, { position: 'fixed', display: 'none', zIndex: '20', boxSizing: 'border-box', padding: '0' })
      document.body.append(container)
      const root = createRoot(container)
      root.render(h(Panel, { sessionId, service, close: () => setOpen(sessionId, false) }))
      const panel = { container, root }
      panels.set(sessionId, panel)
      return panel
    }
    function installSplitter(workspace, browser, container, sessionId) {
      const key = `dsh-browser-split:${sessionId}`
      let ratio = 60
      try {
        const saved = Number(localStorage.getItem(key))
        if (saved >= 20 && saved <= 80) ratio = saved
      } catch { /* Storage can be unavailable; resizing still works for this page. */ }
      const handle = document.createElement('div')
      handle.setAttribute('role', 'separator')
      handle.setAttribute('aria-label', '调整网页与聊天宽度')
      handle.setAttribute('aria-orientation', 'vertical')
      handle.setAttribute('aria-valuemin', '20')
      handle.setAttribute('aria-valuemax', '80')
      handle.tabIndex = 0
      handle.title = '拖动调整宽度；方向键微调，双击恢复默认'
      Object.assign(handle.style, { position: 'fixed', zIndex: '21', width: '8px', cursor: 'col-resize', touchAction: 'none' })
      document.body.append(handle)
      let pointer = null
      function apply(value) {
        ratio = Math.max(20, Math.min(80, value))
        workspace.style.setProperty('--dsh-browser-left', `${ratio}fr`)
        workspace.style.setProperty('--dsh-browser-right', `${100 - ratio}fr`)
        handle.setAttribute('aria-valuenow', String(Math.round(ratio)))
      }
      function save() {
        try { localStorage.setItem(key, String(ratio)) }
        catch { /* A denied storage write leaves this page's layout usable. */ }
      }
      function position() {
        const rect = browser.getBoundingClientRect()
        Object.assign(handle.style, { display: window.innerWidth > 900 && rect.width ? 'block' : 'none', left: `${rect.right - 4}px`, top: `${rect.top}px`, height: `${rect.height}px` })
      }
      function finish() {
        if (pointer === null) return
        const id = pointer
        pointer = null
        container.style.pointerEvents = ''
        handle.style.background = ''
        if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id)
        save()
      }
      handle.onpointerdown = event => {
        if (event.button !== 0) return
        event.preventDefault()
        pointer = event.pointerId
        handle.setPointerCapture(pointer)
        container.style.pointerEvents = 'none'
        handle.style.background = 'var(--dsw-alias-border-l2)'
      }
      handle.onpointermove = event => {
        if (event.pointerId !== pointer) return
        const rect = workspace.getBoundingClientRect()
        if (rect.width) { apply((event.clientX - rect.left) / rect.width * 100); position() }
      }
      handle.onpointerup = finish
      handle.onpointercancel = finish
      handle.onlostpointercapture = finish
      handle.ondblclick = () => { apply(60); save() }
      handle.onkeydown = event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return
        event.preventDefault()
        apply(event.key === 'Home' ? 60 : ratio + (event.key === 'ArrowLeft' ? -2 : 2))
        save()
      }
      apply(ratio)
      return { position, dispose() {
        finish()
        handle.remove()
        workspace.style.removeProperty('--dsh-browser-left')
        workspace.style.removeProperty('--dsh-browser-right')
      } }
    }
    function Entry({ sessionId, service }) {
      const open = useOpen(sessionId)
      React.useEffect(() => {
        if (restored.has(sessionId)) return
        let stopped = false
        void service.read({ sessionId }).then(result => {
          if (!stopped && result.ok && !restored.has(sessionId)) setOpen(sessionId, result.value.open, false)
        }).catch(error => console.error('[dsh-webview-mode] 状态恢复失败', error.message))
        return () => { stopped = true }
      }, [sessionId, service])
      React.useEffect(() => {
        let stopped = false
        let polling = false
        async function poll() {
          if (stopped || polling || jobs.has(sessionId)) return
          polling = true
          try {
            const response = await service.next({ sessionId })
            if (!stopped && response.ok && response.value) { jobs.set(sessionId, response.value); setOpen(sessionId, true) }
          } catch { /* Connection recovery uses the next bounded poll; pending host requests expire explicitly. */ }
          finally { polling = false }
        }
        const timer = setInterval(poll, 1000)
        return () => { stopped = true; clearInterval(timer) }
      }, [sessionId, service])
      const anchor = React.useRef(null)
      React.useLayoutEffect(() => {
        if (!open) return
        const chat = anchor.current?.closest('[data-phase]')
        const workspace = chat?.parentElement
        if (!workspace) return
        const browser = document.createElement('div')
        browser.className = 'dsh-browser-main'
        workspace.insertBefore(browser, chat)
        workspace.classList.add('dsh-browser-workspace')
        workspace.setAttribute('data-browser-open', '')
        chat.classList.add('dsh-browser-chat')
        const { container } = cachedPanel(sessionId, service)
        const splitter = installSplitter(workspace, browser, container, sessionId)
        const position = () => {
          splitter.position()
          const rect = browser.getBoundingClientRect()
          Object.assign(container.style, { display: rect.width && rect.height ? 'block' : 'none', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` })
        }
        const observer = new ResizeObserver(position)
        observer.observe(browser)
        window.addEventListener('resize', position)
        window.addEventListener('scroll', position, true)
        position()
        return () => {
          observer.disconnect()
          splitter.dispose()
          window.removeEventListener('resize', position)
          window.removeEventListener('scroll', position, true)
          container.style.display = 'none'
          browser.remove()
          workspace.classList.remove('dsh-browser-workspace')
          workspace.removeAttribute('data-browser-open')
          chat.classList.remove('dsh-browser-chat')
        }
      }, [open, sessionId])
      return h(React.Fragment, null,
        h('button', { ref: anchor, type: 'button', style: button, onClick: () => setOpen(sessionId, !open), title: '打开对话浏览器', 'aria-pressed': open }, '浏览器'),
      )
    }
    return {
      inject: ['slots', 'remote', 'uiConversation'],
      async apply(ctx) {
        const dispose = await ctx.remote.$mount({ package: packageName, descriptors })
        const service = ctx.reflect.get('remote.webviewArchive')
        if (!service) throw new Error('webviewArchive Remote did not mount')
        archiveService = service
        ctx.effect(() => () => {
          for (const { root, container } of panels.values()) { root.unmount(); container.remove() }
          panels.clear()
          openSessions.clear()
          restored.clear()
          jobs.clear()
        })
        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.plugin = 'dsh-webview-mode-layout'
          style.textContent = `
            .dsh-browser-workspace { height:100%; min-height:0; min-width:0; display:grid !important; grid-template-columns:minmax(0,1fr); }
            .dsh-browser-workspace[data-browser-open] { grid-template-columns:minmax(0,var(--dsh-browser-left,60fr)) minmax(0,var(--dsh-browser-right,40fr)); }
            .dsh-browser-main { display:none; min-height:0; min-width:0; overflow:hidden; }
            .dsh-browser-workspace[data-browser-open] > .dsh-browser-main { display:block; padding:0; }
            .dsh-browser-chat { min-height:0; min-width:0; height:100%; overflow:hidden; }
            .dsh-browser-workspace[data-browser-open] > .dsh-browser-chat { border-left:1px solid var(--dsw-alias-border-l2); }
            .dsh-browser-workspace[data-browser-open] > .dsh-browser-chat[data-phase] { --dsh-chat-content-width:calc(100% - 64px); --dsh-composer-card-max-width:calc(100% - 32px); }
            @media(max-width:900px) {
              .dsh-browser-workspace[data-browser-open] { grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(240px,48%) minmax(0,1fr); }
              .dsh-browser-workspace[data-browser-open] > .dsh-browser-chat { border-left:0; border-top:1px solid var(--dsw-alias-border-l2); }
            }
          `
          document.head.append(style)
          return () => style.remove()
        })
        ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
          name: 'conversation.session.header.utilities', id: 'webview-mode', order: 30,
          inject: () => ({ service }),
        }, Entry))
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'webview-mode', order: 25, label: () => '浏览器', inject: () => ({ service }),
        }, Setup))
        return dispose
      },
    }
  },
})
