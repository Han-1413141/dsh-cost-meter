# v1.9.59

## 中文

- 基础价、峰价、谷价提供独立倍率和统一倍率输入，同时显示实际单价。
- 已启用的 MiniMax 与其他 Coding Plan 在缺凭据、查询失败或无窗口时保留卡片，显示原因并支持点击或键盘重试。
- 会话切换复用同一版本的用量与代理计费记录，修复并发读取的取消隔离及归档变化后的缓存失效。
- 补充 Mistral 托管 GLM 5.3 Flash 和 DeepSeek V4.1 Flash 1017 的价格，修复渠道别名匹配，保留 Ollama 和既有日期模型的计价。
- 更新 billion-context 0.1.213、dsh-codex-subscription 3.2.7 兼容基线与 CI 覆盖。
- 补充 Billion Context 与 NodeJS 诊断的共存配置，保留计费和其他诊断组件，仅关闭 Host fetch 抓包。
- 重整中英文 README 与专题文档，保留全部徽章、贡献者和 Star 记录，加入 23 张界面截图并修正旧说明。

MiniMax Code OAuth 登录与 API Key 额度查询使用不同接口；本次保留 API Key 查询，补齐状态与重试。

## English

- Add separate and uniform multipliers for base, peak and off-peak rates, with effective-price previews.
- Keep enabled Coding Plan cards visible when credentials or quota windows are missing, with query errors and retry actions.
- Cache session billing reads while preserving cancellation isolation and archive invalidation.
- Add Mistral-hosted GLM and DeepSeek rates and correct aliases without changing Ollama or existing dated-model pricing.
- Verify billion-context 0.1.213 and dsh-codex-subscription 3.2.7; update compatibility baselines and CI.
- Document NodeJS diagnostics coexistence with Billion Context, retaining billing and other diagnostic components while disabling Host fetch capture.
- Reorganize bilingual documentation with all badges, contributor and Star displays, and 23 interface screenshots.

MiniMax Code OAuth uses a separate membership API. This release retains API Key quota queries and adds visible status and retries.

## 贡献来源

感谢 [@UNscientific-9](https://github.com/UNscientific-9) 在 [#408](https://github.com/Han-1413141/dsh-cost-meter/pull/408) 提供文档重组；[@tslotta](https://github.com/tslotta) 在 [#475](https://github.com/Han-1413141/dsh-cost-meter/pull/475) 补充 Mistral 定价；[@TLEWA](https://github.com/TLEWA) 在 [#478](https://github.com/Han-1413141/dsh-cost-meter/issues/478) 报告、定位会话卡顿并在 [#479](https://github.com/Han-1413141/dsh-cost-meter/pull/479) 提供缓存实现；[@AspirinEny](https://github.com/AspirinEny) 在 [#476](https://github.com/Han-1413141/dsh-cost-meter/issues/476) 提出倍率界面需求；[@parasolandyu](https://github.com/parasolandyu) 在 [#477](https://github.com/Han-1413141/dsh-cost-meter/issues/477) 提供额度卡片问题的复现和定位。

感谢 [@ChenJia-X](https://github.com/ChenJia-X) 在 [#483](https://github.com/Han-1413141/dsh-cost-meter/issues/483) 提供 NodeJS 诊断冲突的定位、共存方案和截图。

## 升级 / Upgrade

```sh
dsh plugin --profile web add dsh-cost-meter@latest
```

更新后重启 `dsh web`。Desktop 用户使用应用自带 CLI 与 `desktop` Profile，安装后完全退出并重新打开应用。

Restart `dsh web` after updating. Desktop users should use the bundled CLI and `desktop` profile, then restart the application.
