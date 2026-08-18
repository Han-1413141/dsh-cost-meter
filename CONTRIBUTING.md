# 贡献指南 · Contributing

感谢你愿意为 **dsh-cost-meter** 出力!无论是报告 bug、提交功能、改进文档还是翻译,都欢迎。本文档说明如何让贡献顺利合入。

English summary follows the Chinese text below.

---

## 开始之前

- 请先读 [README](README.md) 了解插件功能与架构,以及 [CHANGELOG](CHANGELOG.md) 确认你的想法是否已实现或已被讨论。
- 行为上请遵守 [行为准则](CODE_OF_CONDUCT.md)。
- 涉及安全漏洞请勿公开提 issue,见 [SECURITY.md](SECURITY.md)。

## 报告 Bug

开 issue 时请尽量包含:

1. **环境**:dsh-cost-meter 版本(`git log -1` 或 Release tag)、dsh / Node 版本、操作系统;
2. **复现步骤**:从干净状态到出错的最小步骤;
3. **现象与期望**:实际看到什么、期望看到什么;
4. **日志/截图**:浏览器控制台报错、`dsh web` 启动日志、相关截图(可脱敏)。

> 一个带复现步骤和日志的 issue,通常当天就能定位。

## 提交功能 / 修复(PR)

1. **先开 issue 讨论**(较大改动尤其重要),确认方向后再动手,避免返工;
2. fork 后基于最新 `master` 建分支,单功能单 commit 或清晰的少量 commit;
3. 本地自检通过(见下「提交前自检」);
4. 提 PR,说明动机、改动点、如何验证;附上截图/录屏更佳。

### 提交前自检(必过)

```sh
# 1) 语法检查(改动到的文件都要过)
node --check lib/index.js && node --check lib/client.js && node --check lib/store.js \
  && node --check lib/pricing.js && node --check lib/coding-plans.js && node --check lib/backfill.js

# 2) 全量回归(含旧账本 strict codec 哨兵、descriptor 对齐、端点白名单等)
node test/verify.mjs
```

### 这个项目的几个「坑」(改动时务必注意)

这些是历史上真实踩过的,改动涉及对应区域时请特别小心:

- **strict codec 一致性**:新增配置项要同时走 `applyConfigPatch` 校验 + `sanitizeConfig` 清洗,并加进 `lib/typert.host.js` 的 strict `configSchema`;新增状态字段加进 `stateSchema`(拿不准就 `.optional()`)。漏任何一处,`getState` 会被 strict codec 拒掉,表现为「账本不可用」。
- **RPC 清单双侧对齐**:服务端 `lib/typert.host.js` 加了 RPC 方法,客户端 `lib/client.js` 的 `CONTRIBUTION.descriptors` 必须同步加同名条目,否则前端调用报 `is not a function`(verify.mjs 有自动对齐断言)。
- **`package.json` 的 `files`**:目前按 `lib` 目录整体发布,新增 `lib/` 模块无需再改;但若改动发布范围,务必用 `npm pack --dry-run` 核对产物,避免装出「半包」。
- **双语**:所有面向用户的文案都要补 zh/en 两套(客户端 `makeT` 两份字典 + 服务端 `SERVER_MESSAGES` 两份)。
- **外部端点白名单**:涉及第三方接口时,端点域名要能过 verify.mjs 的白名单断言,凭据只发往官方域名。

## 代码风格

- 纯 ESM、无构建步骤;客户端是单文件 bundle(`lib/client.js`),遵循其现有手写 React(`el(...)`)+ CSS 变量(`--dsw-alias-*`)风格;
- 注释跟随现有密度与语气,解释「为什么」而非复述代码;
- 金额恒以美元存储,币种/汇率只在展示层换算。

## 文档与翻译

README / README.en 与 `docs/` 下的说明(适配文档、更新历史、release notes 等)都欢迎改进。中英请保持对应。

## 许可

提交即表示你同意你的贡献按本项目的 [MIT 许可](LICENSE) 发布。

---

## English Summary

Thanks for contributing to **dsh-cost-meter**!

- **Bug reports**: open an issue with environment (plugin/dsh/Node version, OS), minimal repro steps, expected vs actual, and logs/screenshots.
- **PRs**: discuss big changes in an issue first; branch off latest `master`; run `node --check` on touched files and the full regression `node test/verify.mjs` before submitting.
- **Gotchas**: keep the strict codec consistent (new config keys must pass `applyConfigPatch` + `sanitizeConfig` + `typert.host.js` schema; new state fields go into `stateSchema`); keep server RPC and client `CONTRIBUTION.descriptors` in sync; verify `npm pack` output if you change `files`; add both zh/en strings; keep third-party endpoints within the whitelist assertions.
- By submitting, you agree your contribution is licensed under the project's [MIT License](LICENSE).
