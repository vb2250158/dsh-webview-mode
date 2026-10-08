# Changelog

## 0.3.3 (2026-10-08)

- 官方侧栏通过 bundle 和 Client 注入声明加载，移除没有直接模块导入的额外 npm peer 声明。
- Keep Browser activation and ordering in the bundle and Client injection metadata without adding unused npm peer edges.

## 0.3.2 (2026-10-08)

- 选择、导航和刷新主动展开官方侧栏，避免收起状态等待页面挂载超时。
- Reveal the official Sidebar before commands that need its mounted page.

## 0.3.1 (2026-10-08)

- 修正随包接口补丁中的双语一致性记录，验证补丁可完整反向校验。
- Refresh translation-pair records in the bundled official bridge patch.

## 0.3.0 (2026-10-08)

- 浏览界面、标签、布局和聊天链接交给官方 Sidebar Browser，只保留 Agent 操作桥接。
- 旧标签逐项迁移，原存档保留；迁移记录失败时撤回刚创建的标签。
- Requires the included Sidebar Browser bridge patch. Companion extension remains 0.2.3.

## 0.2.13 (2026-10-07)

- 缩小图标绘制内容约三分之一，增加方框内的留白。
- Reduce icon artwork by one third with a centered, padded viewBox.

## 0.2.12 — 2026-10-07

- Open this plugin from the Plugins list to access its existing configuration and controls. Settings no longer duplicates its navigation entry.
- 在插件列表中点击本插件进入详情页，即可使用原有配置和操作界面；设置菜单不再重复显示该插件入口。

## 0.2.11 (2026-10-07)

- 为插件列表提供中英文名称与说明，并发布独立的 SVG 图标。
- Publish English and Chinese plugin display metadata and a dedicated SVG icon.

## 0.2.10

- Align maintenance lockfiles and peer versions with the DSH 0.2 runtime.

## 0.2.9

- Update DSH compatibility requirements and interfaces for 0.2.1-alpha.1.

## 0.2.8

- Replace the long operation timeout in browser setup status with a short installation and refresh instruction when the extension handshake fails. The specific reloaded-extension state still asks for a page refresh.
- Keep the companion extension at 0.2.3 because the extension files are unchanged.

## 0.2.7

- Supply both the current loader's `schema` field and the newer loader's `create()` field for each Host Typert codec. Both reference the same Zod schema, so the settings UI release loads on either Harness version.
- Keep the companion extension at 0.2.3 because the extension files are unchanged.

## 0.2.6

- Replace the six-action browser setup toolbar with three numbered installation steps. Each step shows the value to use and one copy action; existing installations can follow the reload instruction in step 2. Keep connection status visible and recheck it when DSH is refreshed.
- Keep the companion extension at 0.2.3 because this release changes only the settings UI.

## 0.2.5

- Stop a reloaded extension from turning into an unrecoverable `Extension context invalidated` error. Reloading orphans every already-open page's content script, whose `chrome.*` handles die with the old extension; the previous code called `chrome.storage.sync.get` immediately and let the raw throw escape as an unhandled rejection into the page's error overlay. The bridge and the frame agent now test `chrome.runtime?.id` first — the storage listener cannot cover this, because a dead context receives no storage events — and reply `Extension was reloaded; reconnect to the extension` (a plain answer, not a throw). The settings line turns that into the one step that works: refresh the page.
- Companion extension is now **0.2.3**: unlike 0.2.3/0.2.4 this release does change extension code (`bridge.js`, `frame-agent.js`), so the required version moves with it.

## 0.2.4

- Fix the browser panel footer hint, which still named `0.2.1` as the companion version to reload after the required version had moved to `0.2.2`. It now interpolates the required version, so it cannot drift again.
- Have the same hint name the actual failure it addresses: `Extension context invalidated` is raised by a content script orphaned when the extension was reloaded while the page stayed open, so the fix is reloading the extension **and** refreshing the page — not just one of the two.
- Keep the companion extension at 0.2.2: like 0.2.3, this release changes only the plugin-side settings section, and raising an unchanged extension version would force a pointless extra reload.

## 0.2.3

- Report a companion extension older than the required version before reporting an unauthorized origin. A stale companion answers the handshake with `configured: false` even when the only real problem is its age, so the previous order told the user to authorize an origin while the setup button that grants it could not run at all; the version and the reload step are now named first.
- Add a button that copies `chrome-extension://<id>/options.html`. Pasting it into the address bar opens the options page directly, so first-time authorization still works when the in-page setup button gets no answer from an outdated companion; the button is disabled when the handshake has not reported an id.
- Keep the companion extension at 0.2.2: this release changes only the plugin-side settings section.

## 0.2.2

- Add setup affordances to the settings section: a live extension handshake line and buttons to open the extension options page, copy the `chrome://extensions` deep link, copy the current DSH origin, and copy the extension directory.
- Let an origin that is not authorized yet reach the extension options page, since that page is where authorization is granted; the action reads no page, tab or archived data, is restricted to the current top-level DSH document, and every other request from such an origin stays denied.
- Report the extension id in the status handshake so the settings section can deep-link to the right extension card, and fall back to the plain extensions page when the handshake is unavailable.
- Copy through the async Clipboard API when available and fall back to a temporary field, so copying also works from the plain-HTTP gateway, which is not a secure context.
- Companion extension version is 0.2.2.

## 0.2.1

- Add read-only status with archived tab provenance and an actual extension protocol/version handshake; status does not open the panel.
- Expose associated form labels and bounded non-sensitive control values/states so snapshots can verify edits; reject refs when resolved destinations or option definitions change.
- Route user links and metadata through isolated extension messages with Chrome document verification; retire unauthenticated page messages and MAIN window.open interception.
- Allow revoking all trusted origins; remove deployment-specific origin constants. Companion extension version is 0.2.1.
- Reload only the selected iframe and preserve background form state.
- Add configurable connection handshake timeout and sandboxed real-extension regression evidence.

- Add Agent snapshot, click, text, choose and scroll commands for the actual visible iframe, with document-scoped refs and bounded output.
- Replace the dedicated-tab/debugger worker with Chrome document-identity routing; remove debugger permission.
- Add configurable trusted DSH origins and an extension options page; extension manifest version is 0.2.1.
- Add DOM, message-isolation, options and real Chromium extension integration tests, including cancellation before dispatch and settings revocation during binding. Cancellation remains best effort after dispatch.
- Reject snapshot refs when a recycled DOM element's label, role or link has changed.

- Open ordinary HTTP(S) chat-link clicks in the current conversation browser, reusing existing tabs.
- Preserve modified clicks, downloads, internal navigation and the explicit external-browser action.
- Add link-routing and listener-disposal regression coverage.

## 0.1.1 - 2026-09-09

- Publish the existing local plugin as an independent MIT Git repository.
- Add repository metadata and portable installation instructions.
- Preserve existing runtime behavior and documented limitations.
- Replace local source dependencies with published exact DSH versions.
