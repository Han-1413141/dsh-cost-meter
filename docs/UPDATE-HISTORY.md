# dsh-cost-meter 版本更新历史

> 本文是面向使用者的版本更新总览;逐条开发记录见 [CHANGELOG.md](../CHANGELOG.md),完整提交历史见
> [Commits](https://github.com/Han-1413141/dsh-cost-meter/commits/master)。

## v1.3.0(2026-08-16)—— OpenCode Go 订阅额度

![合并卡片](screenshot-sidebar-footer-v2.png)

- **OpenCode Go 订阅额度进侧边栏**:滚动 5 小时 / 本周 / 本月用量百分比与重置时间;与预算图框同款圆角样式,各自独立开关,两者同开自动**合并为一张卡片**(仅 Go / 仅预算 / 合并三态随意切);
- **收起更紧凑**:「图框详细信息」开关收起次要行,只留 标签 + 已用% + 进度条;主档位(5h/周/月)可配;窄栏(rail)收成百分比方块;
- **右下角 dock chips**:5h / 周 / 月额度、预算已用% 四项独立开关;
- **Key 自动发现**:显式配置 → DSH 凭据库(`OPENCODE_GO_API_KEY`)→ 环境变量 → opencode 登录态,基本零配置;
- 修复社区反馈 #2、#3(见文末),文档截图全面翻新(v2)。

## v1.2.0(2026-08-14)—— 中英双语界面

- 插件界面全面接入 i18n:简体中文 / English / 跟随浏览器,切换即时生效;服务端消息(余额、价格同步、校验错误)同语言输出;
- 安全加固:余额查询凭据仅发往官方域名 `api.deepseek.com`,非官方 baseURL 直接拒绝;安装链固定到发布 tag 与 pnpm 版本,可审计可复现;
- 新增 `dshhub` 清单,接入 DSH Hub 收录。

## v1.1.2(2026-08-14)—— 一键安装

- 内置 `install.ps1`:`irm … | iex` 一行直装(自动补齐 pnpm / 探测 git / 无 git 走 tag 打包直链);重跑即为更新;
- 支持 `dsh plugin add github:Han-1413141/dsh-cost-meter` 与 GitHub 打包直链安装;
- CI 新增 `install-smoke`:Windows / Linux 真机验证一键安装;README 英文版上线。

## v1.1.0 – 1.1.1(2026-08-14)—— 布局打磨

- 余额行移到预算图框上方;预算图框新增「今日费用与占预算%」;修复合并渲染与 `normalizePrice` 峰谷价清零问题;侧边栏截图改紧凑版。

## v1.0.0(2026-08-14)—— 首个正式版

- 功能全览:会话徽章(输入区下方 / 标题栏)、当日费用、预算(额度 + 周期 + 预警色)、官方余额、汇总卡片、今日会话明细、按天历史、价格表、峰谷计价、官方价格一键同步、AI 价格同步提示词。

## v0.4.0(2026-08-14)—— 官方余额

- 侧边栏 / 设置页显示官方开放平台余额(总 / 赠送 / 充值),刷新间隔可配 + 手动刷新;设置改即时自动保存;峰谷计价状态提示。

## v0.3.0(2026-08-14)—— 预算图框

- 自定义预算周期(今日 / 本月 / 累计 / 自定义区间);侧边栏圆角预算图框(已用%、进度条、≥80% 预警、≥100% 超支),窄栏为百分比方块。

## v0.2.0(2026-08-14)—— 预算与缓存分计

- 设置页预算面板;输入 / 缓存 / 输出 token 分列统计,缓存读写按命中价计费。

## v0.1.0(2026-08-13)—— 首发

- 本会话费用徽章、当日费用徽章、设置 → 费用页(汇总 / 明细 / 历史 / 价格表)、峰谷计价、官方价格同步、账本持久化。

---

## 社区 issue 处理记录

> 按编号倒序;处理详情以对应 issue 页为准。

| # | 类型 | 标题 | 提出者 | 处理 | 版本 |
|---|---|---|---|---|---|
| [#3](https://github.com/Han-1413141/dsh-cost-meter/issues/3) | issue | 客户端无轮询：侧边栏「今日费用/余额」冻结在页面加载时刻 | Silence-Jun | 已修复:60s 周期轮询(隐藏跳过)+ visibilitychange 可见即刷新 + reload 并发防抖 + 卸载清理([05dfcfa](https://github.com/Han-1413141/dsh-cost-meter/commit/05dfcfa)) | v1.3.0 |
| [#2](https://github.com/Han-1413141/dsh-cost-meter/issues/2) | issue | OpenCode Go 额度显示 HTTP 403（key 解析未走 DSH 凭据库 + 请求缺 User-Agent 被 Cloudflare 拦截） | mlosun | 已修复:Key 解析优先级对齐余额路径(显式配置 → DSH 凭据库 `OPENCODE_GO_API_KEY` → 环境变量 → 兼容旧名 → auth.json)+ 浏览器 User-Agent 绕过 Cloudflare 1010([ad3aaf7](https://github.com/Han-1413141/dsh-cost-meter/commit/ad3aaf7)) | v1.3.0 |
| [#1](https://github.com/Han-1413141/dsh-cost-meter/pull/1) | PR | 侧边栏 rail 改用钱包图标（官方填充式 SVG） | zhtx2024 | 已合并:窄栏余额行由 ¥ 文本符号改为官方风格钱包图标(currentColor 跟随主题)([0d55fa1](https://github.com/Han-1413141/dsh-cost-meter/commit/0d55fa1)) | v1.2.0 前 |
