# DSH WebView Mode — iframe 试用版

独立插件，不修改官方源码。打开对话中的「浏览器」后，中间显示真实 iframe 网页，右侧保留聊天，关闭后恢复聊天布局。窄屏改为上下布局。界面沿用 DSH 主题。

## 使用

在地址栏输入完整 HTTP(S) 网址。网页中的选择文字、输入、滚动由浏览器直接处理，无需扩展。标签切换保留已挂载页面；切换 Agent 对话或隐藏面板只改变可见性，不卸载 iframe；切回来保留网页当前状态。刷新 DSH 或插件卸载后按存档恢复地址，不恢复表单或历史。

每个对话的标签 ID、地址、标题和当前标签仍通过原 ArchiveStore 保存到 `webview-mode/archives`，带写入版本冲突检查。iframe 内跨域跳转、网页实际标题、前进后退历史暂不可读取，存档记录的是地址栏提交的网址。登录状态受浏览器第三方 Cookie 策略影响，不能保证沿用顶层网页登录。

网站的 CSP frame-ancestors / X-Frame-Options 可能禁止内嵌。浏览器不能可靠地向父页面报告这类失败；插件不把 load 事件当成功证明，不移除网站安全头，不代理绕过限制。空白或拒绝连接时点击「新标签打开」。iframe 禁止顶层导航；新窗口不自动加入存档。

## 聊天链接

普通点击当前对话消息区内的完整 HTTP(S) 链接，默认展开该对话的浏览器面板并打开插件标签；相同完整 URL 复用已有标签。通过现有串行命令与 ArchiveStore 保存，不覆盖正在进行的 Agent 命令。此功能无需配套扩展。

Ctrl/Command、Shift、Alt、中键、下载链接、页内锚点、相对路径和 DSH 同源链接保留原生行为。面板工具栏「在 Chrome 打开」仍是外部打开入口。站点是否允许 iframe 嵌入的限制不变。监听器随对话头部卸载清理；当前适配依赖 DSH 的 `data-phase` 与 `data-conversation-scroll` 容器标记。

## Agent

`conversation_browser` 支持 navigate、new、select、close、reload，以及扩展 0.2.0 提供的 snapshot、click、text、choose、scroll。先 snapshot 获得 snapshotId 和元素 ref，操作时携带二者；text 替换文本，choose 使用选项 value，scroll 使用 deltaY（可带容器 ref）。操作后重新 snapshot 验证。目标必须是当前对话可见的选中 iframe，不能指定后台标签执行。navigate 只表示已提交显示请求，不证明加载成功。

扩展通过 Chrome 提供的 tabId/frameId/documentId 将操作绑定到真实 iframe，不创建独立浏览器标签，不使用 debugger。扩展选项中配置受信任 DSH 来源（当前页面的协议、主机和端口），默认不信任任何来源。升级后在 chrome://extensions 重新加载扩展，保存来源配置，再刷新 DSH。该授权允许受信 DSH 操作其内嵌页面；扩展需要 HTTP(S) 网页内容脚本与 webNavigation 权限。

快照仅是有限 DOM 文本与元素清单，不是截图；最多 200 个元素、24000 字符完整序列化结果，不读取密码、文件输入值、Cookie 或浏览器存储。网页文字是不可信数据，不是 Agent 指令。动作使用合成 DOM 事件，Canvas、跨域嵌套 iframe、关闭的 Shadow DOM 和要求可信物理键鼠的页面不支持，不提供任意 JavaScript 执行。被遮挡、失效或禁用的元素拒绝操作；同一 DOM 元素的标签、角色或链接等已改变时，旧 ref 也会拒绝，不会猜测替代目标。

请求由现有 BrowserBroker 限时领取；动作前检查会话请求有效性、页面可见性及文档身份。派发期间每 100ms 尽力同步取消，执行端在派发前及接收时检查截止时间。取消和点击可能竞争，已发生动作不能回滚；超时或取消后结果可能不确定，不自动重试有副作用操作。快照引用不写入存档；配置变化撤销连接和引用。

## 旧扩展

0.2.0 移除了旧截图转发和独立后台标签控制代码及 debugger 权限。以前创建的浏览器标签不会自动关闭，以免丢失用户页面状态。基础 iframe 浏览仍不需要扩展；Agent 页面操作需要更新后的扩展。

## 安装与验证

`dsh plugin --profile web add github:vb2250158/dsh-webview-mode#<commit>`，重启 DSH 后刷新网页。

`pnpm test` 验证存档、命令队列、文档身份路由、配置和聊天链接。DOM 用例需要现有 jsdom；真实扩展用例需要现有 Playwright 与 Chromium。可将 `DSH_DOM_TEST_RESOLVE_FROM` 指向拥有对应依赖的 package.json，分别执行 `node --test tests/frame-dom.test.js` 与 `node --test tests/frame-browser.test.js`；缺少依赖时明确跳过，不自动安装。`DSH_EXTENSION_BROWSER_EXECUTABLE` 可指定已有测试浏览器。

