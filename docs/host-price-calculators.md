# Host 动态报价接口

从 v1.9.78 起，Host 插件可在 `costMeter` 服务可用时调用 `registerPriceCalculator`。每个注册项负责一个精确的 `provider` 和 `model` 组合。重复注册会抛出异常。注册方法返回注销函数，可交给 Cordis 管理插件卸载。

```js
export function apply(ctx) {
  ctx.inject(['costMeter'], scope => scope.effect(() =>
    scope.get('costMeter').registerPriceCalculator({
      provider: 'my-gateway',
      model: 'my-model',
      calculate({ usage, atMs }) {
        const multiplier = new Date(atMs).getUTCHours() < 6 ? 0.5 : 1
        const input = usage.input * 2e-6 * multiplier
        const output = usage.output * 6e-6 * multiplier
        return {
          currency: 'USD',
          total: input + output,
          breakdown: { input, output },
          context: { version: 1, multiplier },
        }
      },
    })
  ))
}
```

回调同步接收 `provider`、`model`、毫秒时间戳 `atMs`，以及 `usage` 的 `input`、`output`、`cacheRead`、`cacheWrite` 和 `reasoning` 五个非负整数。示例对输入和输出收费，另外三项免费。Host 在记录调用时取价，插件可提前把自己的费率加载到内存。

返回值的 `currency` 支持 USD、CNY、EUR。`total` 是该币种下本次调用的金额，允许零。`breakdown` 可省略，也可按上述用量字段提供金额，合计须与总额相符，零用量分项应为零。`context` 可记录 `version`、`tier`、`multiplier` 和五种用量字段的数值，例如当次使用的价格版本及倍率。以上金额和上下文数值须有限且在 0 到 10¹² 之间。

返回 `null`、没有注册项、回调报错、返回 Promise 或报价未通过校验时，本次调用采用已有的价格匹配规则。无效报价在该注册项生命周期内最多输出一次提示。官方按次收取的请求费沿用专门的计价规则。套餐的等值费用与实际 API 支出沿用现有分类。

账本与本次用量一并保存原币总额、分项、上下文、计费时间和记录时的汇率。显式重算会跳过含冻结报价的会话、日期和渠道桶；明细按路由、时间和用量匹配到唯一报价时使用原始记录。扩展方法只接受同一 Host 进程中的回调。
