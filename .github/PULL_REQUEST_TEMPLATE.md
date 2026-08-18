## 概述 · Summary

<!-- 用 1-3 句话说明:解决什么问题 / 实现什么功能,关联的 issue 编号(如 Closes #12)。 -->

## 改动类型 · Type

- [ ] Bug 修复
- [ ] 新功能
- [ ] 文档 / 文案 / 翻译
- [ ] 重构 / 代码质量
- [ ] 其他:

## 改动点 · Changes

<!-- 逐条列出主要改动;涉及 UI 的请附截图或录屏(中英界面各一张更佳)。 -->

-

## 自检清单 · Checklist

- [ ] 已基于最新 `master`,且关联 issue 已讨论过(较大改动)
- [ ] 改动文件 `node --check` 通过
- [ ] `node test/verify.mjs` 全量回归通过
- [ ] 新增配置项:`applyConfigPatch` 校验 + `sanitizeConfig` 清洗 + `typert.host.js` `configSchema` 三处齐全
- [ ] 新增状态字段:已加入 `stateSchema`(拿不准就 `.optional()`)
- [ ] 新增 RPC:服务端 `typert.host.js` 与客户端 `CONTRIBUTION.descriptors` 双侧同步(verify.mjs 有对齐断言)
- [ ] 面向用户的文案:zh/en 双语齐全(客户端 `makeT` + 服务端 `SERVER_MESSAGES`)
- [ ] 新增第三方端点:域名在官方白名单内,凭据只发往官方端点
- [ ] 改到 `package.json` `files` 或发布范围:`npm pack --dry-run` 核对过产物
- [ ] 更新 [CHANGELOG.md](CHANGELOG.md)(`[Unreleased]` 段)

> 以上清单对应 [CONTRIBUTING.md](CONTRIBUTING.md) 中「这个项目的几个坑」,逐项勾选可显著加快 review。