真实扩展测试使用临时独立浏览器 profile 和两个临时 HTTP fixture 来源，验证读取、填写、点击改变同一个跨域 iframe，标签数不增，导航后的旧引用及未配置的来源被拒绝。测试结束清理浏览器与 fixture；此证据不等于当前用户 DSH 已安装生效，也不覆盖完整 Host 工具调用到实际业务网站的端到端行为。

## iframe 新标签链接

扩展 0.1.1 新增直接嵌入 DSH 的网页链接转发。用户点击 target=_blank 链接或使用 Ctrl/Command/中键打开链接时，在当前对话新增插件标签；其他网页中的扩展脚本不注册处理器。接收端只接受当前可见 iframe 的消息，地址经过校验并经 ArchiveStore 保存。网页脚本 window.open、嵌套 iframe 和命名窗口暂不接管，仍可能打开 Chrome 标签。网站禁止内嵌时仍不能显示。

安装过旧扩展时需要在 chrome://extensions 手动重新加载扩展，再刷新 DSH。网页显示仍是 iframe，未恢复截图轮询或后台标签操作。工具栏「在 Chrome 打开」是明确的外部打开入口。

## 对话网页缓存

每个访问过的对话使用独立 React 根和固定 DOM 容器，容器不随会话头部卸载，也不重新插入 DOM。会话中的占位区域负责布局，ResizeObserver 同步可见面板位置。隐藏面板不会接管链接消息；后台网页仍可能运行脚本或播放声音，并占用内存。关闭标签页会销毁该 iframe，刷新操作会重新加载网页，刷新 DSH 或卸载插件会清空全部内存缓存。

## 弹窗修复 0.1.2

iframe 不再授予 allow-popups，未接管的弹窗由浏览器阻止。新增 MAIN world 脚本在网页脚本执行前接管直接子框架的 window.open HTTP(S) 地址，将其交给插件标签存档入口；普通命名窗口链接也接管。需要重新加载扩展并刷新 DSH。扩展的 MAIN world 注入使用 Chrome 官方 content_scripts 接口：https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts 。

window.open 返回 null，不模拟 WindowProxy。依赖先开空窗口再写入内容、表单 POST 弹窗、嵌套 iframe 或修改了 window.open 的网站仍可能无法使用；不会自动降级为外部弹窗。「在 Chrome 打开」仍是用户明确选择的外部入口。覆盖测试不代表用户网站验收。

## 恢复状态 0.1.3

面板展开状态持久化到同一会话存档，进入对话时恢复。旧存档缺失 open 字段时默认为关闭，原标签保留。标签更新不覆盖独立写入的开关状态。

扩展 0.1.3 上报实际 URL 和标题，包括整页导航、hash、前进后退和 SPA 地址变化（最长约 1 秒检测间隔）。客户端保存元数据而不改变现存 iframe 的 src；刷新整个 DSH 后按最后保存地址恢复。扩展需要在 chrome://extensions 重新加载，然后刷新 DSH。扩展未注入的页面不能报告跳转。滚动和表单不写入磁盘，原网页缓存只在当前 DSH 页面生命周期内保留。

浏览器面板与工作区边缘贴合，不使用额外外框、圆角或外围留白。仅工具栏保留控件内间距和底部分隔线，颜色沿用 DSH 主题。

## 重复开页修复 0.1.4

脚本弹窗仅在浏览器确认用户激活且本次手势未消费时转发；页面加载及自动重试不创建标签。用户打开的链接如已有相同完整 URL，切换到该标签，去重在串行命令队列中执行。手动新建空标签不受影响。既有重复标签保留其网页状态，不自动关闭。标题单行省略，标签栏横向滚动。扩展需重新加载到 0.1.4 后刷新 DSH。

iframe 声明 autoplay 权限以支持浏览器允许的跨域有声自动播放。仍遵守 Chrome 用户激活和站点声音设置，不修改播放器静音、系统音量或强制启动音频。无声时需检查播放器和 DSH 标签页是否静音。

桌面网页与聊天之间的分隔线可拖动，比例限制为 20%–80%，按会话保存在当前浏览器 localStorage。方向键微调，双击或 Home 恢复 60:40。拖动期间捕获指针，防止 iframe 抢走拖动事件；结束、取消或卸载时释放。窄屏保持上下布局。

## Git 安装来源

将 `<commit>` 替换为本仓库完整提交号。插件代码与运行所需产物随 Git 交付；用户设置、凭据和聊天记录不属于本仓库。

配套扩展目前只识别 localhost/127.0.0.1 的 3180 端口。其他端口仍可使用基础 iframe，但扩展转发能力不在本版本支持范围内。
