# v1.9.70

## 中文

- 修复 OpenAI 兼容入口和第三方渠道的 DeepSeek 价格匹配，支持工作站、套餐别名、`deepseek-ai` 命名空间及 Magpie 多层账号路由。
- 优先使用手动映射和渠道自有价格，完整型号优先于格式别名及日期标签，保留 Mistral 等渠道的独立转售价。
- 区分 Flash／Pro、版本、上下文规格、免费及本地来源。缺少价格或存在歧义时显示未定价。
- 工作站转发后保留 API／套餐归属。免费插件经过转发后沿用“按免费计算”设置。
- 旧账单保留原计价规则，可使用历史重算按新规则更新。

感谢 [@pyk136874470692022](https://github.com/pyk136874470692022) 在 [#499](https://github.com/Han-1413141/dsh-cost-meter/issues/499) 报告第三方 API 调用费用为零并提供截图，促成本次排查。

## English

- Fix DeepSeek price matching through compatible APIs, workstations, plan aliases, the `deepseek-ai` namespace and nested Magpie account routes.
- Prioritize manual assignments, provider-specific prices and full model IDs, preserving independent reseller rates such as Mistral's.
- Distinguish Flash/Pro, versions, context sizes and free/local sources. Missing or ambiguous quotes remain unpriced.
- Preserve API/subscription attribution and the free-model setting through forwarding routes.
- Keep historical matching rules in saved price versions. Explicit history recalculation can apply the new rules.

Thanks to [@pyk136874470692022](https://github.com/pyk136874470692022) for the third-party API zero-cost report and screenshots in [#499](https://github.com/Han-1413141/dsh-cost-meter/issues/499).

## 升级 / Upgrade

```sh
dsh plugin --profile web add dsh-cost-meter@latest
```

更新后重启 DSH。Desktop 用户参见 [安装与更新](https://github.com/Han-1413141/dsh-cost-meter/blob/v1.9.70/docs/install-troubleshooting.md#desktop-安装与更新)。
