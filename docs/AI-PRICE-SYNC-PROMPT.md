# AI 价格同步提示词(AI Price Sync Prompt)

把下面的提示词交给任意带联网/工具能力的 AI(如 DeepSeek Harness 会话、Claude、GPT 等),
即可让它自主**读取官方定价、同步不同模型不同时间的价格**,并写出可被 dsh-cost-meter
直接使用的价格数据。你也可以在它输出后自行核对再应用。

---

## 可直接复制给 AI 的提示词

```text
你是 DeepSeek Harness 的 dsh-cost-meter 插件的价格同步助手。请完成以下任务:

1. 打开 DeepSeek 官方定价页:https://api-docs.deepseek.com/quick_start/pricing
   (若页面失效,尝试 https://api-docs.deepseek.com/zh-cn/quick_start/pricing 或官方公告页)。
2. 从页面中提取以下信息:
   - 每个模型的三个基础价格(美元 / 1M tokens):缓存命中(cache hit)、缓存未命中(cache miss)、输出(output);
   - 若页面给出峰谷计价(peak/off-peak)价格表:每个模型的谷时价与峰时价,
     以及生效时间(精确到 UTC 日期与时刻)和峰时段窗口(UTC 小时区间,如 01:00-04:00、06:00-10:00);
   - 页面列出的全部模型 id(如 deepseek-v4-flash、deepseek-v4-pro)。
3. 按下面的 JSON Schema 输出一份价格表(只输出 JSON 代码块,不要夹带其他内容):

{
  "models": {
    "<model-id>": {
      "cacheHit": 0.0028,
      "cacheMiss": 0.14,
      "output": 0.28,
      "offPeak": { "cacheHit": 0.007, "cacheMiss": 0.22, "output": 0.66 },
      "peak": { "cacheHit": 0.014, "cacheMiss": 0.44, "output": 1.32 }
    }
  },
  "default": { "cacheHit": 0.0028, "cacheMiss": 0.14, "output": 0.28 },
  "effectiveAt": "2026-08-16T16:00:00Z",
  "peakWindows": [{ "start": 1, "end": 4 }, { "start": 6, "end": 10 }]
}

规则:
- 价格单位为 美元 / 1M tokens,保留页面给出的全部小数位;
- 缓存写入(cache write)没有单独价格,按缓存命中价计费,不要发明新字段;
- 若页面没有峰谷计价:省略 offPeak / peak / effectiveAt / peakWindows 字段;
- "default" 填未匹配模型的回退价格(取页面最便宜一档模型的基础价格);
- 不要包含页面没有的模型;不要编造数字;不确定的数字标 null 并说明原因;
- 价格若按生效时间分段(如“自某日起变更”),在输出中额外给出
  {"schedule": [{"effectiveAt": "...", "models": {...}}]} 结构并解释新旧差异。

最后给出:
a) 提取依据(页面原文的关键表格片段);
b) 与 dsh-cost-meter 内置价格表(deepseek-v4-flash: 0.0028/0.14/0.28,
   deepseek-v4-pro: 0.003625/0.435/0.87, 峰谷自 2026-08-16T16:00Z 起)
   的差异清单;
c) 一份「人工核对清单」:每个数字在页面上的位置。
```

---

## 应用方式(三选一)

1. **设置页(推荐,人工)**:打开 设置 → 费用 → 价格表,按 AI 输出的数字逐项修改;
   修改后**自动保存**。
2. **RPC(自动化)**:对宿主网关调用
   `costMeter/updateConfig`,patch 形如:
   ```json
   {"patch": {"prices": {"models": {"deepseek-v4-flash": {"cacheHit": 0.0028, "cacheMiss": 0.14, "output": 0.28, "offPeak": {...}, "peak": {...}}}}, "peakEffectiveAt": "2026-08-16T16:00:00Z", "peakWindows": [{"start": 1, "end": 4}, {"start": 6, "end": 10}], "priceSource": "manual", "fetchedAt": "<ISO时间>"}}
   ```
3. **直接改文件(高级)**:编辑 `$DSH_HOME/storages/cost-meter/ledger.json` 的
   `config.prices` / `config.peakEffectiveAt` / `config.peakWindows`,
   重启 `dsh web` 前确保 JSON 合法且数字非负。

## 计费口径(必须遵守)

- 成本 = 未命中输入 × cacheMiss + 输出 × output + (缓存读 + 缓存写) × cacheHit。
- 峰谷计价**按生效时间门控**:`effectiveAt` 之前一律用基础价格;之后峰时段用 peak、其余用 offPeak。
- 基础价/谷时价/峰时价是**三档独立数字**,页面给出几档就写几档,不要把基础价当作谷时价。
- 不要删除账本中的自定义模型条目;官方已下架的历史模型(如 deepseek-chat)保留 legacy 标记即可。

## 验证清单(应用后)

- [ ] 每个模型三档价格与页面一致(逐位核对小数);
- [ ] effectiveAt 与页面“take effect at … UTC”一致;
- [ ] 峰时段窗口与页面“Peak hours are …”一致;
- [ ] 生效时间之前,设置页峰谷状态显示“尚未生效…按基础价格计费”;
- [ ] 生效时间之后,峰/谷时段状态显示正确。
