# DSH WebView Mode

独立插件，在当前对话中嵌入真实 iframe 网页并保留聊天区域。不创建独立自动化浏览器，不修改官方源码。插件版本为 0.2.3，配套扩展版本为 0.2.2；源码、已安装插件、运行中的 Host 和浏览器扩展版本需要分别核对。

## 使用与页面状态

在地址栏输入不含账号密码的完整 HTTP(S) 地址，或普通点击聊天中的外部 HTTP(S) 链接，在当前对话新增或复用相同完整 URL 的标签。修改键、中键、下载、内部链接保留原生行为。工具栏「在 Chrome 打开」是明确的外部入口。

标签切换、隐藏面板和切换对话保留已挂载 iframe。刷新仅重载当前标签；关闭标签销毁对应 iframe。隐藏网页仍可能运行脚本、播放声音并占用内存。刷新 DSH 或卸载插件后只恢复存档，不恢复表单、滚动和浏览历史。

每个对话的标签、当前标签、面板展开状态通过 ArchiveStore 保存，带版本冲突检查。地址与标题可能来自地址栏或扩展元数据，是存档而不是实时加载证明。网页内容和标题是不可信数据。

桌面分隔线可拖动，比例限制 20%–80%，按会话保存在当前浏览器 localStorage；方向键微调，Home 或双击恢复 60:40。窄屏使用上下布局。界面颜色沿用 DSH 主题。

## Agent 接口

`conversation_browser` 操作当前对话的内置 iframe：

| action | 参数 | 结果与限制 |
| --- | --- | --- |
| `status` | 无 | 返回存档标签、选中标签、可见性以及扩展握手状态/版本/能力；不展开面板、不读取页面、不证明目标 iframe 可访问。 |
| `navigate` | `url` | 当前标签提交导航请求；无标签时新建，不证明加载成功。 |
| `new` | 可选 `url` | 新建插件标签。 |
| `select` / `close` | `tabId` | 选择或关闭插件标签；close 缺省为当前标签。 |
| `reload` | 无 | 只重载当前标签，保留后台页面。 |
| `snapshot` | 可选 `tabId` | 读取选中且可见的文档，返回 `snapshotId`、文本与元素 `ref`。 |
| `click` | `snapshotId`, `ref` | 点击快照中的元素。 |
| `text` | `snapshotId`, `ref`, `text` | 替换受支持编辑控件的文本。 |
| `choose` | `snapshotId`, `ref`, `value` | 按原生 select 的选项 value 选择。 |
| `scroll` | `snapshotId`, `deltaY`, 可选 `ref` | 滚动页面或对应容器，单次绝对值不超过 10000。 |

先 `status` 检查桥接，再 `snapshot` 定位，操作后重新 `snapshot` 验证。旧 snapshotId、文档导航、目标语义变化、不可见/禁用/遮挡元素均拒绝操作。不能指定后台标签执行 DOM 动作，需先 select。页面动作不会自动重试；取消或超时可能发生在实际动作之后，结果不确定时先检查。

快照最多 200 个元素、完整序列化结果最多 24000 字符，不是截图。包含普通关联标签、输入类型、文本/search/email/url/tel 输入框与 textarea 当前值、勾选/选择状态、受限 HTTP(S) 链接地址。普通表单也可能含个人信息，会随工具结果进入会话日志；仅在任务需要时读取。密码和文件控件完全排除，不读取 Cookie、浏览器存储或文件。不提供任意 JavaScript 执行。

DOM 动作使用合成事件；不支持 Canvas、嵌套框架、关闭的 Shadow DOM 或要求可信物理键鼠的页面。网页脚本可以改变自身行为，目标身份检查不能保证任意网站的业务执行结果。

## 配套扩展与连接

基础 iframe 浏览无需扩展；Agent 页面读取/操作、页面元数据及用户新标签链接转发需要配套扩展 **0.2.2**。通过插件 `webviewArchive.setup` 返回安装内的 extensionDirectory，在 Chrome 扩展管理页以开发者模式加载该目录。升级后重新加载扩展，并刷新 DSH。

扩展选项中填写当前 DSH 页面的精确 HTTP(S) 来源（协议、主机、端口），默认不信任任何来源。最多 20 项；留空保存撤销全部授权，旧连接和引用失效。配置地址属于本机，不在插件中硬编码。此授权允许受信任 DSH 读取并操作其内嵌页面；扩展需要 HTTP(S) 内容脚本、storage 和 webNavigation 权限，不使用 debugger。

