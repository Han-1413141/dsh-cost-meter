# dsh-cost-meter 全仓安全审计报告(v1.6.1)

> 审计日期:2026-08-26 · 范围:`lib/` 全部 10 模块、`scripts/`、`test/` 工具、`install.ps1`、依赖清单
> 方法:6 路并行模块级深审(逐行)→ 全量修复 → 双路 diff 级复审验证 → 测试全绿
> 结论:**73 项检查全部确认修复**;语法零错误;`test/verify.mjs` 全量通过;OpenCode 目录夹具 70/70 对齐

---

## 一、高危问题(3 项,已修复)

| # | 问题 | 位置 | 风险 | 修复 |
|---|------|------|------|------|
| S-1 | **账本退出丢写**:`close()` 先置 `closed=true` 再调 `flush()`,而 `flush()` 对 closed 直接返回——「退出前最终落盘」从未生效,每次进程退出丢失最后 ≤2s 防抖窗口内全部入账;写失败后 `pendingWrite` 已复位且永不重试 | store.js close()/flush() | 资金数据确定性丢失 | 先 flush 再关门;失败按防抖重排重试;小时桶修剪结果回赋内存 |
| S-2 | **发版脚本命令注入**:发布标题取自 UPDATE-HISTORY 文档标题,未转义拼进 `execSync` shell 串——恶意 PR 可在维护者发版机以仓库凭据执行任意命令 | scripts/release.mjs | 维护者 RCE / 供应链 | 全面改 `execFileSync` 数组参数绕开 shell;tag 格式白名单校验;素材写入移到 git 干净检查之后 |
| S-3 | **面板空指针崩溃**:Go 额度框对 `monthly` 窗口未判空(rolling/weekly 均有守卫),宿主下发单窗空值即整个渲染树崩溃 | client.js GoQuotaBox | 整 UI 白屏级崩溃 | 补齐空值守卫,与侧边栏口径一致显示 '—' |

## 二、计费与链路正确性(已修复)

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| B-1 | 路由调用(provider 空/'deepseek' 命中第三方目录)归为 plan 类却不写 provider×小时桶,整天段聚合又计入——今日段本地量系统性偏低,额度估算失真 | store.js account ↔ plan-billing aggregateUsageSince | 配额统计偏低 |
| B-2 | 客户端 parseState 丢弃宿主下发的 reconcile 字段——官方余额对账漂移警告 ⚠ 永不显示 | client.js parseState | 功能整体失效 |
| B-3 | 自定义余额提取规则配错时 `Number(null)===0`,失败被静默当作「余额 $0/预算打满」正常读数 | custom-balance.js queryCustomBalance | 误报余额 |
| B-4 | backfill 重算容器 cost 后不重算 apiCost,向下修正出现 apiCost>cost 双轨倒挂且一次性迁移不自愈 | backfill.js backfillLegacyLedger | 真金白银虚高 |
| B-5 | sanitizeDays 对损坏会话条目 continue 保留 null 元素,后续 sessions.find 读 .id 即崩 | store.js sanitizeDays → account | 运行时崩溃 |
| B-6 | llm/stream 计费包裹在消费方提前中断时不关闭下游迭代器:上游请求继续跑到完(厂商照扣全额)而 usage 无人消费,socket 挂起 | billing-stream.js costMeterStream | 已扣未记 + 连接泄漏 |
| B-7 | coding-plans 非 volcengine 路径 response.json() 无保护:200+HTML(Cloudflare 页)抛异常冲出多端点回退链 | coding-plans.js queryCodingPlan | 额度刷新失败放大 |
| B-8 | DeepSeek 直查路径价格条目绕过 normalizePrice:两桶简写配置产出 NaN 成本入账 | pricing.js providerPriceEntryForNormalized 等 5 处 | NaN 污染账本 |
| B-9 | SCNet 显式订阅日起算的周期末日落在次月对应日前一天,对应日全天用量滚入下期 | coding-plans.js scnetPlanPeriod | 周期边界错位 |

## 三、低危缺陷批次(已修复)

