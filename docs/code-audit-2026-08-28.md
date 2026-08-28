# dsh-cost-meter 计费与核心链路代码审计(2026-08-28)

> 审计对象:v1.6.8 源码(约 1.4 万行)。修复随 **v1.6.9** 发布;本文记录审计方法、
> 结论、全部发现与修复映射,以及复核确认无需改动的已知边界,供后续审计对照。

## 1. 审计范围与方法

| 层 | 文件 | 关注点 |
| --- | --- | --- |
| 计价核心 | `lib/pricing.js` | 价格表/补齐规则、峰谷档位(`tierFor`)、计费数学(`costOf`)、币种折算、官方页解析、模型名匹配 |
| 实时计费 | `lib/billing-stream.js`、`lib/index.js` | llm/stream 瀑布记账、ALS 嵌套去重、包装层跳过、请求发起时刻锚定 |
| 账本 | `lib/store.js` | `account()` 聚合、apiCost 双轨、原子落盘、清洗、迁移 |
| 历史修正 | `lib/backfill.js` | 会话日志回放、fork 种子/包装层/定价三类清洗、币种换基准 |
| 双轨统计 | `lib/plan-billing.js` | Plan/API 分类、采样差分估算、小时桶、窗口归一 |
| 额度/余额 | `lib/coding-plans.js`、`lib/custom-balance.js`、`lib/net.js` | 9 家 adapter、签名、提取规则、重试封装 |
| 前端 | `src/client.js`(6579 行) | 服务端镜像的计费/分类/格式化函数、拆分口径、配置链路 |
| 契约 | `lib/typert.host.js`、`package.json`、`install.ps1` | RPC schema 双侧一致、依赖锁版、安装链 |

方法:全量通读源码 → 服务端/客户端**镜像实现逐一对拍**(bundle 无法导入 Node 模块,
客户端是同逻辑手抄镜像,漂移是本类仓库的主要风险面)→ 脚本复算可疑点(峰谷计费数学、
周末全谷价日历、CNY 折算、provider 键排序)→ 修复后行为级回归(见 §5)。

## 2. 结论摘要

核心计费链路(实时钩子 → 账本 → 投影 → 回放/回填 → 双轨 apiCost)设计自洽、防御严密,
**未发现导致账本金额系统性算错的服务端缺陷**。确认的问题集中在**客户端镜像实现与服务端的口径漂移**
(3 处,含一处约 50% 的峰时低估),另有 3 处服务端健壮性加固点。全部修复于 v1.6.9。
另修复 CI 回归门禁首跑即红的时区炸弹测试(§4.4)。

## 3. 确认的问题与修复(v1.6.9)

### P1|客户端「当日已用」漏计 `deepseek-official:` 前缀

- **位置**:`src/client.js` `todayOfficialUsd`(修复前只匹配 `!== 'deepseek'`)。
- **根因**:服务端 `officialCostOfDay`(`lib/store.js`)计 `deepseek` 与 `deepseek-official`
  两种官方键(issue #36 / v1.6.5 已确认官方路由实际落账键形如
  `deepseek-official:deepseek-v4-flash`),客户端镜像没有同步这一修正。
- **影响**:纯官方路由账本上,侧边栏官方余额进度条的「当日已用」段恒为 0/偏低,
  且与服务端对账(`reconcileBalanceDelta`)口径不一致。
- **修复**:客户端补双前缀判定,并同口径剥离宿主包装路由 `llm-` 前缀。

### P2|客户端回退计价丢失峰谷子档(峰时低估约 50%)

- **位置**:`src/client.js` `normalizeClientPrice` → `usageSplit` → `tierFor`。
- **根因**:`normalizeClientPrice` 只返回 `{cacheHit,cacheMiss,output,reasoning}`,
  剥掉 `offPeak/peak/legacyBase` 子档;`tierFor` 取不到 `entry.peak` 恒回基础档(=谷价)。
  客户端 `tierFor` 还缺峰谷时代分界(`legacyBase`)分支。
- **触发路径**(两条,均真实可达):
  1. 会话含 Plan 类模型时 `SessionCost`/`DockLine` 的 API/Plan 拆分(`usageSplit`);
  2. 投影快照缺精确 `usage.cost`(旧宿主/旧 checkpoint)时的会话费用回退。
