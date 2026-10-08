# 官方侧栏整合

官方 Sidebar Browser 拥有当前标签和页面导航；本插件保留 `conversation_browser`、Chrome 扩展授权和结果记录。重复工具栏、分隔线、iframe 缓存、聊天链接拦截和原面板入口已退役。

官方包新增 `sidebarBrowser` 接口，复用原 Controller 与 iframe 的物理挂载。桥接不抓取私有注册表、不替换渲染器、不读取跨域 DOM。Desktop 没有 iframe 租约，页面操作明确报错。

迁移按旧稳定 ID 逐项保存进度；任一步记录失败只撤回新建标签，原 ArchiveStore 不改写。测试覆盖重复导入、失败、旧 ID 映射、导航转交、会话隔离、隐藏及替换后授权失效。

回滚使用之前的固定插件提交与官方源码快照。旧存档仍在原目录；新标签记录留在官方 Sidebar 的本地存储。不要删除旧存档或把新标签写回旧文件。