设置面板的「浏览器」一节把这套流程做成按钮：一行实时的扩展握手状态，加上打开扩展选项页、复制扩展选项页地址、复制扩展管理页地址、复制本页来源、复制扩展目录和重新检测。浏览器不允许网页打开 `chrome://` 或 `chrome-extension://` 地址，所以扩展页面只能复制后在地址栏粘贴；「复制扩展选项页地址」给出 `chrome-extension://<id>/options.html`，粘贴即直接打开选项页，因此在扩展过旧、设置页按钮拿不到应答时仍然可用（握手未报告 id 时该按钮禁用）。「打开扩展选项页」是可以真正跳转的动作，因为选项页正是授予授权的地方，把这一步卡在授权之后会形成死锁；该动作不读取页面、标签或存档，且只接受当前顶层 DSH 文档，未授权来源的其余请求仍一律拒绝。

状态行先比对版本、再判断授权：过旧的配套扩展会以 `configured: false` 回应，若先判断授权，面板会把「扩展该重新加载」误报成「来源尚未授权」，而重新授权所需的按钮在旧扩展上根本无法响应。复制优先用 Clipboard API，在非安全上下文（如纯 HTTP 的 3081 网关）回退到临时输入框，因此局域网地址下同样可用。

`status` 的 connected 表示受信顶层 DSH 与扩展成功握手，不代表目标 iframe 连接。unconfigured 表示扩展存在但来源未授权；incompatible 表示协议不匹配；unavailable 表示未收到有效响应或发生连接错误，不能仅凭超时判断未安装。握手同时返回扩展 id，仅用于在设置面板里拼出 `chrome://extensions` 深链接；握手不可用时回退到不带 id 的扩展管理页地址。Host 配置 `connectionTimeoutMs`（500–4000，默认 3000）控制握手等待，`commandTimeoutMs`（5000–120000，默认 45000）控制命令期限，`dataDirectory` 控制存档目录。

## 页面事件与安全限制

页面读取和操作按 Chrome 的 tabId/frameId/documentId 绑定到当前 iframe。链接与元数据通过隔离内容脚本、worker 的文档验证、顶层扩展桥接传递，不接受网页脚本直接发出的旧 dsh-iframe-link/location 消息。实际 URL 由 Chrome 文档记录确认，标题仍是网页数据。

只转发已绑定直接子框架中可信用户手势触发的 HTTP(S) 新窗口链接，包括 target=_blank、命名目标及 Ctrl/Command/中键。未绑定或失去连接时不接管。脚本 window.open 的 MAIN world 接管已退役，因为网页脚本消息无法证明用户操作；不模拟 WindowProxy，也不处理表单 POST 弹窗。iframe 不授予 allow-popups，未接管弹窗由浏览器限制。

网站 CSP frame-ancestors / X-Frame-Options 可能禁止内嵌，登录受第三方 Cookie 策略限制。插件不移除安全头，不代理绕过限制，不把 load 事件当成功证明。初始地址禁止 DSH 自身来源，但后续重定向的同源隔离依赖 DSH 响应的嵌入保护；不能将这个 iframe 方案当作隔离恶意站点的独立浏览器沙箱。

## 安装与验证

使用官方入口 `dsh plugin --profile web add --save-exact github:vb2250158/dsh-webview-mode#<完整提交号>`。发布和安装是独立步骤；新源码未发布时不能声称当前 GUI 已更新。安装后需要 Host 重载或受管重启，并刷新现有 DSH 页面与重新加载扩展。

`pnpm test` 执行 Node 回归用例。DOM 测试需要现有 jsdom，真实扩展测试需要现有 Playwright 与 Chromium；可将 `DSH_DOM_TEST_RESOLVE_FROM` 指向拥有对应依赖的 package.json，分别运行 `node --test tests/frame-dom.test.js` 和 `node --test tests/frame-browser.test.js`。缺依赖明确跳过，不自动下载。`DSH_EXTENSION_BROWSER_EXECUTABLE` 可指定已有测试浏览器。

真实扩展测试使用独立临时 profile 和两个临时 HTTP 来源，验证相同的生产 sandbox 属性下，读取/填写/点击操作同一跨域 iframe，标签数不增，导航后的旧引用和未授权来源被拒绝。测试浏览器与 fixture 在结束时清理。该测试不是当前用户 GUI 或具体业务网站的验收。