- **量化**:峰时 2M 输入(未命中)+ 1M 输出,服务端按事件时刻计 **$2.20**,
  客户端回退估 **$1.10**(deepseek-v4-flash 峰/谷价恰为 2 倍)。
- **修复**:新增 `normalizeClientTier`(与服务端 `completeTier` 同口径:只认非负有限数字、
  补齐缺省、`input/cachedInput/cacheRead` 别名),子档随主档保留;客户端 `tierFor`
  补 `LEGACY_BASE_BOUNDARY`(2026-08-16 16:00 UTC)分支与 NaN 归一。

### P3|decimals=0 显示被抬成 2

- **位置**:`src/client.js` `formatMoneyValue`:`Math.floor(Number(d) || 2)` —— `0 || 2 = 2`。
- **根因**:服务端 `formatMoney`(`lib/pricing.js`)修过同款坑并留注释
  (「合法配置的 decimals:0 须保留」),客户端镜像未同步。
- **影响**:纯显示;用户设 0 位小数仍显示 2 位。
- **修复**:与服务端同规则(`Number.isFinite(req) ? floor : 2`)。

### 服务端加固(3 处)

1. **`officialCostOfDay` 补 `llm-` 前缀剥离**(`lib/store.js`):计价
   (`providerPriceEntryFor`)与 Plan 归类(`planProviderIdOf`)都剥宿主包装路由 `llm-`
   前缀,官方渠道判定此前不剥——`llm-deepseek` 形态落账会被漏计;`llm-zen` 等
   第三方网关仍不计入。
2. **`repairProviderDupes` 保留键优选**(`lib/backfill.js`):指纹分组此前恒保留字母序
   第一个键,而 `deepseek-modlens:` 恰排在 `deepseek-official:` 之前——官方键被删、
   包装层键存活,需依赖后续 `modlens-wrapper-dedup-v1` 形态 3 改挂才恢复正确。
   现排序优先保留非包装层(上游真实)键,同包装层性时仍按字母序;**合并语义不变**。
   注:`deepseek-modlens-vision` 等深层变体不在 `isWrapperProviderId` 判定范围
   (8h 用例断言,仍由 ALS 嵌套标记处理),同组无上游键时仍按字母序保留(既有 8g 语义)。
3. **`tierFor` 对 NaN 生效时刻口径归一**(`lib/pricing.js` + 客户端同修):
   `effectiveAtMs` 为 NaN 时 `isPeakHour` 视作已生效、offPeak 分支视作未生效——
   谷时段落 base 档、峰时段取 peak 档的不对称。现非有限值一律归一为
   「未知生效时刻」,两侧同口径。默认表 base=offPeak 同值,实际行为不变,仅消除 footgun。

### CI 修复|install-smoke 回归门禁时区炸弹

v1.6.8 起回归门禁进 CI(`install-smoke` workflow)后首跑两腿即红
(ubuntu 51s / windows 9m59s,后者大头是 pnpm 安装,非超时):

- **根因**:SCNet 计费周期用例把自然月期望值硬编码为 `'2026-08-01'`,断言输入为
  `2026-08-01T00:00:00+08:00`。CI(UTC)上该时刻的本地日历月是 **7** 月,
  `scnetPlanPeriod` 按运行时本地日历正确返回 `'2026-07-01'` —— 实现没错,断言写死了时区。
- **修复**:期望值改由测试进程本地日历推导(起点取 `new Date(p2Now)` 的年月,月末同法),
  断言与实现同口径、任意时区自洽。
- **验证**:本地以 TZ=UTC(CI 同款)/ America/Los_Angeles(UTC-8)/
  Pacific/Kiritimati(UTC+14)/ 机器本地(UTC+8)四种时区全量复跑通过
  (Windows Node 支持 `TZ` 环境变量,可在开发机模拟 CI 时区)。

## 4. 复核通过、无需改动的部分

- **计费数学**:`costOf` 峰/谷/legacy 三档、cacheWrite 按命中价、reasoning 仅在价目
  显式给出时计费;CNY 价表 ÷ 汇率入账、展示乘回抵消。抽查:峰时 1M+0.5M = 1.10 ✓、
  谷时 = 0.55 ✓、CNY 折算逐位 ✓。
