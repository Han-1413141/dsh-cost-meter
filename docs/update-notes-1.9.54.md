# v1.9.54 — Codex Subscription 3.2.4 兼容

## 中文

- 验证 Codex Subscription 3.2.4 的实际发布包，更新兼容基线和持续集成矩阵。
- 验证权限限制的公开说明经过额度 RPC 保留，错误正文与凭据继续脱敏。
- 验证登录完成后清理账号额度缓存，以及失败冷却结束后重新获取额度。
- 包含上一版的 billion-context 0.1.212 原生预填充进度与费用关联验证。

感谢 github-actions[bot] 在 [#465](https://github.com/Han-1413141/dsh-cost-meter/issues/465) 提供接口变化报告。详细记录见[兼容插件监控](plugin-compatibility-watch.md)。更新后完全重启 DSH。

## English

- Validate the published Codex Subscription 3.2.4 package and add it to the compatibility baseline and both host CI matrices.
- Preserve public access-failure explanations across the usage RPC while filtering private response data and credentials.
- Verify account-cache clearing after completed login and a fresh quota read after a failed-refresh cooldown.
- Include the preceding billion-context 0.1.212 native prefill-progress and cost-correlation checks.

Fully restart DSH after updating. See the [compatibility record](plugin-compatibility-watch.md).
