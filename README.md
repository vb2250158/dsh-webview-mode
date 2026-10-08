# DSH 浏览器操作桥接

## 0.3.5：Desktop 能力状态

Desktop 使用官方 Sidebar Browser 的标签创建、选择、关闭、导航与刷新接口。状态返回 `carrier: desktop`、`dom.state: unsupported` 和 `extension.state: not-applicable`，不探测 Chrome 扩展。Desktop 网页快照、点击、输入、选择与滚动仍需官方受控 guest DOM 接口，目前明确拒绝这些操作；Web 扩展流程不变。

0.3.4 复用官方 `@deepseek-ai/dsh-client-ui-sidebar-browser`。标签、地址栏、前进后退、刷新、布局和聊天链接由官方管理；本插件提供 `conversation_browser`，让 Agent 操作同一个可见 iframe。

## 安装条件

需要 DSH 0.2.1-alpha.1、启用的官方 Sidebar Browser 和 `ctx.sidebarBrowser` 接口。当前官方版本没有此接口；源码运行环境须应用包内 `patches/sidebar-browser-bridge.patch` 并重建 Client 包。补丁不替换官方 UI。bundle 自动启用 `ui-sidebar-browser`。Desktop 可继续手动浏览，DOM 桥接只支持 Web iframe。

配套 Chrome 扩展仍为 0.2.3。在插件详情页查看安装目录，加载扩展并授权当前 DSH 来源。此次仅修改插件，扩展无需重新加载；Host 更新后刷新 DSH 页面。

## 旧标签迁移

首次打开会话时，按旧标签 ID 逐项复制到官方侧栏。每项创建成功后保存当前浏览器的迁移记录；记录写入失败则关闭刚创建的标签，保留原存档。重复访问不再次导入，已关闭的标签不自动重建。旧 `tabId` 通过迁移记录映射到官方 ID。不同浏览器分别迁移。

旧 ArchiveStore 文件保留在原目录，仅作为迁移源。读取旧存档支持尚未加载的会话，不唤醒 Agent。操作队列和旧存档写入仍要求已加载的会话。新标签由官方 Sidebar 的浏览器本地存储保存，刷新后遵循官方显式恢复规则；不恢复表单、滚动或页面内存。

## Agent 操作

`conversation_browser` 保留 `status`、`new`、`navigate`、`select`、`close`、`reload`、`snapshot`、`click`、`text`、`choose`、`scroll`。先检查 `status`，再对可见当前标签取 `snapshot`，使用最新 `snapshotId` 和元素 `ref` 操作，之后重新读取验证。导航信息不是加载成功证明。

DOM 操作只接受屏幕中所属会话的当前可见官方 iframe，后台标签须先 `select`。扩展按 Chrome 的 tabId/frameId/documentId 校验身份。密码和文件控件排除，不读取 Cookie、浏览器存储或文件，不提供任意 JavaScript。快照最多 200 个元素和 24000 字符；普通表单值可能进入会话日志，仅在任务需要时读取。

DOM 动作使用合成事件，不支持 Canvas、嵌套框架、关闭的 Shadow DOM 或可信物理键鼠。取消和超时可能发生在动作之后，不自动重试。网站嵌入和第三方登录限制遵循官方浏览器及 Chrome 策略。

## 验证与发布

`pnpm test` 验证迁移、官方导航、会话隔离和扩展操作。`DSH_DOM_TEST_RESOLVE_FROM` 指定已有 jsdom/Playwright 工作区 package.json；`DSH_EXTENSION_BROWSER_EXECUTABLE` 指定已有 Chromium，不自动下载。真实扩展测试使用临时 profile 与合成网页。

按既有环境同步流程安装固定 Git 提交，分别核对安装、Host 重启和页面刷新。兼容补丁仅包含 Sidebar Browser 的改动。设计与回滚说明见 [整合记录](docs/sidebar-consolidation.md)。