- **周末全谷价**:`weekendZoneAt` 北京日历数学逐日验证(2026-08-23 起仅周日、
  08-29 起周六周日全天、生效前的周六不覆盖)全部正确;客户端 `peakPhaseAt` 为同逻辑镜像。
- **防重复计费三层体系**:ALS 嵌套标记(issue #48)→ 包装层 provider 跳过
  (issue #70)→ 两次一次性清洗迁移;`dedupeWrapperProviderDays` 四形态
  (全等/⊃/改名/⊂)推理无误,净效果各形态均恢复真实用量。
- **双轨一致性**:`splitLedgerApiCost` 桶级回写 + 容器 Σ桶 + 残差归 API,幂等;
  配置变更/价格迁移/币种切换各触发点联动正确;apiCost 恒 ≤ cost 有钳制。
- **健壮性**:账本值全链清洗、strict codec 三级降级、原子写 + 损坏改名留存、
  zstd 逐帧解压防 OOM、原型链防护(`priceEntryFor`/`getPath`/`mergeDeep`)、
  网关 JSON 安全校验(显式 undefined 键)。
- **安全(v1.6.8)**:密钥不落盘(`stripSecrets`)+ 不下发(空占位 + describe 状态)、
  `setCredential` 单向通道、自定义余额 https 强制 + 拒绝重定向 + `allowedHosts`、
  凭据函数替换防 `$&` 展开、密钥迁移「绝不静默丢弃」三态处理。

## 5. 已知边界(文档化,不改)

1. **`repairProviderDupes` 跨渠道指纹合并是启发式**:两个真实渠道的桶六值全等且模型同名
   时会被误合并。一次性迁移(`provider-dedup-v1` 已打标),存量风险有限。
2. **ALS 嵌套标记的 R-7 边界**(源码注释已声明):若未来包装路由改为「拉取期惰性」
   发起上游流,内层计费监听器透传 + 外层 account 因包装层 id 跳过 → 0 记账。
   当前 modlens 实测为瀑布派发期急切发起,语义正确;出现扇出/惰性路由时需改按流实例标记。
3. **`canonicalWindowKey('2d') → weekly`** 等滚动窗量级归并为刻意近似(源码注释已声明),
   周/月估算存在窗口错配误差。
4. **客户端回退计价按「当前时刻」给全部桶定价**(非逐事件时刻):P2 修复后档位口径与
   服务端一致,但跨相位会话的回退估算仍是近似;精确金额以账本(按事件时刻计费)为准。

## 6. 回归防护

verify.mjs 新增「v1.6.9 计费审计回归」块,核心是**双端行为级漂移防护**:测试从
`src/client.js` 抽取纯计费助手区段(`priceEntryFor` → `billedInput` 与
`todayOfficialUsd`)在 Node 求值,断言:

- 子档保留(`peak/offPeak/legacyBase` 不再被剥);
- 同一价表、同一时刻下,客户端 `tierFor`/`costOfBuckets` 与服务端 `tierFor`/`costOf`
  在**四个相位**(峰时/谷时/周末全谷/峰谷时代分界前)档位与金额逐位一致;
- 峰时金额级佐证:客户端回退路径 1M 输入 = 0.44(修复前 0.22);
- `decimals=0` 双端一致;`todayOfficialUsd` 双前缀 + `llm-` 剥离;
- 服务端 `tierFor` NaN ≡ undefined;`officialCostOfDay`/`repairProviderDupes` 新语义;
- 区段定位失败(函数改名/移动)时测试显式报错,防止防护静默失效。

配套更新:8g 用例注释补充深层变体保留原因;issue #36 源哨兵更新为双前缀判定;
CI 时区炸弹断言修正(§3-CI 修复)。

`node test/verify.mjs` 全量通过(TZ=UTC / UTC-8 / UTC+14 / UTC+8 四时区);
`node scripts/build.mjs` 重建 lib/client.js(244,427 字节,DSH STORE 上限 262,144),
esbuild 0.28.1 与锁文件一致保证 CI 产物漂移门禁逐字节可复现。
