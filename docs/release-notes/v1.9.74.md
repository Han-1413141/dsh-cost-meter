# v1.9.74

## 中文

- 更新 GitHub 首页的微信群二维码，欢迎加入插件交流 5 群。
- DeepSeek 余额直接读取官方数据。余额进度条缺少预算上限时仅显示金额；自定义余额可以用服务返回的上限绘制进度条。
- 自定义价格可以复制已有渠道和模型的币种、各项单价、倍率、峰谷规则及长上下文档位。可在保存前编辑复制结果。
- 显示设置将侧栏全局选项与组件选项分开。关闭示例数据时按实际配置渲染预览。会话费用明细支持点击弹窗外部关闭，并调整了按钮、提示和内容间距。
- 额度页可添加 OpenAI API 赠送额度。根据手填的赠送金额和有效期，以及 OpenAI 官方返回的组织 API 费用，显示预估剩余、总额、组织费用和到期日。
- 验证 `dsh-codex-subscription` 3.2.23 和 3.2.24，兼容基线更新到 3.2.24。

感谢 [@cinast](https://github.com/cinast) 在 [#529](https://github.com/Han-1413141/dsh-cost-meter/issues/529) 提供显示设置和会话费用明细的截图与交互建议。[@PersueFree](https://github.com/PersueFree) 在 [#530](https://github.com/Han-1413141/dsh-cost-meter/issues/530) 提出自定义价格模板，在 [#532](https://github.com/Han-1413141/dsh-cost-meter/issues/532) 复现余额满格并定位上限缺失，并[提醒更新群二维码](https://github.com/Han-1413141/dsh-cost-meter/issues/530#issuecomment-6971033997)。感谢 [@Solismuchengxue](https://github.com/Solismuchengxue) 在 [#533](https://github.com/Han-1413141/dsh-cost-meter/issues/533) 提出 OpenAI API 赠送额度显示需求，以及 [GitHub Actions](https://github.com/apps/github-actions) 在 [#531](https://github.com/Han-1413141/dsh-cost-meter/issues/531) 报告上游版本变化。

## English

- Update the repository README with the WeChat group 5 QR code.
- Use the official DeepSeek wallet balance. Show the balance amount without a progress bar when a budget cap is unavailable. Custom balance sources can use a cap supplied by their API.
- Copy currency, rates, multipliers, peak and off-peak settings, and long-context tiers from an existing custom model price into an editable draft.
- Group sidebar-wide settings apart from component options. With sample data disabled, the preview follows the active display settings. Click outside the session cost dialog to dismiss it.
- Add an OpenAI API credit estimate to Quotas and the sidebar. Enter the grant amount and dates, and use official organization API costs to estimate remaining credits.
- Verify `dsh-codex-subscription` 3.2.23 and 3.2.24, and update the compatibility baseline to 3.2.24.

Thanks to [@cinast](https://github.com/cinast) for the settings and dialog feedback ([#529](https://github.com/Han-1413141/dsh-cost-meter/issues/529)), [@PersueFree](https://github.com/PersueFree) for the price template proposal ([#530](https://github.com/Han-1413141/dsh-cost-meter/issues/530)), the balance progress reproduction and diagnosis ([#532](https://github.com/Han-1413141/dsh-cost-meter/issues/532)), and the [WeChat group report](https://github.com/Han-1413141/dsh-cost-meter/issues/530#issuecomment-6971033997), and [@Solismuchengxue](https://github.com/Solismuchengxue) for the OpenAI API credit request ([#533](https://github.com/Han-1413141/dsh-cost-meter/issues/533)). [GitHub Actions](https://github.com/apps/github-actions) reported the upstream version change in [#531](https://github.com/Han-1413141/dsh-cost-meter/issues/531).

## 升级 / Upgrade

```sh
dsh plugin --profile web add dsh-cost-meter@latest
```

更新后请完全退出并重启 DSH。Desktop 用户参见 [安装与更新](https://github.com/Han-1413141/dsh-cost-meter/blob/v1.9.74/docs/install-troubleshooting.md#desktop-安装与更新)。
