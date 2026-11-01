# v1.9.48：模块注册兼容与 Codex 重置时间

## 中文

- 修复启用 dsh-loader 时的客户端重复注册及异步模块加载失败：为费用插件保留原生 `chunk` 与 `require.async`，继续使用按需加载和宿主热更新。感谢 [@3-yanyupingsheng](https://github.com/3-yanyupingsheng) 在 [#452](https://github.com/Han-1413141/dsh-cost-meter/issues/452) 提供桌面环境、错误日志、重启复现及跨版本对照。
- Codex 输入栏额度的悬停提示按窗口显示剩余百分比与完整重置时间，并显示更新时间；有 5 小时窗口时与 7 天窗口一起展示，缺少时间时保留额度、不生成日期。
- 验证 billion-context 0.1.210、0.1.211 实际发布包的计费与原版 CLI 自动接入，更新兼容基线和 CI，处理 github-actions[bot] 的 [#451](https://github.com/Han-1413141/dsh-cost-meter/issues/451)。
- Preserve native chunk registration under dsh-loader, display Codex reset dates in the input-bar tooltip, and verify published billion-context 0.1.210–0.1.211 packages.

### Codex 使用方式

升级后，鼠标移到输入栏的 **Codex** 额度上即可查看。每个窗口独立显示剩余百分比与本地时间的完整重置日期，底部显示更新时间和点击刷新提示。上游仅提供周额度时只显示周窗口；返回 5 小时额度时自动一起显示，无需新增设置。

### 桌面端重复注册

[#452](https://github.com/Han-1413141/dsh-cost-meter/issues/452) 的报错栈包含 `dshloaderLoad`。核对 [dsh-loader 1.3.5 源码](https://github.com/dsh-plugins/dsh-loader/blob/v1.3.5/src/client.ts) 和实际 npm 包，发现其包装器只转发 `id`、`factory`，丢失 `chunk`；传给工厂的函数还丢失 `require.async`。官方模块系统本身按“包 ID + 分块文件”区分模块。

本版本在检测到该包装器仍生效时，使用其保存的原生注册函数注册费用插件自身模块。全局加载器与其他插件的别名映射保持原样，真正的重复执行仍由宿主报错。主入口和 13 个分块统一使用该处理。

如果曾按 issue 中的临时办法禁用了 `cost-meter`，升级后可恢复启用并完全退出、重启桌面端。桌面壳 2.0.20-next 对应核心 0.2.1-rc.3，具体验证范围见[宿主兼容记录](host-compatibility.md#2026-11-01模块加载兼容452)。

## English

The input-bar Codex tooltip now shows each available quota window's remaining percentage and full local reset date, followed by the last update time. Weekly-only accounts remain weekly-only; a supplied five-hour window appears automatically. Missing reset dates are omitted without hiding valid quota values.

The dsh-loader 1.3.5 wrapper drops both chunk metadata and `require.async`. This release registers only cost-meter's own modules through the wrapper's saved native function, preserving the global loader, other plugins' aliases, duplicate-execution errors and host invalidation. Published host module systems 0.2.0-rc.2, 0.2.1-rc.3 and 0.2.1-rc.5 are covered with native and wrapped loading over Web and desktop URLs. This is module integration coverage, not a full Electron desktop run.
