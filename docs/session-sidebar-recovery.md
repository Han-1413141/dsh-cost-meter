# Sidebar search recovery / 侧栏搜索恢复

## English

If Settings → Cost is followed by loading placeholders and “No matching
sessions”, first check the sidebar search. **Do not delete sessions, reset cost
history, remove the workspace database, or clear browser storage.**

1. Close Settings, click the magnifying glass (“Search sessions”), and inspect
   the revealed query. If it is unexpected, use “Clear search”, or press Escape
   while that input has focus. Do not post the query if it contains private data.
2. Check that the original workspaces return. For [issue #232](https://github.com/Han-1413141/dsh-cost-meter/issues/232),
   the expected count is 18. Open a known conversation and check an existing
   message, without sending a new model request.
3. If needed, reload the page. This recreates the host’s local search state;
   it does not require resetting stored conversations or billing history.
4. If it still fails, record the browser version, other DSH plugin package
   names/versions/configuration, password-manager/autofill extensions, whether
   the revealed search was nonempty, and any failed session-search request or
   console error. Redact keys, tokens, account data and private conversation text.
5. Compare one change at a time in the same browser, with the search cleared:
   password-manager/autofill extension enabled vs disabled, then theme glass
   enabled vs disabled. A fresh browser alone changes too many variables to
   identify a conflicting plugin. Keep the original data and configuration.

### What the evidence establishes

The reported DSH 0.1.7-rc.2
[WorkspaceBrowser](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.2/packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx)
selects `SearchResults` only for a nonempty query. That branch renders the exact
two-row skeleton and “No matching sessions” text in the screenshots. A failed
content-search request can show the same empty text as a successful search with
zero matches. These screenshots do not establish that sessions were deleted.

The search input remains mounted while collapsed. Published Cost Overview in
both 1.8.6 and 1.8.10 eagerly mounts an unowned password input. A saved-login filler may
pair that password with the preceding text input, which can be the host search.
Chromium’s [security FAQ](https://github.com/chromium/chromium/blob/main/docs/security/faq.md)
explains why `autocomplete=off` is insufficient for password fields. This is a
source-supported hypothesis, **not confirmation of the reporter’s browser trigger**.

The defensive change mounts a credential editor only after “Edit credential”,
uses its own form and `new-password` hint, and removes the secret draft on Cancel,
successful Save or Clear. It never clears or changes the host’s search, session
store, workspace view preferences or ledger. Existing affected tabs still need
the host’s normal search-clear action, or a page reload.

Pinned [Catppuccin 0.5.8 source](https://github.com/NoNameLeGo/dsh-catppuccin-theme/tree/7544bc422609c0f2fae218565172d12dcf72adce)
changes material/geometry and stamps its own DOM attributes; inspection found no
session/search mutation or global input handler. That does not exclude a visual
interaction, but it does not justify blaming the theme for an empty search result.

### Verification boundary

- `test/sidebar-search-recovery.mjs` executes published host search components
  with deterministic VM hooks. It restores 18 synthetic workspaces and checks
  original message files, workspace preferences and a 78,000-call ledger remain
  unchanged. Slow, failed, aborted and late replies, intentional searches and
  remount recovery are covered on DSH 0.1.7-rc.2 and 0.2.0-rc.2
- `test/credential-editor-dom.mjs --baseline v1.8.6` uses real React and jsdom.
  An explicitly modeled saved-login pairing reproduces the old unowned-input
  mechanism; the fixed mount and scoped editor avoid that model. Edit, focus,
  Cancel, Save/Clear concurrency, failure/retry and disabled controls are covered
- Generated dictionary packing round-trips all 527 Chinese and 527 English
  translations; no UI wording is dropped to meet the 262,144-byte bundle limit
- Native Chromium launch and cloud-browser loopback access were unavailable in
  this execution environment. No native password-manager or reporter-profile
  end-to-end reproduction is claimed. Keep #232 open until the normal-tab
  recovery and upgrade checks are confirmed

## 中文

出现「加载占位条 → No matching sessions」时，先关闭设置，点击侧栏放大镜，查看
是否存在意外的搜索内容。使用宿主的「清除搜索」按钮，或在搜索框获得焦点后按
Escape。然后检查原工作区是否恢复，并打开一个已知对话核对原消息；#232 报告中
应有 18 个工作区。必要时刷新页面，**不要删除会话、清空费用历史、删除工作区
数据库或清空浏览器存储**。

宿主的非空搜索分支会显示截图中的占位条和空结果提示；搜索请求失败也可能显示
相同提示，因此不能由截图推断会话已删除。费用概览中的密码框与宿主隐藏搜索框
被自动填充配对，是有源码依据、尚待用户正常浏览器确认的假说。此修订仅在明确
点击「编辑凭据」后挂载独立表单中的密码框，取消、成功保存或清除后移除并清空
草稿，不改动宿主搜索、会话、工作区偏好或账本。

如果仍异常，请补充浏览器版本、其他 DSH 插件的完整包名/版本/相关配置、密码
管理器和自动填充扩展，以及同一浏览器中逐项启停扩展、启停 glass 的对照结果。
截图和日志需脱敏，不要公开凭据、搜索中的私人信息或原对话内容。静态检查未
发现 Catppuccin 0.5.8 修改搜索或会话状态的行为，不能据此认定主题是原因。

回归覆盖真实宿主组件回调、18 个合成工作区、原消息文件与 78,000 次调用账本的
完整性，以及真实 React/DOM 凭据编辑流程；自动填充测试明确使用模拟配对规则。
尚未在报告者的浏览器或原生密码管理器中完成端到端验证，需其确认恢复与升级
结果后再关闭问题。
