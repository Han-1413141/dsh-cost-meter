# v1.9.69

## 中文

- 「费用 → 价格 → 模型定价 → 自定义 → 更多计费项」增加长上下文价格，可设置输入 Token 阈值，以及输入、缓存读取、输出、缓存写入和单独推理的单价。输入与缓存读写合计超过阈值时应用长档。
- 从参考价格复制或编辑自定义价格时，保留长上下文、峰谷等已支持字段，修复长档丢失的问题。
- 「费用 → 显示 → 侧栏 → 侧栏布局」新增“图标”。点击图标展开原有组件，支持多账号余额及原有操作；已有布局保持不变。峰谷圆环使用固定 8 小时窗口。
- 验证 billion-context 0.1.215 以及 dsh-codex-subscription 3.2.17 / 3.2.18，更新兼容性基线。

感谢 [@PersueFree](https://github.com/PersueFree) 在 [#511](https://github.com/Han-1413141/dsh-cost-meter/issues/511) 提供问题报告、复现和定位；感谢 [@chanyuenpang](https://github.com/chanyuenpang) 在 [#514](https://github.com/Han-1413141/dsh-cost-meter/pull/514) 提供图标布局、构建优化和测试。

## English

- Edit long-context thresholds and rates under Model pricing → Custom → More billing fields. The threshold includes input and cache read/write Tokens.
- Preserve long-context, peak/off-peak and other supported price fields when copying or editing custom quotes.
- Add an opt-in Icons sidebar layout. Click an icon for the original component and its actions, including multiple account balances. The peak ring uses a fixed eight-hour countdown window.
- Verify billion-context 0.1.215 and dsh-codex-subscription 3.2.17 / 3.2.18, and update compatibility baselines.

Thanks to [@PersueFree](https://github.com/PersueFree) for the report and reproduction in [#511](https://github.com/Han-1413141/dsh-cost-meter/issues/511), and [@chanyuenpang](https://github.com/chanyuenpang) for the implementation and tests in [#514](https://github.com/Han-1413141/dsh-cost-meter/pull/514).

## 升级 / Upgrade

```sh
dsh plugin --profile web add dsh-cost-meter@latest
```

更新后重启 DSH。Desktop 用户参见 [安装与更新](https://github.com/Han-1413141/dsh-cost-meter/blob/v1.9.69/docs/install-troubleshooting.md#desktop-安装与更新)。
