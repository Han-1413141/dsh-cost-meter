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
5. **其他插件**:列出其他已安装 DSH 插件的完整包名、版本及相关配置；没有则写“无”。界面问题还请附浏览器版本、密码管理器/自动填充扩展及同一浏览器中的启停对照结果（未测试也注明）。不要清空会话、账本或浏览器存储来复现。

> 一个带复现步骤和日志的 issue,通常当天就能定位。

## 提交功能 / 修复(PR)

1. **先开 issue 讨论**(较大改动尤其重要),确认方向后再动手,避免返工;
2. fork 后基于最新 `master` 建分支,单功能单 commit 或清晰的少量 commit;
3. 本地自检通过(见下「提交前自检」);
4. 提 PR,说明动机、改动点、如何验证;附上截图/录屏更佳。

### 提交前自检(必过)

```sh
# 1) 修改 src/client/ 后重新构建已提交的客户端产物
npm run build

# 2) 语法检查(改动到的文件都要过)
node --check lib/index.js && node --check lib/client.js && node --check lib/store.js \
  && node --check lib/pricing.js && node --check lib/coding-plans.js && node --check lib/backfill.js

# 3) 全量回归(含旧账本 strict codec 哨兵、descriptor 对齐、端点白名单等)
node test/verify.mjs
```

回归套件默认禁止未模拟的外网请求，凭据场景仅使用合成值、进程内 HTTP 桩与本机回环测试服务器。若需要额外检查公开价格页面，可显式运行 `DSH_TEST_LIVE_PRICING=1 node test/verify.mjs`；此选项只允许不带凭据的官方价格页面读取，不开放账户或用量 API。

改动侧栏底部布局时，可运行浏览器回归页面。参数填写已安装 `react` 和 `react-dom` 的 `node_modules` 目录（例如 DSH 开发环境）：

```sh
node test/sidebar-footer-layout.mjs /path/to/node_modules
```

打开输出的本地地址，点击 `Run regression`，检查 `PASS` 结果及可见布局。页面使用合成数据，覆盖四种宽度、中英文、三种显示模式、新旧宿主结构和动态启停；追加 `--baseline v1.7.42` 可复现 #192 的升级后问题。

DSH 0.1.7 的 `SlotOutlet` 会添加 `<div data-slot="sidebar.footer.action" style="display: contents">`。该节点没有布局盒，但仍参与 CSS 子节点选择器匹配；测试必须保留这层容器，不能仅复制 `SidebarRoot` 的样式。隐藏和卸载费用区时也要确认宿主布局恢复。

### 这个项目的几个「坑」(改动时务必注意)

这些是历史上真实踩过的,改动涉及对应区域时请特别小心:

- **strict codec 一致性**:新增配置项要同时走 `applyConfigPatch` 校验 + `sanitizeConfig` 清洗,并加进 `lib/typert.host.js` 的 strict `configSchema`;新增状态字段加进 `stateSchema`(拿不准就 `.optional()`)。漏任何一处,`getState` 会被 strict codec 拒掉,表现为「账本不可用」。
- **RPC 清单双侧对齐**:服务端 `lib/typert.host.js` 加了 RPC 方法,客户端 `lib/client.js` 的 `CONTRIBUTION.descriptors` 必须同步加同名条目,否则前端调用报 `is not a function`(verify.mjs 有自动对齐断言)。
- **codec 两代契约**：两端统一通过 `strictCodec` 构造，保留 `schema` 与 `create()`。设置 `DSH_TEST_NODE_MODULES` 后 `test/verify.mjs` 必须通过已安装宿主的真实 loader；源码宿主另运行 `test/typert-source-host.mjs`，环境与固定提交见 `.github/workflows/install-smoke.yml`。npm alpha 与同版本号的源码检出不一定使用同一契约。
- **`package.json` 的 `files`**:目前按 `lib` 目录整体发布,新增 `lib/` 模块无需再改;但若改动发布范围,务必用 `npm pack --dry-run` 核对产物,避免装出「半包」。
- **双语**:所有面向用户的文案都要补 zh/en 两套(客户端 `makeT` 两份字典 + 服务端 `SERVER_MESSAGES` 两份)。
- **外部端点白名单**：默认端点域名须通过 verify.mjs 的官方白名单断言。MiniMax 允许用户显式配置可信 HTTPS origin；须保持地址校验、单 origin 回退和拒绝重定向，并在界面说明 Key 的发送目的地。

## 代码风格

- 服务端使用纯 ESM；客户端源文件位于 `src/client/`，运行 `npm run build` 后生成单文件 `lib/client.js`，提交时须包含更新的产物，不直接编辑生成文件。客户端遵循现有手写 React(`el(...)`)+ CSS 变量(`--dsw-alias-*`)风格；
- 注释跟随现有密度与语气,解释「为什么」而非复述代码;
- 金额恒以美元存储,币种/汇率只在展示层换算。

## 文档与翻译

README / README.en 与 `docs/` 下的说明(适配文档、更新历史、release notes 等)都欢迎改进。中英请保持对应。

## 许可

提交即表示你同意你的贡献按本项目的 [MIT 许可](LICENSE) 发布。

---

## English Summary

Thanks for contributing to **dsh-cost-meter**!

- **Bug reports**: include environment (plugin/dsh/Node version, OS), minimal repro steps, expected vs actual, logs/screenshots, and all other installed DSH plugin package names, versions and relevant settings (or `None`). For UI issues include browser version, password-manager/autofill extensions and same-browser plugin/extension A/B results, or state that these are untested. Do not clear sessions, the ledger or browser storage to reproduce.
- **PRs**: discuss big changes in an issue first; branch off latest `master`; after editing `src/client/`, run `npm run build` and include the generated `lib/client.js`. Run `node --check` on touched files and the full regression `node test/verify.mjs` before submitting.
- **Gotchas**: keep the strict codec consistent (new config keys must pass `applyConfigPatch` + `sanitizeConfig` + `typert.host.js` schema; new state fields go into `stateSchema`); keep server RPC and client `CONTRIBUTION.descriptors` in sync; verify `npm pack` output if you change `files`; add both zh/en strings; keep third-party endpoints within the whitelist assertions.
- By submitting, you agree your contribution is licensed under the project's [MIT License](LICENSE).