- 历史表格单槽 busy 互斥:展开 A 时点 B 显示假「暂无会话记录」→ 改 Set 支持并行加载(client.js HistoryTable)
- 会话排行快速切换时乱序响应覆盖新结果 → 序号守卫(SessionRankPanel)
- 「添加模型」首帧 draft 为 null 空指针 → 补守卫(CostSection.addModel)
- Codex 周额度徽章误随 Coding Plan 开关一起隐藏 → 提出独立门控(QuotaStrip)
- token 格式化 999500–999999 显示 '1000K' 边界伪影 → ≥999500 走 M 分支(formatTokens)
- 设置页自动保存基线被并发写入方回滚(另一窗口/引导按钮/轮询)→ 每份草稿冻结基线后再 diff
- numInput 接受负数价格/预算输入 → 源头拒绝负值
- 峰谷生效时刻填非法日期串静默禁用峰谷规则(Date.parse NaN)→ 清洗回落 + 校验报错
- ensure* 系列 in-flight 期间 force=true 被吞,手动强刷拿到即将过期的旧任务 → force 链式等待(4 处)
- Kimi/MiniMax 百分比只钳上限不钳下限,负 used 产生负 percent → 复用双向 clampPct
- formatMoney 的 decimals:0 被 falsy 归零成 2 位;注释称「截断」实为四舍五入 → 修数值与注释
- Go 设置面板 null 窗口显示硬 '0%' 与侧边栏 '—' 不一致 → 统一 '—'
- PlanStatsPanel 更新时刻回退 Date.now() 伪造读数 → 仅真实时间戳才渲染
- volcengine 表单把 apiKey 密钥回显进 AccessKeyId 明文框 → 移除回显
- scnet planCredits 裸数字输入接受负数/小数 → 正整数归一化
- fetchCodexQuota 无超时可致卡片永久消失 → 8s AbortSignal
- 设置区注册 id 带 locale 后缀,切语言丢草稿 → 稳定 id
- 余额 fetchedAt=0 渲染 1970 时间戳 → 守卫显示 '—'
- t('enable') 缺双语键渲染裸字面量 → 补 zh/en 键

## 四、加固项(已落地)

| 类别 | 内容 |
|------|------|
| 数据安全 | 账本损坏/版本不符先把原文件改名备份(`ledger.json.corrupt-<ts>`)再空启动,不再被下一次落盘无声覆盖 |
| 写入健壮性 | flush 失败恢复 pendingWrite 并按防抖重试(关门前不丢);原子 tmp+rename 保持 |
| 注入面 | mergeDeep 跳过 `__proto__`/`constructor`/`prototype`;价格表查询全部 `Object.hasOwn`(模型 id=`__proto__` 不再把原型当价格);costOf 终值有限性守卫 |
| 原子性 | 配置补丁合并前 structuredClone——被拒绝的补丁不再把就地规范化泄入活配置 |
| 别名共享 | 默认价表嵌套档位(offPeak/peak/legacyBase)structuredClone 深拷贝;目录构建同样克隆 |
| 凭据处理 | 模板替换改函数形式,密钥含 `$&`/`$$` 不再损坏 header;凭据仍不写日志 |
| 解析健壮 | HTML 实体单趟解码消除双重解码;官方页金额支持千分位逗号与括号价;中文峰窗正则限长防吞全文;目录抓取/校验加 15s 超时 |
| 内存 | 路由分类缓存 Map→WeakMap(不再随配置保存次数线性增长);backfill 提前丢弃打包行(大会话日志内存减半以上) |
| 并发/阻塞 | repairForkSeed/repairProviderDupes 转 async 每 8 项让出事件循环(启动不再冻结);ensureCodingPlan force 链式等待消除双重上游请求竞态 |
| 网络 | AbortError 仅在旧版 undici 超时形态(UND_ERR_ABORTED)下重试,手动取消不盲重;TimeoutError 保持瞬时 |
| 工具链 | install.ps1 corepack 引导兼容 PS5.1 stderr 坑(npm 回退恢复可达)+ COREPACK_DOWNLOAD_PROMPT=0 + profile 清单解析 try/catch 明确报错 |
| 行为一致性 | resetHistory 连 Plan 采样/小时桶/余额基准一并清理;插件卸载清理启动导入定时器;死代码清理(未用导入/导出/重复 JSDoc/无效语句块/6 个双语文案键) |

## 五、审计后保留的设计决策(如实说明)

- **normalizePercent 小数启发式保留**(n≤1 视为小数×100):verify.mjs 有显式契约断言(0.5→50、1→100),且 GLM 扁平窗口确实下发 0-1 小数(utilization 0.4→40%);Anthropic/OpenRouter 等 0-100 量纲字段走各自解析器不受影响。
- **Kimi 分→元阈值启发式保留**(≥100 视为分):官方响应仅 `{available_balance}` 无单位字段可依,测试双向锚定;如未来官方补充单位字段可切换直读。
- **凭据明文持久化/随状态下发**:本插件为单用户本机场景(localhost RPC),设置页编辑需要现值回显;掩码下发+写专用通道属功能级改造,列为后续增强项(见 SECURITY.md 威胁模型),本轮以「密钥不入日志/不入 URL/错误信息不含密钥」为底线并已验证。
- **ALS 扇出限制**:llm/stream 嵌套去重的深度标记对「单包装链」正确(issue #48 目标场景);若未来出现一次 pull 内扇出多个上游流的路由器需升级标记携带流身份——已在源码注释中明示。

## 六、验证记录

```
$ node --check lib/*.js scripts/*.mjs test/*.mjs   → 0 failures
$ node test/verify.mjs                             → [ok] 全部验证通过(78 组)
$ node test/check-opencode-catalog.mjs             → 70/70 sourceUrl 对齐,exit=0
复审:2 路独立 diff 级验证(42 项 lib 检查 + 31 项 UI/工具检查)全部 OK,
     复审发现的 3 个残留(force 链竞态/apiCost 落盘时机/注释失准)已二次修复并复测通过
```

涉及变更:16 个文件,+410/−219 行(不含文档)。
