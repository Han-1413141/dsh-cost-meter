# v1.9.53 — billion-context 0.1.212 兼容

## 中文

- 验证 billion-context 0.1.212 的实际 npm 发布包，接受原生请求预填充进度请求头变化，更新兼容基线与持续集成。
- 补充连续原生请求检查，确认从响应学习的进度可用于下一次 Request 请求，并保留请求体、会话标识与费用确认。
- 验证代理／原生计费、四种协议、压缩、重试、缓存、父子会话、历史回放和原版 CLI 自动接入。

更新后完全重启 DSH。详细记录见[兼容插件监控](plugin-compatibility-watch.md)。感谢 github-actions[bot] 在 [#462](https://github.com/Han-1413141/dsh-cost-meter/issues/462) 提供版本和函数指纹变化报告。

## English

- Validate the published billion-context 0.1.212 package and update its compatibility baseline and CI coverage.
- Verify that native prefill progress learned from a response reaches the next Request input while preserving the body, conversation ID and cost acknowledgements.
- Exercise proxy/native billing, four protocols, compression, retries, cache usage, child sessions, history replay and stock CLI integration with local synthetic fixtures.

Fully restart DSH after updating. See the [compatibility record](plugin-compatibility-watch.md).
