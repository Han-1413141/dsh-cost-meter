# Changelog

## [1.5.50] - 2026-08-25

### 修复

- **对话框下方本会话费用/Token 与今日会话不一致(issue #63, 感谢 @Alan0x01 报告)**:`v1.5.47` 为修复 fork 徽章全量而引入 `seedLength` 时,`lib/index.js:326` 将 `event.length`(普通会话日志总长度)无条件回退为 `seedLength`,导致非 fork 会话早期的 `seq < length` 事件被误判为种子段过滤(例: 89 次调用的会话若 `length=80`,则前 80 段被过滤,仅余少量),表现为对话框下方“本会话 ¥0.31 · 输入 9K …”远小于设置页“今日会话”(账本 `today.sessions`)与 DSH 原生行的 127K/8.3M。`v1.5.50` 改为仅显式 `seedLength` 字段生效,`length` 仅当 header 携带 `parentSession` (确认为 fork 会话)时才回退;投影 `stateVersion` `6→7` 使旧 checkpoint 全量重放自愈,`verify.mjs` 新增非 fork/ fork length 行为级断言。

## [1.5.49] - 2026-08-25

### 修复

- **官方价格币种为人民币时会话费用虚高(issue #62, 感谢 @Alan0x01 报告)**:切换为 `CNY` 并同步中文官方页后,会话标题栏/输入区徽章仍按人民币价直接计为美元,再经展示汇率 `×7.2` 放大,导致费用偏高约 7 倍。`store.account` 对 DeepSeek 主表 `CNY` 成本已正确 `÷exchangeRate` 落库为美元,而会话投影 `lib/index.js` 的 `makeCostUsageProjection` 与客户端回退路径 `lib/client.js` 的 `usageCost` 未做同口径折算。`v1.5.49` 在投影与客户端回退路径均补上 `usdFromCost` 判定(`deepseek-peak` 且 `prices.currency==='CNY'` 时 `÷exchangeRate`),使徽章与账本/预算/历史保持同一汇率往返,切换币种前后成本一致;`verify.mjs` 补充 CNY 投影单测与显示往返断言。

## [1.5.48] - 2026-08-25

### 修复

- **火山方舟 GET 用量探测优化(issue #60 反馈, 感谢 @sanqiPanax 实测)**:`GetAFPUsage` 无参即可返回 5h/weekly/monthly+daily 三窗,而 `GetUsageDetails` 裸调 400(缺 `Filter.StartTime`),原顺序 `GetUsageDetails → GetPersonalPlan → GetAFPUsage` 会先 400 再成功。`v1.5.48` 将 `VOLCENGINE_ACTIONS` 优先级调整为 `GetAFPUsage → GetUsageDetails → GetPersonalPlan`,减少一次 400 探测;同时解析器新增 `daily`/`AFPDaily` 归一(映射为 `daily` 窗口)与中文“日”兼容,未知小写窗口保留原名展示而非丢弃,避免 `AFPDaily 0%` 等窗口丢失。

## [1.5.47] - 2026-08-25

### 修复

- **fork 会话徽章仍显示全量费用(issue #61, 感谢 @csliuchi 跟进 #55 的完整根因与复现数据)**:`v1.5.43` 的 `session/end-seed` 延迟边界在种子段含多个 `end-seed`(父会话重启标记被拷贝)时,取“首个”边界导致中间种子段漏扣——父会话 256 条 usage(11309~273547)被计入子会话,徽章显示全量 ¥59/156M 而非 ~¥17/65M。`v1.5.47` 改为“取种子段内最大 end-seed、延迟至首个 own 事件再整段扣回”: `session` header 现记录 `seedLength`/`parentSession`(0.1.1-rc.2 起)并作为边界, `end-seed` 仅更新 `seedEndSeq = max` 且过滤 `time ≥ createdAt` / `seq ≥ seedLength` 的子会话自身重启标记;首个 own 事件到达时一次性扣回全量影子累计并标记 `seedDeducted`,后续 `end-seed` 忽略。`stateVersion` 5→6 触发重放自愈,旧污染投影自动修复;`stateSchema` 新增 `seedLength`/`seedDeducted`; `verify.mjs` 新增多 end-seed 延迟扣除断言与源码接线断言,原单 end-seed 用例保持兼容。

## [1.5.46] - 2026-08-25

### 新增

- **火山方舟 Volcano Ark Coding Plan 额度查询支持(issue #60, 感谢 @sanqiPanax 提交需求与参考 CCswitch 实现要点)**:作为第 9 家 Coding Plan 接入,复用管控面 OpenAPI(open.volcengineapi.com/?Action=GetUsageDetails / GetPersonalPlan / GetAFPUsage, Version=2024-01-01, service=ark, region=cn-beijing)的 AK/SK HMAC-SHA256 签名查询(非 ARK_API_KEY Bearer)——需在火山引擎控制台创建 IAM 子用户并授予 ArkReadOnlyAccess + BillingCenterReadOnlyAccess,得到 AccessKeyID/SecretAccessKey;按官方文档 [1298459](https://www.volcengine.com/docs/82379/1298459) / [2479849](https://www.volcengine.com/docs/82379/2479849) / [1390291](https://www.volcengine.com/docs/82379/1390291)实现签名与用量解析。三窗口归一化为 5h / weekly / monthly(与 Lite≈5h1200/周9000/月18000、Pro 5倍 的套餐档位对应,5h 滚动刷新、周一 00:00 重置周额、订阅月 1 日 00:00 重置月额),侧边栏/设置页/额度横条与其它 8 家同款展示与点击刷新;配置新增 accessKeyId / secretAccessKey 双字段(兼容 VOLC_ACCESSKEY/VOLC_SECRETKEY 等环境变量与 apiKey: "AK:SK" 冒号写法,凭据仅发往 open.volcengineapi.com);端点硬编码白名单与签名参数固定,新增 parseVolcengineUsage / volcengineAuthorization / normalizeVolcengineKey 纯函数与端到端 verify 覆盖(arkcli 形态/UsageDetails 数组/扁平窗口/空结果四形态,签名 determinism 与 CredentialScope 校验,配置清洗与客户端双输入框接线)。

## [1.5.45] - 2026-08-25

### 修复

- **Plan 类余额进度条方向统一(issue #57,感谢 @mumchristmas 报告)**:同时配置智谱与 MiniMax Coding Plan 时,侧边栏两张卡片的进度条填充方向相反——通用卡片(Z.ai/Anthropic/Kimi 等)按「已用」填充,MiniMax 专用卡片按「余量」(100−已用)填充,同屏并列时无法直观比较(报告案例:Z.ai 已用 18% 显示 18%,MiniMax 已用 0% 却显示满条)。数据层两家的 `percent` 本就同为已用口径,仅 MiniMax 卡片在渲染层做了 `100−` 翻转。现移除该翻转:`MiniMaxPlanCard`(侧边栏 + 设置页)与通用卡片、输入框上方额度横条、Codex 周额度卡片全部统一为「已用」方向——条越满用得越多;告警阈值同步对齐(≥80% 预警、≥100% 超支),悬停提示与收起态百分比同步改为已用口径。余量换算函数(`miniMaxRemainPct`/`miniMaxRemainLevel`)删除。verify.mjs 新增渲染口径断言(余量路径已删/阈值一致)。
- **OpenCode 目录价格漂移(issue #58,感谢 @xyzs996 的逐条实测与对表脚本)**:目录页会自己变而表里没有东西盯着——本次核对(2026-08-25 抓取 zen/go 两页,与报告者 08-24 数据逐位一致):① `gpt-5.6-sol` 于 08-19–08-24 间降价六成(≤272K 档 $5/$30/$0.50/写$6.25 → $2/$10/$0.20/写$2.50;>272K 档 $10/$45 → $4/$15,缓存读 $1→$0.40、写入 $12.50→$5),旧价高估输入 2.5×/输出 3×/缓存读 2.5×;页面注明 2026-09-18 前为五折促销价,已记入 notes。② `glm-5.3` 登上 Go 目录价目表($1.40/$4.40/$0.26,与 GLM-5.2/5.1 同价),`opencode-go.glm-5.3` 由 unpriced 改为目录价;`z-ai.glm-5.3` 维持不编造原则不变(Go 目录价不是智谱官方价)。③ 收录三个新模型:Zen 的 `muse-spark-1.2`(Meta,$1.25/$4.25/缓存读$0.15,新增 `meta` 厂商键)、Go 的 `longcat-2.0`(美团,$0.30/$1.20/$0.006,新增 `meituan` 键)与 `muse-spark-1.2-contributor`($0.10/$0.20/$0.002,notes 注明低价换训练数据授权、限地区)。Go 目录注释更新为「非 DeepSeek 的 19 个」;`docs/provider-pricing.json` 再生成并补交生成脚本 `scripts/gen-provider-pricing.mjs`;**新增 `test/check-opencode-catalog.mjs` 对表夹具**(零依赖抓取两张目录页,Endpoints 表官方名→id 映射,分档行取 ≤ 档为基线,缓存读缺省按原价折算,免费档与「页面有价、表里没有」只提示不判红;当前 69 条全对齐,退出码 0)。verify.mjs 新增 Sol 三项新价/glm-5.3 目录价/三个新模型断言。

### 新增

- **DeepSeek 充值直达 + ChatGPT(Codex)周额度显示(issue #59)**:① 官方余额行与余额图框的金额旁新增「↗」小链接,点击新开 `platform.deepseek.com/usage` 平台账单页直达充值;链接 `stopPropagation`,不会误触发图框本身的点击刷新(issue #37),中英悬停提示,收起窄栏不加(保持单图标)。② 安装了 dsh-codex-connect 插件并登录 ChatGPT 后,自动在侧边栏显示 Codex 周额度卡片并在额度横条追加 Codex chip——数据经该插件暴露的同源只读路由 `/plugins/dsh-openai-codex/auth/status` 探测(不读凭据、无需配置 Key),解析 `codex` 桶 7 天窗口的 `remainingPercent` 为已用%(与 #57 统一后的方向一致)与重置时刻;插件不在/未登录/路由 404 一律静默隐藏,探测结果模块级缓存 5 分钟,bundle 装载即做一次被动探测(其余显示全关时也能出卡片),点击卡片/chip 手动重探。宿主进程无法感知 web 端口,故由浏览器端同源 fetch 实现。verify.mjs 新增充值链接/探测模块/卡片与 chip 接线断言。

## [1.5.44] - 2026-08-24

### 修复

- **Kimi 订阅端点识别的 URL 子串匹配隐患(CodeQL alert no. 6,`js/incomplete-url-substring-sanitization`,高危)**:`queryCodingPlan` 用 `url.includes('api.kimi.com')` 判定「本次请求是否 Kimi Code 订阅端点」——子串匹配可被形如 `api.kimi.com.attacker.tld`、`not-api.kimi.com` 的主机名误命中,进而选用错误的解析器。现改用 `new URL(url).hostname` 精确等值匹配(小写归一;非法 URL 按非订阅端点处理,走该厂商默认解析器),对现有双端点(`api.kimi.com` 订阅配额 / `api.moonshot.cn` PAYG 余额)行为逐位一致,仅排除恶意相似主机名。GitHub Copilot Autofix 提交(5fc035f)原样纳入,本版补齐版本发布链(版本号/安装脚本/README/发布说明)。

## [1.5.43] - 2026-08-24

### 修复

- **fork 会话徽章仍显示全量费用(issue #55,感谢 @csliuchi 的完整根因分析)**:v1.5.34 起的投影 fork 过滤依赖在 `apply` 中收到 `event.type === 'session'` 来记录 `createdAt`,但 dsh 0.1.1-rc.1 的会话头(`createdAt`/`parentSession`/`seedLength`)从不进入投影折叠的事件流("Kept out of the event log"),`state.createdAt` 恒为 0 → 种子判定恒 false → fork 会话的「本会话」徽章把父会话拷贝段一并计入(报告案例:缓存 157M 全量 vs 自己的 ~65M)。经宿主源码确认:带种子的会话在构造时于日志末尾追加 `session/end-seed` 边界事件(seq = 种子事件数),且随日志持久化、进入 refold/restore 重放——投影改按「seq < 边界」识别种子段:单遍正序折叠中边界前的用量先照常入主聚合并同步记入影子累计(shadow),边界到达时整段扣回并清空去重基准;非 fork 会话无边界事件,行为分毫不变。`stateVersion` 4→5 触发宿主对受污染投影状态全量重放自愈。verify.mjs 新增投影行为级测试(refold/live 双路径、非 fork 不变、键复用防负数、旧宿主 createdAt 规则兼容、stateSchema/wire 三调用点 parse)。
- **第三方渠道手动指定 DeepSeek 价格显示 0(issue #56)**:设置页「手动指定价格」下拉框存 DeepSeek 目标模型时写的是裸名(如 `deepseek-v4-flash`),而映射值按「带渠道前缀为跨渠道引用、裸名为同渠道换名」解析——跨渠道映射(如 `cephalon:deepseek-v4-flash → deepseek-v4-flash`)因此去 cephalon 渠道查一个不存在的模型,查无此价金额归零。两层修复:① 下拉框现存储带前缀的值(`deepseek:deepseek-v4-flash`,与第三方目标格式一致);② 宿主与客户端解析器对「裸值 + 非 DeepSeek 渠道解析失败」回退 DeepSeek 主表再查一次(仅显式条目/归一化匹配,不吃默认兜底价,未知名字保持未定价)——存量错误配置无需手工修正即自愈,客户端未命中列表与徽章估算同口径。verify.mjs 新增 exact/auto 双模式命中、旧语义保留(裸值同渠道换名、带前缀引用)、未知裸名不误配断言。

## [1.5.42] - 2026-08-24

### 修复

- **额度横条三处缺陷(issue #52,感谢 @ProximaCentauri0 的根因分析)**:① 迷你进度条填充永远不可见——`.cm-qbar` 不是 flex 容器,内部 `.cm-qfill` 保持默认 `display:inline`,行内元素宽高被浏览器忽略且空内容行内盒零尺寸;现两处均补 `display:block`,填充按 ok/warn/over 变色真实可见。② chip 无法点击刷新——现点击任意 chip 即刷新对应数据源(budget → getState 重取、Go → Go 额度、Coding Plan 厂商 → 该家全部窗口一次刷新),复用既有 `clickableRefreshProps`(role=button/tabIndex/aria-busy/Enter+Space 键盘触发)与 busy 呼吸互斥,刷新中显示「刷新中…」,失败原因进悬停提示。③ 同一厂商多窗口占多个 chip——现按厂商分组融合为一条(如 `Z.ai [5h 条] [周条]`,竖线分隔),告警级别取所有窗口最差,悬停仍可见各窗口重置时刻与更新时间。

### 新增

- **Kimi Code 订阅配额查询(issue #53,感谢 @Angelyeye 提供已验证端点与实测实现)**:接入 Kimi CLI 实际使用的订阅接口 `GET api.kimi.com/coding/v1/usages`(404 回退 `/v1/usage`),显示本周配额与 5 小时滚动窗口的用量百分比与重置时刻;该端点校验客户端标识,请求固定 UA `KimiCLI/1.6`。凭据发现优先 `KIMI_CODING_API_KEY`(sk-kimi-* 订阅 Key,与开放平台 PAYG Key 不通用),订阅端点 401 视为无订阅 Key 自动降级到原 PAYG 余额端点(`MOONSHOT_API_KEY` / `KIMI_API_KEY`),行为与旧版一致;设置面板 Key 提示同步更新。端点非公开文档化,解析失败自动回落,README 已注明。
- **周末全谷价一致性回归夹具(issue #54,感谢 @xyzs996 提供 CC0 一致性向量)**:引入 15 条档位向量 + 3 条下一切换向量钉住周末规则——现行两个峰窗都在 16:00 UTC 前收尾,而 16:00–24:00 UTC 是北京日历与 UTC 日历唯一分歧段,若有人把 `weekendZoneAt` 的「+8h 后取日序」简化成 `getUTCDay()`,真实时段用例一条都不会红;其中 3 条走明确标注为合成的时段(峰窗 16:00–22:00 UTC,非真实厂商时段)专门暴露这条日历轴,另有生效闸边界与倒计时直达周一入峰的防回归断言。

## [1.5.41] - 2026-08-23

### 修复

- **启动期历史回填内存耗尽导致 dsh web 崩溃(issue #50,PR #51,感谢 @cftest120241104-lang 的完整根因分析与修复)**:会话日志存在解压后数百 MB 的大文件(长期会话每次追加批次写一个独立 zstd frame,实测一份 50MB / 11.5 万帧日志)且账本存在标题滞后的活跃会话时,启动后约 20 秒内 V8 堆(4GB 限制)耗尽崩溃。两层修复(PR 原样采用):① `readSessionRecords` 改为逐帧解压、逐帧按行解析(行缓冲跨帧拼接兜底),任一时刻只保留单帧结果——旧版 `frames.map(zstdDecompressSync)` + `Buffer.concat` + 全量 split/parse 把单文件峰值推到 ~3GB(11.5 万小帧的临时对象与拼接副本是主要增量),流式后峰值降至 ~1/4(实测 2969MB → 749MB,耗时 2022ms → 1713ms,解析行数一致);② 纯标题/时间戳补齐模式按缺失会话 id 定向扫描(`listSessionLogs(root, onlySessionIds)`,目录名即会话 id)——活跃会话的标题要等下次启动才写入日志,旧版只要存在一个滞后会话就每次启动全量重扫全部日志(实测 163 份),定向后扫描量 163 → 1、补齐后零扫描;日期级缺失(`needDates`)仍走全量,行为不变。两项均幂等,回填 calls 总量不变、无重复计数;`importLegacyHistory` / `repairForkSeed` 共用读取路径同步受益。verify.mjs 新增多帧 zstd 流式解析与整段明文逐位一致、定向枚举、纯标题补齐只扫目标日志与补齐后零扫描断言。

## [1.5.40] - 2026-08-22

### 新增

- **周末全谷价适配(官方通知:2026-08-23(周日)00:00 北京时间起,周六及周日全天不再区分峰谷,统一按低谷时段价格计费)**:计费侧新增「周末全谷价」区间(北京时间周六/周日日历日,生效时刻起)——周末恒按谷时档(offPeak)计费,峰窗口在周末不再生效;生效前的费用仍按原峰谷规则结算(首个受覆盖的周末仅周日全天,自 2026-08-29 起周六、周日全天均为谷价),历史账单分毫不受影响。展示侧四处时段条(展开/收起 × 简洁/经典)周末显示「周末时段——全谷价 · 倒计时」(收起态短词「周末全谷」,绿色系标识省钱档,标记线居中指向全谷轨道);倒计时直达下个工作日首个峰时段起点(周五晚 → 周一 09:00 之间不再出现虚假的「进入平价」切换提示);设置页峰谷面板状态行同步周末感知,并新增新规说明文案。verify.mjs 新增周末区间边界、窗口判定、计费档位与相位倒计时全套断言。

## [1.5.39] - 2026-08-22

### 修复

- **隐藏官方余额/今日消耗金额改为真正的 UI 隐藏(issues #45 / #46 实现方式修正,感谢 @JayWu199751 的两个建议)**:v1.5.38 的「隐藏金额(隐私模式)」把余额与费用金额打星(`$ ***`),并非两位报告者想要的——期望是开关开启后对应 UI 区块整体消失、不再显示。现已移除隐私模式遮罩,改为两个独立开关(位于 设置→显示→金额):「隐藏官方账户余额」开启后侧边栏余额行/余额进度条盒、会话页与设置页的官方余额面板整体不渲染;「隐藏今日消耗金额」开启后侧边栏今日费用行、预算盒明细与悬停提示中的今日金额行、概览页今日汇总卡片整体不渲染,token 与调用次数统计不受影响。v1.5.38 期间写入的隐私模式配置字段在升级后自动清理。

## [1.5.38] - 2026-08-22

### 修复

- **包装路由重复计费(issue #48,感谢 @aiseaai 的 byProviderModel 铁证分析)**:modlens / vision-router 等包装路由插件在自身 stream() 体内再次发起 `ctx.llm.stream()` 换上游 provider,同一次请求沿 `wrapper-vision → wrapper → official` 每层都完整走过一遍宿主 `llm/stream` 监听器瀑布,旧版计费监听器每层都把 usage 记进账本——同一次请求被记 2~3 份(报告者账本:official / modlens / modlens-vision 三行 40 次调用 token 逐位相同)。现计费包裹用 AsyncLocalStorage 深度标记识别嵌套调用:只有最外层记一次账,直连官方路由行为不变,并发请求互不误伤。升级后首次启动自动一次性清洗已被污染的账本(按「模型相同 + 六值 token 指纹逐位相同」识别重复,每组保留一份并修正日/会话合计;指纹不全同的真实调用分毫不碰)。
- **隐藏金额隐私模式(issues #45 / #46,感谢 @JayWu199751 的两个建议)**:新增「显示设置 → 隐藏金额(隐私模式)」开关,开启后全部余额与费用金额(会话费用/今日费用/历史/预算/余额进度条/汇总卡片等)统一遮罩为「$ ***」——保留币种符号与布局、不泄露数字,token 统计不受影响,适合共享屏幕与截图;服务端对账提示中的金额同步遮罩。

## [1.5.37] - 2026-08-22

### 修复

- **GLM Coding Lite 套餐(CREDIT_LIMIT)额度查询失败(issue #44,感谢 @always190515 的完整根因分析)**:Lite 套餐的 monitor 端点响应中 limits 条目为 `CREDIT_LIMIT` 类型(按 Credit 计费),与 #42 适配的 `TOKENS_LIMIT`(Pro/Max)不同,被解析器跳过导致解析为空、回落到 404 的旧计费端点,报错误导。现监控窗口映射同时接受 `CREDIT_LIMIT`——其 `percentage`/`currentValue`/`usage` 与 `unit` 语义和 `TOKENS_LIMIT` 完全一致(unit=3 → 5 小时档、unit=6 → 周档)。
- **Coding Plan 端点循环错误优先级(issue #44 建议 2)**:全部端点失败时,「200 但解析失败」的结构化错误(业务信封 / 结构已变)优先于最后端点的传输层错误(404 等)抛出,不再让兜底端点的 404 盖住主端点解析失败的真实原因。

## [1.5.36] - 2026-08-22

### 修复

- **Z.ai / 智谱 GLM Coding Plan 额度查询迁移到新监控端点(issue #42,感谢 @ProximaCentauri0 报告)**:智谱官方将额度查询接口变更为 `/api/monitor/usage/quota/limit`(国内 `open.bigmodel.cn` / 国际 `api.z.ai`),旧 `coding/paas/*/dashboard/billing/coding_plan/usage` 端点对新套餐不再返回数据。解析器新增监控端点形态:`data.limits` 中 `TOKENS_LIMIT` 条目按 `unit`(3=小时档,6=周档)分配 5 小时/每周两窗口,`unit` 缺失时按 `nextResetTime` 升序兜底(0% 用量的滚动窗口不返回重置时间,排最前),老套餐仅一条时只出 5 小时档;`TIME_LIMIT`(MCP/工具调用月度额度)量纲不同不纳入;`percentage` 缺失时用 `currentValue/usage` 反推。新端点两域优先,旧 v3/v4 计费端点保留兜底;同时修复国内/国际 Key 互通误判——两域 Key 不互通,单域 401 继续换域尝试,全部 401 才提示凭据无效(此前国内 Key 请求国际域名 401 即直接报「凭据无效」)。

## [1.5.35] - 2026-08-21

### 修复

- **「未命中模型」列表不再误报已正确计价的模型**:计费解析链(精确 → 归一化 → 宽泛包含 → 跨厂商兑底)早已能正确给路由 provider 前缀(`go:deepseek-v4-flash`、`opencode:gpt-5.6-luna` 等)按模型名命中价格,但设置页「未命中模型」列表的判定仍是裸精确键查找——provider 前缀不在价格表登记即列入,导致实际已正确计价的模型长期挂在待处理列表里。现判定走与计费完全一致的 `resolveClientPrice` 解析链(按当前匹配模式,含跨厂商兑底):已命中(含兜底命中)的模型不再列入,仅 DeepSeek 默认价兜底与完全未命中者需要人工指定;已手动指定的键仍保留在列表中便于复核/移除。双语文案同步更新。
- **外部查询硬失败不再钉死缓存、软失败不再无意义重试(PR #40,感谢 @yanzhaohui1999 的贡献与根因分析)**:四处 `ensure*`(余额/Go 额度/自定义余额/Coding Plan)此前失败时也推进 `fetchedAt`,瞬时网络错误被缓存有效期钉死,轮询一直跳过重试,只能手动刷新绕过。现区分软/硬失败:软失败(未配置 Key、非官方端点、未登录/无订阅等不会自愈的守卫错误,官方余额路径补齐 `soft` 标记)仍完整缓存避免每个周期重抛;硬失败(网络超时等临时性问题)写入 error 状态但**保留旧 `fetchedAt`**——UI 仍显示失败原因(不静默吞错、不显示陈旧成功值),且下次轮询自动重试。合并时回退了 PR 中 `.gitignore` 的 `undefined*` 行(本仓库测试不产生该目录)。

## [1.5.34] - 2026-08-21

### 修复

- **fork 出来的会话不再把父会话的历史费用重复计算(issue #38,感谢 @csliuchi 的报告与根因分析)**:DSH 的 fork 不是引用,而是把父会话事件流**整段拷贝**进子会话日志(header 带 `parentSession`/`seedLength`,拷贝事件的时间戳早于 `createdAt`);旧版对事件流无差别计数,子会话徽章与账本日合计都把父会话历史又记了一遍。三层修复:① 回放器把 `time < createdAt` 的种子事件单独聚合(状态机与旧版逐字一致,仅聚合目标分段路由),不再计入导入/回填;② 一次性账本清洗(账本 `migrations` 标记防重跑)按种子聚合从已污染的会话条目与日合计中精确扣除,父会话真身条目与普通会话分毫不碰;③ `costUsage` 投影 stateVersion 3→4 记录 `createdAt` 并跳过种子事件,宿主重放自动自愈。verify.mjs 新增 fork 种子去重全套断言(双段路由/跨段键复用替换语义/污染账本清洗/父会话与普通会话不动)。
- **dsh 0.1.1-rc.1 下输入区下方的会话费用不再显示(PR #39,感谢 @aaronlei 的贡献)**:DSH 0.1.1-rc.1 起,会话投影需声明 `wire`(viewSchema + view)才会向客户端推送——无 `wire` 的投影在快照(snapshot)、变更推送(onChanged)与历史重放(refold)中全部被跳过,导致客户端 `useProjection('costUsage')` 恒为空,会话费用随用量为 0 隐藏。现为 `costUsage` 投影补充 `wire` 并同时声明新契约的 `stateSchema`(持久化恢复路径 `restore()` 会调用 `stateSchema.parse` 且无容错,缺省会在 checkpoint 恢复时抛 TypeError);旧字段 `schema` + `view` 保留,dsh 0.1.0 及更早宿主不受影响;新旧 view 复用同一实现,取值逻辑不漂移。verify.mjs 新增投影 wire 双兼容结构断言。

## [1.5.33] - 2026-08-21

### 修复

- **点击刷新引导卡刷新后不再重现**:「知道了」的已读标记此前只存于配置(balance.clickHintSeen),经 RPC 链路往返;当服务端/网关与客户端版本错位(如 dev link 模式下 dsh web 未重启,网关仍按旧版 typert schema 解码),decode 的 zod parse 会剥离 schema 未声明的键——v1.5.32 新增的 clickHintSeen 在到达浏览器前被剥掉,配置标记虽已成功落盘、客户端却永远读不到,导致引导卡每次刷新后重现。现已读标记改为**双通道**:配置标记(跨设备) + localStorage 本地兜底(读经 useState 惰性初始化、写先于 RPC 且不受其成败影响,隐私模式 try-catch 静默),任一生效即不再打扰。重启 dsh web 使服务端 schema 对齐后,配置标记通道亦恢复正常。

## [1.5.32] - 2026-08-21

### 新增

- **点击余额图框立即刷新(issue #37,感谢 @hi-wenw 的报告)**:侧边栏的官方余额 / 自定义余额 / Coding Plan 额度图框(含窄栏收起态)现可点击,立即触发一次对应查询,无需等待自动刷新间隔或进入设置页;刷新中图框呼吸闪烁并标记 aria-busy,失败时保持原值、失败原因进入悬停提示,刷新中忽略连点防并发;键盘 Enter/Space 同样可触发,悬停提示固定附带「点击立即刷新」说明行。更新后首次进入时弹非模态引导卡告知此功能(仅当侧边栏确有可点击图框时展示,「知道了」永久消失)。verify.mjs 新增配置标记 / 六类图框接线 / 防连点 / a11y / 引导卡断言,并扩展 Hook 顺序门禁识别自定义 Hook。
- **DeepSeek-V4-Flash-Vision-Exp 计价适配**:新模型与 deepseek-v4-flash 同价(谷时 $0.007/$0.22/$0.66、峰时 $0.014/$0.44/$1.32,基础档 = 谷时档),内置价格表、设置页价格目录(DeepSeek v4 家族)与模型名自动匹配同步支持;峰谷时代后发布,无历史基础价档(legacyBase),分界前时刻回退基础档。存量配置经 sanitize 自动补齐新条目,升级用户无需手动操作。README.en.md 宣传图换用英文版(docs/promo.en.png)。

### 修复

- **峰/谷切换的浏览器(系统)通知不再连发**:旧实现的防重是「上次通知时的 tick 时间戳 === 本次 tick 时间戳」,而组件每 10 秒 tick 一次,比较永远不相等等于没有去重——提前量窗口内(默认 2 分钟)每 10 秒弹出一条,最多可达 12 条。现改为按切换点时刻在模块级去重,同一切换点只发一次;配置变化导致提醒组件重挂载后(组件内状态会归零)也不会重发。弹窗本体(手动关闭)本就按切换点去重,不受影响。
- **余额点击刷新引导卡「知道了」体验加固**:引导卡与额度横条首次引导卡同为屏幕顶部 fixed 卡片,旧版可同屏重叠(点掉一张露出另一张,像「点了没反应」),现改为串行展示(横条引导处理完再出现);「知道了」点击后乐观立即消失(RPC 落盘失败才恢复),彻底规避宿主渲染时序导致的延迟;点击引导的 RPC 往返(含网关 JSON 安全校验与持久化读回)已 e2e 验证。

## [1.5.31] - 2026-08-21

### 修复

- **官方余额进度条「当日已用」不再混入 Coding Plan / 自定义 Provider 的费用(issue #36,感谢 @hi-wenw 的报告)**:三段进度条的「当日已用」此前取整本账本当日合计(全渠道),订阅/自定义渠道的消耗也被算进官方余额条,与开放平台实际扣款不一致。现官方余额条只统计会扣 DeepSeek 开放平台余额的调用(账本 byProviderModel 中 `deepseek:` 前缀条目,含未标注 provider 的历史调用),Plan / 自定义 Provider 的消耗只体现在各自的额度条上;同一根因的余额差对账(issue #18 ⚠ 提示)同步改为只对官方渠道费用,订阅用户不再恒报「偏差较大」,提示文案同步改准确。旧账本无按渠道拆分的数据退回全量保持既有行为。verify.mjs 新增官方渠道费用拆分单测(纯函数/Ledger 聚合/对账与进度条接线/模型名含冒号的键不误命中/旧数据退回)。

## [1.5.30] - 2026-08-21

### 新增

- **自定义 Provider 余额 extract 规则新增 `divide` 除法运算(PR #34,感谢 @CialloAlone 的贡献)**:此前 extract 只支持点路径、数字常量与 add/subtract,无法表达 NewApi 等以 quota 整数计量的端点(1 USD = 500000 quota,需 `total_available / 500000` 才能得到美元)。现支持 `{ "op": "divide", "path": "data.total_available", "by": 500000 }` 按 `by` 除数缩放;路径缺失 / 除数为 0 / 缺除数 / 目标非数字时返回 null(与 add/subtract 的非法路径行为一致)。README(中/英)新增 NewApi 模板完整配置示例,verify.mjs 新增 divide 换算与边界单测。

## [1.5.29] - 2026-08-20

### 新增

- **Coding Plan 各家「刷新间隔(分钟)」设置控件(issue #33,感谢 @hi-wenw 的报告)**:`codingPlans.<id>.refreshMinutes` 此前只有后端缓存语义(默认 15 分钟,`ensureCodingPlan` 按其过期),设置页没有控件,只能手改账本。现每家 Coding Plan 配置区(启用后、显示位置与 Key 之间)新增「刷新间隔(分钟)」数字输入,合法范围 1-1440(客户端与服务端双重钳制,与官方余额 / Go 额度 / 自定义余额同款),保存后立即生效;SCNet 为本地计量(每次状态组装随账本重算,无缓存间隔),不渲染该控件。verify.mjs 新增控件结构断言(双语文案/写回/钳制/SCNet 排除)与 sanitizeConfig 上限收敛断言。

## [1.5.28] - 2026-08-20

### 修复

- **首次额度横条引导点击后触发 React #300(issue #32,感谢 @kk3ya03-star 的报告与根因分析)**:`QuotaStripGuide` 的 `useRef` 位于两个条件 `return null` 之后,当 `promptSeen` 从 `false` 翻为 `true`(点击「开启/暂不」)时,下一次渲染在 `useRef` 前提前返回,Hook 数量比上一次少一个,触发 React #300「Rendered fewer hooks than expected」,sidebar footer 被 React 错误恢复流程重新挂载。修复:把 `useRef` 上移到所有条件返回之前,与 `useCost` 一起构成每次渲染固定的 Hook 序列。
- **verify.mjs 新增 Hook 顺序门禁**:扫描 `client.js` 全部组件函数,断言任何 Hook 调用不得出现在组件级条件 `return` 之后(箭头函数回调体内的 return/Hook 不计入);门禁自带自检(违规片段必须被抓到、合法片段不误报),并对 `QuotaStripGuide` 的 `useRef` 先于首个 `return null` 做定点断言,防止同类回归。

## [1.5.27] - 2026-08-20

### 新增

- **输入框上方额度横条**:挂在宿主 `conversation.input.dock` 插槽(渲染于输入卡片上方),以一条横排 chips 实时显示**预算已用%**(预算图框同口径:周期+汇率)、**OpenCode Go 主窗口**(与右下角 chips 主窗口口径一致)与**各已启用且查询成功 Coding Plan 的前两个百分比窗口**(厂商短标签:Claude / Z.ai / MM / Kimi / OR / SF / CC / SCNet);每片「短标签 + 44px 迷你进度条 + 百分比」,≥80% 预警、≥100% 超支着色,悬停 tooltip 见全部窗口、重置时刻与更新时间;无可用数据时整条自动隐藏。配置 `quotaStrip`(enabled/budget/go/plans/promptSeen 五布尔)默认关闭。
- **首次更新引导**:`promptSeen` 未标记时弹一张非模态小卡片(屏幕顶部居中,常驻 `sidebar.footer.action` 插槽挂载,与仅会话页渲染的 dock 插槽无关),由用户自主选择「开启横条 / 暂不开启」,任一选择写回 `promptSeen: true` 永久消失;设置页显示标签新增「输入框上方额度横条」分组(总开关 + 预算/Go/Coding Plan 三项内容开关 + 说明),在设置页改动同样标记 `promptSeen`。
- 双端接线:store.js 默认配置/校验(vmsg 双语)/清洗收敛、typert.host.js configSchema 五布尔声明、client parseConfig 归一;verify.mjs 新增默认值/部分补丁/非法拒绝/清洗/结构接线断言(含语法门禁 vm 编译覆盖)。

## [1.5.26] - 2026-08-20

### 新增

- **Coding Plan 额度侧边栏显示**(issue #31,感谢 @zhaoyun-plus 的建议):每家 provider 新增「显示位置」配置(主页面侧边栏 / 设置页 / 两者 / 关闭,默认设置页),选侧边栏/两者后该厂商额度以图框卡片常驻侧边栏——与 Go 额度/余额同款样式,每窗口一行进度条(余额等文本窗口整行文本),≥80% 预警、≥100% 超支着色,悬停 tooltip 见全部窗口、重置时刻与更新时间;侧边栏收起(rail)窄栏显示前两档百分比;MiniMax 沿用专用 5h/7d 余量卡片,其余七家走通用卡片。设置入口:额度标签 → Coding Plan → 各家行内「显示位置」下拉。
- **一次性配置迁移**:v1.5.26 前 MiniMax「启用即在侧边栏展示卡片」而无显示位置 UI(存量配置 display 恒为 schema 默认 'settings',非用户选择);升级后由账本根 `migrations` 标记(只跑一次,不覆盖用户后续显式选择)把启用态 MiniMax 迁移为「两者」,保持旧版侧边栏行为不回归;新装默认 MiniMax「两者」、其余厂商「设置页」。verify.mjs 新增迁移 e2e(标记幂等/落盘/用户选择优先)与 display 配置断言、客户端结构断言(display 门控/通用卡片/双语文案/设置页下拉)。

## [1.5.25] - 2026-08-20

### 新增

- **CommandCode(commandcode.ai)接入为第 8 家 Coding Plan**(issue #30,感谢 @zhaoyun-plus 的报告与端点调研):官方 billing credits 端点(`GET api.commandcode.ai/alpha/billing/credits`,硬编码白名单)查询 **5 小时/周窗口用量%**(used/cap,进度条 + epoch 毫秒重置时刻)与**月度 Credits 余额文本**(1 credit ≈ $1,与 Kimi/SiliconFlow 余额同形态);凭据走通用发现链(面板 Key → DSH 凭据库 `COMMANDCODE_API_KEY` → 环境变量),无订阅为中性软提示。解析器容错:非法窗口(cap≤0/负 used)剔除、未知窗口名透传、零余额仍展示;verify.mjs 新增解析器单测、域名白名单与凭据 env 断言。

## [1.5.24] - 2026-08-19

### 修复

- **v1.5.23 导致插件整体加载失败(紧急修复)**:1.5.23 的标签页改造在 `client.js` 引入两处括号缺失(「用量」标签的历史数据分组、「价格」标签的官方价格同步区块各少一个闭合括号),浏览器端 bundle 存在语法错误无法解析——classic `<script>` 语法错误仍触发 load 事件、脚本却不执行,宿主只报 `client-modules: bundle ... loaded without registering "dsh-cost-meter" via __ModuleLoader__.load`,表现为 HARNESS「Failed to load plugins」、费用徽章/侧边栏/设置分节全部消失。**1.5.23 用户请立即升级**;配置与账本数据不受影响。
- **verify.mjs 新增浏览器端 bundle 语法门禁**:`client.js` 只在浏览器执行,此前测试套件仅做字符串断言、从不解析该文件,语法错误因此溜到线上。现以 `vm.Script` 整份编译(只编译不执行),任何语法错误在验证阶段当场失败。

## [1.5.23] - 2026-08-20

### 变更

- **设置页改为标签页分区(issue #29)**:费用设置此前所有分区(汇总卡片、今日会话、预算、官方余额、Go 额度、Coding Plan、自定义余额、用量热图、按模型统计、历史、会话排行、价格表、模型匹配、拓展目录、峰谷计价、显示选项)自上而下排成一整页,配置项越加越多、滚动定位困难。现拆为五个标签:**概览**(汇总卡片/今日会话/预算/官方余额)、**额度**(Go 订阅/Coding Plan/自定义 Provider)、**用量**(热图/按模型/历史/会话排行/历史数据导入与清除)、**价格**(峰谷计价/价格表/模型名匹配/拓展价格表/官方价格同步)、**显示**(语言/徽章与侧边栏位置/货币与角标等显示选项);标签栏带 tablist/tab role 与 aria-selected,默认落在概览。
- **自动保存状态与操作提示全局化**:「已自动保存」徽章移到标签栏右侧常驻(在任意标签页改动配置都能看到保存反馈),价格同步/历史导入/清除历史的结果提示也不再随触发按钮所在标签页隐藏。
- 分组细节:价格表默认折叠(三角展开)保持价格标签简洁;「导入安装前历史」「清除全部历史」收进用量标签的「历史数据」分组;Go 额度/各 Coding Plan/自定义余额的**查询配置**(Key、刷新间隔、窗口)留在额度标签各面板内,**显示位置开关**仍在显示标签,配置模型与自动保存逻辑不变(仅切可见分区)。

## [1.5.22] - 2026-08-20

### 修复

- **Go 订阅额度面板偶发 `fetch failed`(issue #28)**:`opencode.ai/zen/go/v1/usage` 部署在 Cloudflare 之后会**间歇性重置连接**(ECONNRESET,单次失败率可高达 30%~70%),此前 `queryGoQuota` 单次 fetch 无重试,瞬断错误直接透传到面板。新增统一网络封装 `lib/net.js`:仅对**瞬时网络错误**(ECONNRESET/ECONNREFUSED/ETIMEDOUT/EAI_AGAIN/undici 超时码等,以及无具体 code 的纯 `fetch failed`)自动重试——默认共 4 次尝试、指数退避 300/600/1200ms;有具体 `cause.code` 但不在白名单(如证书错误)不重试;**每次尝试新建超时信号**(复用已中止的 AbortSignal.timeout 会让重试形同虚设)。401/403 等业务状态与解析错误不重试,`goQuotaNoSub`/`goQuotaHttp` 软提示语义不变。
- **同一封装应用于全部对外请求**:官方余额(queryBalance)、官方定价页抓取(fetchPricingHtml)、coding plan 额度(单端点先重试、仍失败再换端点变体)、自定义 Provider 余额(body 为字符串可安全重放)——同类 Cloudflare/网关瞬断一律自愈。

## [1.5.21] - 2026-08-19

### 修复

- **设置页「预览弹窗」按钮点了没反应**(1.5.20 引入):弹窗组件此前挂在 `conversation.composer.dock` 插槽——该插槽**仅在有活跃会话的页面渲染**(宿主源码 `footer: !hero && zone !== void 0 ? renderSlot(...)`),在 hero/欢迎页与设置页组件未挂载、`window.cmPeakAlertPreview` 未注册,按钮可选链静默跳过。现改挂常驻的 `sidebar.footer.action` 插槽(fixed 定位弹窗与宿主位置无关),并顺带修复**真实提醒在无会话页面不弹**的同源缺陷;`window.cmPeakAlertPreview` API 挪到插件 activate 顶层注册(不依赖插槽),组件挂载期间置 `__cmPeakAlertLive` 在线标志,未挂载时 API 输出可诊断的 console 提示;预览脚本 `ready()` 同步改为校验在线标志,版本提示更新为 ≥ 1.5.21。

## [1.5.20] - 2026-08-19

### 新增

- **峰/谷弹窗一键预览(真实组件)**:设置页「峰谷计价与提示」面板新增**预览弹窗**按钮(预览 进入峰 / 预览 进入谷),直接调用真实 PeakAlert 组件渲染——文案语言跟随插件语言设置、位置跟随弹窗位置配置、系统通知遵循 Web 通知开关与浏览器授权(标题带「(预览)」标记),与实际触发时完全一致;提醒开关关闭时也可预览(组件改为仅由峰谷计价开关控制挂载);同时暴露 `window.cmPeakAlertPreview('peak'|'offpeak')` 控制台 API。
- `scripts/peak-alert-preview.js` 重写为真实组件触发器(此前为易漂移的复刻版、仅中文文案):插件 ≥ 1.5.20 时经真实 API 预览,未就绪时提示升级。

### 变更

- PeakAlert 渲染路径重构:真实触发窗口优先,预览请求兜底(虚拟 2 分钟倒计时),预览关闭不影响真实提醒记点。

## [1.5.19] - 2026-08-19

### 文档

- **README×2 简介行补上峰/谷切换提醒**:中英简介此前只提"峰谷计价时段显示",现补齐"切换前弹窗与系统通知提醒(位置/提前量/提醒类型可配)";顺带把 Coding Plan 列表从旧的"六家(无 SCNet)"更正为七家(与 1.5.13 起 package.json 描述一致)。
- **package.json `description`(npm/插件 about)与 `dshhub.summary`(插件市场副标题)同步补上该功能**,中英双份。

## [1.5.18] - 2026-08-19

### 修复

- **开启系统通知开关在旧版 Safari 可能抛错**:`Notification.requestPermission()` 在旧 Safari 不返回 Promise,直接 `.catch` 会 TypeError;现以 `Promise.resolve(...)` 包裹,拒绝时静默。
- **清理 PeakAlert 遗留死代码**(1.5.17 开发过程中废弃的游离快照变量,无功能影响)。

### 验证

`scripts/peak-alert-preview.js` 已在真实浏览器(含 dsh 主题令牌的页面)逐项实测:控制条注入、进入峰(琥珀边条+徽标)右下角弹窗、切换位置后进入谷(蓝边条)屏幕中心弹窗、「知道了」关闭、「清除全部」清理,全部通过、无控制台报错。若升级后仍看不到新样式/居中/系统通知设置,请先重跑 install.ps1 并重启 dsh web 确认版本 ≥ 1.5.17。

## [1.5.17] - 2026-08-19

### 变更

- **峰/谷切换弹窗改为原生 dsh 提醒风格**:全屏色条徽标弹窗(进入峰琥珀警示色 / 进入谷信息蓝 + 圆点状态徽标),圆角/阴影/动效对齐 dsh 设计 token;弹窗位置可选**右下角 / 屏幕中心**(新增 `peakAlertPosition`,默认右下角),同步更新 `scripts/peak-alert-preview.js` 预览脚本(支持切换峰/谷与位置)。
- **新增浏览器(系统)通知提醒**(`peakAlertWebNotify`,默认关):弹窗触发的同时利用 Web Notification API 向系统发送一条通知(标题/正文与弹窗一致),页面最小化或切走后仍能收到提醒;开启时若权限未授权会在设置页通过用户手势申请地址栏通知权限,每切换点只发一次。

### 配置

新增 `peakAlertPosition`(corner/center)与 `peakAlertWebNotify`(布尔)两字段,全链路(默认值/校验/清洗/typert 声明/客户端解析)同步,设置页峰谷计价面板新增弹窗位置选择与系统通知开关;verify.mjs 新增默认值/校验/清洗与组件接线断言。

## [1.5.16] - 2026-08-19

### 新增

- **峰/谷切换前弹窗提醒**:距下次峰/谷档位切换不足设定提前量(默认 2 分钟)时,右下角弹出全局浮层(进入峰橙色 / 进入谷品牌色边条,含切换倒计时与「知道了」按钮);提醒类型可选**进入峰时 / 进入谷时 / 峰和谷**(默认峰和谷),提前量 1-30 分钟可配,同一切换点只提醒一次(手动关闭即记点,切换完成后浮层自然消失),峰谷计价未生效或切换提醒关闭时不打扰。设置项位于设置页「峰谷计价与提示」面板内(峰谷时段条样式旁):开关、提前分钟数、提醒类型三项;配置链(默认值/校验/清洗/typert 声明/客户端解析)全同步,verify.mjs 新增配置链与组件接线断言。

## [1.5.15] - 2026-08-19

### 变更

- **安装前历史改为首次启动自动导入**(issue #27 跟进):不再需要手动点按钮——安装/升级后的首次启动会在按模型回填完成后自动导入一次安装前历史(同样的幂等规则:缺失日期整日重建、已有日期只补未知会话、绝不与实时计费重复),并在配置中打标 `legacyAutoImportedAt` 保证只跑一次(空结果同样打标,避免每次启动重扫);后续启动只做常规回填。设置页「数据与同步」保留手动重跑入口(如后续拷入了旧日志),说明文案同步更新。启动逻辑抽为可测的 `runStartupImports()`;verify.mjs 新增 e2e:首次启动导入/打标、后续启动跳过、标记随配置补丁保真、apply 定时器接线断言。

## [1.5.14] - 2026-08-19

### 新增

- **导入安装前历史**(issue #27):设置页「数据与同步」新增「导入安装前历史」按钮(带确认),一键回放宿主全部会话日志(`$DSH_HOME/sessions`,明文/zstd 双格式),把**未装插件时期**的对话导入账本——dsh 原生日志完整记录了每次调用的 provider/model 与 token 用量,数据一直在磁盘上,本功能把它变成费用条目。规则(幂等,绝不与实时计费重复计数):缺失日期(账本无条目或为无用量空日)整日重建(合计 + 会话明细含标题/创建时间 + 按模型拆分);已有日期只追加账本完全未知的会话(安装前活跃、安装后未再用的「幽灵会话」),既有会话条目与合计结构绝不动;金额按事件时刻计价(峰谷分界前自动落 legacyBase 历史价);导入后日期键升序重排,重复点击无新增。已知局限(界面注明):历史价格按当前价目表回推,厂商中途调价会有偏差;已清理的日志无法回放;同一会话跨安装时刻时其安装前用量不计入(实时条目已存在,无法安全拆分)。新增 `costMeter.importLegacyHistory()` RPC(服务端 + typert 清单 + 客户端 descriptor 三侧同步,strict codec);verify.mjs 新增单测(缺失日期重建/未知会话追加/已知会话不动/幂等/升序)与真实 `apply()` 路径 e2e(RPC/明细拉取/幂等/网关 JSON 安全/双端清单断言)。

## [1.5.13] - 2026-08-19

### 新增

- **SCNet 超算互联网 Token Plan 本地 Credits 计量**(issue #26):SCNet Token Plan 为 Credits 包月订阅(基础 60,000 / 标准 240,000 / 高级 600,000),平台仅有 `sk-tp-` 专属推理端点、额度用量只在控制台可见,**无 API-Key 化额度查询端点**——插件按**官方 Credits 抵扣表**(2026-08-11 生效)对本地账本当前计费周期的用量折算 Credits(未命中输入 = input+cacheWrite、命中缓存输入 = cacheRead、输出 = output;覆盖 GLM-5.x / DeepSeek-V4 / Kimi-K2.x/K3 / MiniMax-M2.x/M3 / Qwen3.8-max 等主力量型,模型名归一化匹配、跨 provider 归并)。Coding Plan 面板新增 SCNet 卡片:月度已用% 进度条 + 「已用 / 总额 Credits(est.)」文本;计费周期自「订阅起始日」(可配 `YYYY-MM-DD`,月末日期自动钳制)每月重置,留空按自然月;**无需任何凭据、不走网络**(端点白名单为空数组),本地纯函数同步重算随账本实时更新,实际消耗以控制台账单为准,抵扣表未覆盖的模型不计入。verify.mjs 新增抵扣表碰撞/折算数学/周期推进(含月末钳制与跨年)/跨 provider 归并/非法额度拒绝单测与真实 `apply()` 路径 e2e(getState 快照、refreshCodingPlan 幂等、网关 JSON 安全、planCredits 配置保真)。

## [1.5.12] - 2026-08-19

### 修复

- **按会话统计面板「会话排行加载失败」(真正根因)**:Typert 网关对 RPC **返回值**做 JSON 安全校验,含 `undefined` 值的自有属性会以 `undefined is not JSON-safe` 被拒(RPC result-invalid)。而 `getTopSessions` 组装行时对未命名会话/无时间戳(旧账本)会话写入 `title: undefined` / `at: undefined` 键——zod 会原样保留已声明 optional 键的 undefined 值,因此排行内只要混入任一未命名或无时间戳会话,整个面板即加载失败。现改为**缺席时完全不写该键**(条件添加);`buildState` 的 codec 漂移降级路径同步改为解构剔除 `priceCatalog`(原 `priceCatalog: undefined` 同样会被网关拒绝)。verify.mjs 固化三层回归:网关 `assertJsonValue` 逐字复刻校验全部 RPC 返回值、真实 `apply()` 路径含未命名/无时间戳会话的四种排序、网关 `assertExactArguments` 复刻的参数校验。

## [1.5.11] - 2026-08-19

### 修复

- **多币种账号余额显示 ¥0.00 / 0.00**(issues #24 #25,感谢 @chentianhai4、@yupengliuCU 的报告与定位):官方余额接口对多币种账号返回 CNY/USD 两条 `balance_infos` 且**排列顺序每次请求不稳定**,旧代码固定取首条——USD 排前时读到 `total_balance = 0`,余额在正确值与 0 之间跳变。现按「有余额优先、同有余额优先 CNY(开放平台主币种)、全为零时优先 CNY、兜底首条」确定性挑选(单币种账号行为不变;仅 USD 有余额的国际账号选 USD)。
- **余额差对账误报 ⚠**(issue #25 附带影响):选中条目币种切换(或升级前账本的旧参考点无币种标记)时金额不可比,原逻辑会把 USD 0.00 误读算成近百元「余额差」触发 drift;现参考点记录币种,币种不一致即静默重置基准,不对账不告警。
- **按会话统计面板「会话排行加载失败」**:Typert 网关对 RPC `args` 字段做精确匹配,`getTopSessions` 的 `sort`/`dir` 参数有函数默认值却未在清单声明 `acceptsUndefined`——浏览器端缓存旧版 client.js(单参数调用)或宿主进程滞后时,RPC 以 `missing "sort"/"dir"` 被网关拒绝,面板直接加载失败;现两端清单均声明可缺省,单参数调用回落默认 cost-desc,verify.mjs 新增清单断言与真实 `apply()` 路径的单参数/各排序模式回归。

## [1.5.10] - 2026-08-18

### 修复

- **按会话排行不显示会话名称**:`getTopSessions` 组装行数据时遗漏透传 `title` 字段(账本里已有标题但排行面板全回落成短 ID,连带「附显会话 ID」开关看似无效);已修复,同时透传会话时间戳 `at`(实时入账与回填双通道补齐,会话日志 `createdAt` 为权威来源)。

### 新增

- **按会话排行排序可切换**:费用 高→低 / 低→高、时间 新→旧 / 旧→新、实时顺序(账本/侧边栏顺序),服务端排序后再截取条数(不同排序的 Top N 语义正确);`getTopSessions` 扩为三参数(limit/sort/dir),typert 清单与客户端 descriptor 同步。
- **历史记录改为三角折叠面板**(默认收起),与按模型统计/按会话统计/价格表风格统一;日期行的会话明细展开保留。
- verify.mjs 新增排序语义(费用升降/时间降/实时顺序/title 与 at 透传)、回放捕获 createdAt、纯标题通道补 at、schema 断言。

## [1.5.9] - 2026-08-18

### 新增

- **会话名称显示与会话 ID 可选附显**:历史回填新增标题补齐通道——从会话日志的 `session/title` 事件提取每个会话的名称(同名多次取最后一次)写入账本会话条目,含「无回填需求但缺标题」的纯标题通道(实时新建会话下次启动补齐);三处会话列表(今日会话 / 历史各天展开明细 / 按会话排行)改为**标题为主行**(超出省略、悬停看完整标题与 ID),未命名会话回落显示短 ID;新增配置 `showSessionId`(默认关,显示设置 → 通用 可勾选附显等宽短 ID);verify.mjs 新增标题补齐/幂等/纯标题通道/配置链/schema 回归。

## [1.5.8] - 2026-08-18

### 新增

- **历史各天的会话明细**(issue #22,感谢 @JokerQyou 的建议):历史记录表的日期行可点击展开,按需拉取当日各会话的调用次数 / token / 费用(与「今日会话」同口径);新增 `costMeter.getDaySessions(date)` RPC(服务端 + typert 清单 + 客户端 descriptor 三侧同步,strict codec),展开才拉取并缓存,不在 state 中预载避免膨胀;无会话明细的日期(早期数据/日志已清理)给出明确提示。
- **按会话统计(不分日期视角)**(issue #22):设置页新增「按会话统计(全部历史)」折叠面板(默认收起),跨全部日期按费用降序展示会话排行(每条带所属日期,可选 50/100/200 条),展开时按需拉取;新增 `costMeter.getTopSessions(limit)` RPC(同上三侧同步,服务端限制 1-500 条);verify.mjs 新增清单断言、copyDay/history 保真与排行语义回归。

## [1.5.7] - 2026-08-18

### 修复

- **MiniMax Token Plan `model_remains` 未解析**(1.5.6 仍失败,follow-up of issue #20):现行接口返回 `{ model_remains: [{ model_name: "general"|"video", current_interval_remaining_percent, current_weekly_remaining_percent, ... }] }`,`total_count` 常为 0。1.5.6 只认根上平铺字段,旧计数路径又跳过 total=0,因而报「未解析出用量窗口」。现优先取 `general` 一行抽出 5h/7d 余量(`status=3` 无限量窗如 video 不展示),平铺/旧数组/旧计数形态仍兼容。

### 变更

- **MiniMax 额度条改为一框两条**:侧边栏与设置页用同一个大框展示 **MiniMax Plan** 标题 + **5h / 7d** 两条余量进度条(小标题在条左侧,百分比在右侧),不再按模型各画一框;重置时间改为悬停 tooltip。
- **图框标题字重统一**:官方余额、自定义余额与 MiniMax Plan 标题均为 12px / 600。

## [1.5.6] - 2026-08-18

### 修复

- **MiniMax Token Plan 额度「未解析出用量窗口」**(issue #20,感谢 @hi-wenw 的报告):接口现行响应为平铺结构(根节点或 `data.data` 直含 `current_interval_*` 5小时窗与 `current_weekly_*` 周窗字段、无窗口数组),旧解析器只认数组形态;修复:平铺形态优先(计数推导→剩余百分比反推,`*_remaining_percent` 为剩余口径、`status=3` 不限量窗不展示),旧数组/计数形态保留兜底(对照 OpenClaw 同端点实现);verify.mjs 新增 7 组断言。

## [1.5.5] - 2026-08-18

### 新增

- **余额差交叉对账**(issue #18 讨论,感谢 @Fantasymax 的设计建议):每日首次余额拉取打基准,之后用「官方余额当日变动」反推消费与本地账本今日合计比对,偏差超阈值(max($0.30, 15%))时展示对账提示(侧边栏余额 tooltip + ⚠、设置页余额面板警告行);充值/授信变动自动重置基准防误判;订阅/Coding Plan 消费不动官方余额时静默不对账(故不采用余额差替代今日费用的方案);开关 `balance.reconcile`(默认开启);基准随账本落盘、跨重启续对;verify.mjs 新增 8 组断言。

### 修复

- **Coding Plan 「刷新」报 `refreshCodingPlan is not a function`**(issue #16,感谢 @Hchunjun 的精准诊断):客户端 CONTRIBUTION descriptor 漏注册该方法,已补齐(含 provider 参数 strict codec);verify.mjs 新增「客户端 descriptor 与服务端 typert 清单逐方法对齐」静态回归断言。
- **Z.ai / 智谱 GLM 额度查询 404**(issue #17,感谢 @Hchunjun 的报告与排查):接口已变更——带有效 Key 请求 v4 返 404、v3 存活;端点改为 z.ai / bigmodel.cn 双域 v3 优先、v4 保留兑底;非 2xx 错误信息带上实际请求 URL;200 但业务失败(如 `{code:1001,msg:...}` 错误信封)时透出服务端 msg;verify.mjs 新增双域白名单 + v3 优先断言。
- **订阅制模型被模糊匹配到同家族付费价导致费用虚增**(issue #18,感谢 @Fantasymax 的报告与高质量排查):模型名去后缀曾把裸数字后缀当版本后缀剥离(`glm-5.3`/`glm-5.2` 都退化成 `glm` 而互配),免费 GLM Coding Plan 调用被按 glm-5.2 单价实时记账;修复:仅剥带 v 的版本后缀(-v2),模型名本体的数字后缀(-5.3)保留;家族相似匹配在分歧位两侧均为数字 token 时也拒绝匹配(pricing.js/client.js 双实现同步);verify.mjs 新增跨版本误配/前缀式家族匹配回归。
- **历史回填对回放完整覆盖的日期重算金额**(issue #18):某日调用与 token 能被会话日志完整回放时,按事件时刻正确价重算当日总额与会话金额,修正旧版本误计费造成的历史虚高;`deepseek:legacy` 差额桶仅保留部分覆盖的差额,客户端文案改为「未分模型(早期数据 · 按当时记录计费)」;verify.mjs 新增完整覆盖重算回归。
- **自定义余额 headers 值类型防击穿**(代码审查发现):`customBalance.request.headers` 值非字符串时写入拒绝、加载剔除(此前会击穿 strict configSchema 导致所有 RPC 被拒、「账本不可用」);客户端 Headers JSON 输入同步前置校验;verify.mjs 新增回归。
- **自定义余额刷新按钮门控改用服务端已保存配置**:修复刚勾选启用未过防抖保存时点刷新被拒的时序错位。
- **`extract` 规则 `subtract` 空 paths 防 TypeError**(返回 null 而非抛 Reduce of empty array)。
- **历史回填改为异步分片**:每 8 份会话日志让出一次事件循环,会话多的用户启动后不再被同步卡住数秒。

### 其他

- **补齐 GitHub 社区标准文件**:新增 CODE_OF_CONDUCT(Contributor Covenant 2.1)、CONTRIBUTING(含本项目的 strict codec / descriptor 对齐 / 发布产物 / 双语等集成坑位清单)、SECURITY(私有漏洞报告通道)、Issue 表单模板(bug/feature)与 PR 模板(自检清单)。

## [1.5.4] - 2026-08-18

### 新增

- **自定义 Provider 余额查询**(社区 PR by @hi-wenw):可配置 HTTP 请求 URL / Headers / 声明式 `extract` 规则查询第三方余额(凭证占位符 `{{ENV_VAR}}` 从 DSH 凭据库或环境变量解析);设置页可编辑中/英名称、币种(USD/CNY/EUR)、显示位置与刷新间隔;服务端 `refreshCustomBalance` RPC + strict config/state codec 全链路。
- **余额三段进度条(全局)**(社区 PR by @hi-wenw):`balance.showProgressBar` 开启后,官方余额与自定义余额在侧边栏均以预算图框同款进度条展示(蓝=剩余余额,橙=当日已用,灰=历史已用);可选 `balance.budgetCap` 手动额度上限,未配置时优先 API `max_budget`,仍无则整条蓝色。
- **设置页 UI 重排与折叠面板**:「界面语言」移至费用设置顶栏(打开即见);「Token 用量统计」与「按模型统计」上移至费用设置最上方,按模型统计改为与其余面板同款的圆角方框背景;「按模型统计」与「价格表」改为常规三角展开按钮的可折叠分节(均默认收起),价格表折叠区含第三方已挂载模型卡;「未命中模型」行的 provider:model 键同步展示归一。
- **provider 展示名归一**:历史请求携带的 `zen` 是错误叫法,界面展示统一为 `go`(仅展示层,账本键与价格覆盖键不变);价格目录文案中的「Zen 网关」同步改为「Go 网关」。
- **历史账本按模型统计回填**:按模型统计(`byProviderModel`)上线前的旧账本只有每日/会话合计;新增 `lib/backfill.js`,启动后回放宿主会话日志(`$DSH_HOME/sessions` 下的 `session.jsonl[.zstd]`,自实现拼接 zstd frame 扫描 + 逐帧解压,与宿主持久化格式一致),按与 `costUsage` 投影同规则的逐次重建(request/header 切换 provider/model、(turn, step) 去重、按事件时刻计价——峰谷时代前的旧调用按 `legacyBase` 历史价)回填空 `byProviderModel` 的日期与会话条目;日志已清理无法回放的调用以账本总量差额归入 `deepseek:legacy` 残差行,保证按模型合计与当日总量对齐;幂等(只填空条目,已有记录不改动、不重复计数),回填后调度落盘;verify.mjs 第 8 节固化回归(会话日志回放/历史价/残差/幂等/zstd)。

### 变更

- 「按模型统计」口径说明去掉「(权威算法)」括号附注。

### 修复

- **git/npm 安装产物缺失 `lib/backfill.js` 导致启动崩溃**(issue #14,感谢 @Hchunjun 的报告与精准诊断):`files` 白名单逐文件列举漏配新增模块,改为按 `lib` 目录整体发布,后续新增文件不再漏配;`npm pack` 产物已验证含全部 8 个 lib 模块。

## [1.5.3] - 2026-08-18

### 变更

- **opencode-go 目录去重**:Go 目录中的 DeepSeek V4 Flash/Pro 参考价与官方主表重复,以官方为准(含峰谷两档),从目录与家族分组移除(17 个非 DeepSeek 模型保留);旧账本已挂载的这两条经 `sanitizeConfig` 迁移自动剔除;`docs/provider-pricing.json` 同步再生成。

## [1.5.2] - 2026-08-18

### 新增

- **价格卡展示位置开关(`priceTableDisplay`,精确到单个模型)**:拓展价格表挂载的第三方模型默认收入拓展价格表内(按 厂商 → 模型家族 折叠,厂商默认折叠),不再与 DeepSeek 价格表同区直接展示;拓展价格表内逐模型提供「在费用设置直接显示」开关,可自选哪些模型的价格卡在「价格表」区直接显示——DeepSeek 模型也可逐模型收入拓展表,第三方单个模型也可提到直接区;该开关只决定展示位置,不影响挂载状态与计费——未勾选直接显示的已挂载模型在拓展表展开后以可编辑卡片呈现(可改价/取消挂载/切回直接显示)。配置键 'provider:modelId' → 布尔,经 `applyConfigPatch` 校验(非布尔值定向收敛)与 strict codec,旧账本经 `sanitizeConfig` 自动收敛;verify.mjs 第 6.6/7.1 节固化回归。
- **默认挂载全部目录模型**:`prices.providers` 默认包含全部内置目录(含未核价条目,计费时不套价);旧账本经加载边界 mergeDeep 自动补齐——挂载只决定计费可用性,是否直接显示在费用设置仍由逐模型 `priceTableDisplay` 开关控制。
- **模型名匹配放宽**:新增归一化(小写,忽略大小写/空格/横杠/下划线/点号,去括号附注如 (go))——归一化等价即命中;宽泛包含匹配(请求名归一化后包含价格表模型名即算,取最长候选,如 `gpt5.6 luna(go)` → `gpt-5.6-luna`);旧的去后缀/前缀/家族相似链保留兑底;pricing.js 与 bundle 镜像双实现同步,verify/审计固化回归。

### 修复

- **路由 provider 下本会话费用为零**:请求携带的 provider 未在价格表登记(opencode / zen 等路由入口)时,此前按未定价计 0(luna 已挂载、DeepSeek v4 flash 均为 0);现在自动按模型名跨厂商全库查找——先查 DeepSeek 主表(保留峰谷两档),再取其余厂商中归一化最长命中;全库无此模型才不套价。
- **宿主账本入账丢失手动覆盖与匹配模式**:`providerPriceEntryFor` 调用补传 `priceMatch` / `priceOverrides`,与客户端估算同口径。
- codec 放行 provider 价格条目的 `unpriced` 标记(不再被下发时剥离)。

## [1.5.1] - 2026-08-18

### 变更

- **经典样式收起态精修**:去掉旗标箭头的倒三角与当前段进度填充叠层(浅色主题下会把分段冲淡/压暗造成色差),上橙下蓝两段恒定满色,与展开态经典样式完全一致;当前时段仅由描边标记与下方短词指示,倒计时与进度信息在悬停提示中。
- **README 中英配图整理**:峰谷段落配图改为「设置页峰谷面板 + 右下角(dock)显示设置」两图;右下角(dock)段落补充显示设置开关位置截图;新增真实界面截图 peak-panel-settings / dock-display-settings 中英各一张。
- 安装链固定 tag 同步至 v1.5.1(install.ps1 `$Rev` 此前仍为 v1.4.0,一并修正)。

## [1.5.0] - 2026-08-18

### 新增

- **多厂商 Coding Plan 额度查询**:新增 `lib/coding-plans.js` adapter 框架,首批接入三家(均经端点存活实测):Anthropic Claude Pro/Max(`api.anthropic.com/api/oauth/usage`,OAuth token,5 小时/7 天窗口)、Z.ai/智谱 GLM Coding Plan(`api.z.ai` 与 `open.bigmodel.cn` 国际/国内双端点,兼容 plans 数组与扁平窗口两种响应)、MiniMax Token Plan(`minimaxi.com`/`minimax.io` 双域,旧 Coding Plan 计数制端点兼容回退)。
- **Kimi / Moonshot 额度接入(第四家)**:官方 PAYG 余额端点 `api.moonshot.cn/v1/users/me/balance`(未授权实测 401 存活,官方文档明确),显示人民币余额文本窗口;额度窗口新增 `text` 形态(无百分比的量直接显示文本,strict codec 同步放宽);Kimi Code 订阅周窗/5小时窗暂无 API-Key 化公开端点(仅控制台),已在面板与文档中如实注明。
- **OpenRouter / SiliconFlow 额度接入(第五、六家)**:OpenRouter `openrouter.ai/api/v1/credits` 预付 credits 已用%(官方文档端点,实测 401 存活);SiliconFlow 硅基流动 `api.siliconflow.cn/v1/user/info` 账户余额文本窗口(实测 30014 存活);白名单断言入 verify。至此覆盖 Anthropic / Z.ai·智谱 / MiniMax / Kimi / OpenRouter / SiliconFlow 六家;百炼 / OpenAI Codex / Gemini Code Assist / GitHub Copilot 个人版经调研无 API-Key 化公开用量端点,如实注明不接入。
- **「账本不可用」根治与兼容性加固**:修复拓展价格目录经 `priceSchema`(要求三桶数字)下发导致未核价/两档简写条目击穿 strict codec 的问题(新增 `catalogEntrySchema` 兼容三桶/两档/未核价);新增 `sanitizeConfig` 在账本加载边界清洗非法配置值(类型/枚举/嵌套面板定向回落,随下次落盘覆盖);`buildState` 增加 stateSchema 自检与逐级降级兑底(剔目录 → 空额度状态),漂移时保核心可用性而非整体拒绝;verify.mjs 第 7 节固化回归(含完整快照过 strict codec 的漂移哨兵测试)。
- **模型名自动匹配计费**:未知模型 id 按 精确 → 手动覆盖 → 去日期/版本后缀 → 前缀(最长) → 家族 token 相似(≥2 前缀 token,阈值防误配) 解析价格;`priceMatch` 配置(auto/exact,默认 auto)可在设置中关闭;宿主账本入账与客户端估算同口径(pricing.js `matchModelId` + bundle 镜像双实现,注释标明同步要求)。
- **手动匹配指定**:设置页新增「最近出现但未精确命中的模型」列表,可为每个模型下拉指定计费所用的价格条目(含跨 provider 引用与 DeepSeek 默认价),写入 `priceOverrides` 手动覆盖(优先级最高,支持移除);配置经校验与 strict codec。
- **拓展价格表目录**:设置页新增「拓展价格表」面板(点开展开)——内置只读目录按 厂商 → 模型家族 分类展示全部内置价格(含 DeepSeek 峰谷两档与 13 家第三方);支持一键挂载到费用设置价格表参与计费,DeepSeek 模型可取消挂载回退默认价后重新挂载;目录由宿主 `buildPriceCatalog()` 经状态下发(`PROVIDER_MODEL_FAMILIES` 家族分组),缺失时面板自动隐藏。
- 凭据发现链与余额/Go 额度一致:面板显式 Key → DSH 凭据库 → 环境变量 → CLI 登录态兜底(Anthropic 自动读 `~/.claude/.credentials.json`);Key 只发往各家硬编码官方域名(白名单断言入 verify)。
- 设置页新增「Coding Plan 额度」面板:各家独立启用开关/Key 输入/手动刷新/进度条与重置时间;无凭据/无订阅为软失败中性提示;新增 `refreshCodingPlan(provider)` RPC 与状态 `codingPlans` 字段(strict codec)。
- Kimi Code 订阅窗口 / 阿里云百炼 Coding Plan / OpenAI Codex / Gemini Code Assist / GitHub Copilot 暂无 API-Key 化公开用量端点,交接文档记录调研结论不接入(Kimi 仅接入 PAYG 余额)。
- 测试:`verify.mjs` 新增第 5 节(归一化/三家解析器/软失败/官方域名白名单/配置清洗/清单断言)。
- **价格目录大扩充(含 OpenCode Go 全部模型)**:内置目录从 ~30 个模型扩充至 90+:OpenAI GPT-5.6 Sol/Terra/Luna、GPT-5.5、5.4 全系、5.3 Codex、5.2、5.1 全系,Anthropic Fable 5/Opus 5/4.8/4.7/4.6/Sonnet 5/4.6,Gemini 3.7/3.6/3.5 Flash、3.1 Pro、2.5 全系,Grok 4.6,GLM-5.3/5,Qwen3.8/3.6/3.5,Kimi K2.5,MiniMax M2.5,MiMo V2.5,Hy3 等;价格以 OpenCode Zen/Go 官方价目(cost-pass-through)与各厂官方定价页交叉核对,无法核价的(GLM-5.3 等)标 unpriced 不编造;新增 `opencode-go` 目录含订阅全部 18 个模型的官方参考单价;`docs/provider-pricing.json` 由代码自动再生成。
- **挂载即在费用设置直接显示**:拓展价格表挂载的第三方模型在「价格表」区以可编辑卡片直接展示(与 DeepSeek 价格同区,按厂商分组,含输入/缓存/输出三栏与取消挂载);未核价条目禁止挂载。
- **拓展价格表厂商默认折叠**:点开面板后各厂商默认收起(▸ 标题含模型数),点击单个厂商展开,互不影响。
- **经典样式收起态改竖向胶囊条**:经典样式侧边栏收起时不再是「峰时/平价」文字分段,改为与展开态同风格的竖向胶囊条——上橙下蓝满色分段(与展开态经典样式完全一致,不淡化不填充)、描边标记(峰时橙/平价蓝)指向当前时段,下方横排短词,倒计时与进度信息在悬停提示中;简洁/经典两收起态均为「竖轨道 + 短词」同构布局。
- 修复:客户端 parseConfig 的 codingPlans 硬编码三家白名单导致 kimi/openrouter/siliconflow 配置被丢弃,改为通用遍历校验。

## [1.4.1] - 2026-08-18

### 新增

- **峰时/平价时段条(适配 PR #9 并修复)**:展开态将峰时提示升级为单行紧凑时段条——细轨道左橙右蓝、标记线指向当前时段,右侧文字显示当前时段与距下次切换的倒计时(30 秒刷新),竖向占用约一行;峰时橙色文字、平价蓝色文字,不显示价格;预算框、今日费用与设置页预算面板三处生效;仍遵循 `peakNotice` / `peakEnabled` / `peakEffectiveAt` / `peakWindows` 门控。
- **收起态竖向峰谷时段条**:侧边栏收起(rail)时显示与展开态同构的竖向时段条——竖轨道上橙(峰)下蓝(平价)、标记线指向当前时段,下方横排短词,悬停查看完整中英文计费提示(不采纳 PR #9 「rail 窄栏隐藏」的方案,满足收起时可见的需求)。
- **峰谷相位纯函数与边界测试**:`lib/pricing.js` 新增 `peakPhaseAt`(相位与相邻切换点,客户端 bundle 镜像同逻辑);`test/verify.mjs` 补充峰始/峰终半开边界、跨日回绕、跨午夜窗口、空窗口/非法输入断言。
- 收起态竖向条截图源文件 `docs/peak-notice-rail.html`(旧 ⚡ 版已替换)。
- **峰谷时段条样式可切换(`peakStyle`)**:设置 → 费用 → 峰谷计价 下新增「峰谷时段条样式」,可选简洁(单行紧凑,默认)与经典(分段轨道 + 箭头旗标 + 胶囊芯片;收起态为文字分段 + 进度填充),展开/收起两态同步切换;配置经 `applyConfigPatch` 校验(compact / classic)与 strict codec(optional 枚举),旧账本自动补默认值。
- **峰时色改为亮橙色**:时段条/竖向条的峰时色由主题警示黄(`--dsw-alias-state-warn-primary`)改为固定亮橙色 #ff9800(段落、文字、经典样式旗标均适用),与平价蓝对比更明确。
- **收起态短词改横排**:简洁样式收起态不再竖排文字,轨道下方横排单行短词「峰时 / 平价」,倒计时与完整计费提示移入悬停提示,不拥挤。
- **取消非当前段淡化**:简洁样式时段条/竖向条不再对非当前段加透明度(浅色背景下橙色被稀释成浅黄,误观感为颜色未改),两段恒定满色,当前时段由标记线与文字色指示。

### 变更(设置页整理)

- **峰谷设置与预算分离**:新增独立「峰谷计价与提示」面板(紧随预算面板)——启用开关、显著提示开关、时段条样式切换与实时时段条预览(随草稿即时刷新)、峰窗/生效时间/当前档位状态行;预算面板不再内嵌时段条,「显示设置」网格不再混入峰谷控件。
- **显示设置分组重排**:字段按「常规 / 金额与币种 / 侧边栏显示 / 右下角角标 / 图框详细信息」五组加分隔标题展示,同组字段相邻;清理无引用的旧文案键。
- **Coding Plan 面板默认折叠**:设置页「Coding Plan 额度」默认收起,仅显示标题与一段说明;标题旁提供展开/折叠按钮,展开后显示完整说明与三家配置卡,展开/收起状态经 localStorage 记住(刷新页面保持,存储不可用时仅本会话生效)。

### 修复(PR #9 审查)

- 修复收起态引用未定义的 `peakShort` / `offPeakShort` 文案键导致显示原始键名的问题(中英文文案已补齐,含倒计时系列键)。
- 峰谷门控与窗口判定收敛为单一 `peakView` / `peakPhaseAt` 路径,展开/收起两处共享,时钟源唯一(组件内 `useState` 定时刷新),消除原先三处重复的 `now` 计算与门控拷贝。
- 移除不再渲染的 `.cm-peak-notice` 死样式;时段条/竖向条样式选择器按最终 DOM 结构核对无误。
- 修复**启用预算时收起侧边栏不显示竖向峰谷时段条**:竖向条原只在「未启用预算的今日徽章」分支渲染,启用预算后 rail 模式只有百分比方块;现将竖向条移至侧边栏底部堆叠末尾,收起态无论预算 / Go 额度开关状态均统一显示(仍受 `peakNotice` 等门控),居中对齐百分比方块。

### 修复(账本/额度)

- **账本不可用**:历史中间版本曾向账本写入 `reasoning: null` 等非法数值,Typert strict 状态 codec(zod `number()` 拒绝 null)拒绝整个 `getState` 响应,设置页显示「账本不可用」;现在 `Ledger.open()` 在加载边界用 `sanitizeDays()` 清洗全部数值字段(非有限/负数/缺失归 0,非法 byProviderModel 条目剔除),随下次落盘覆盖旧数据。
- **OpenCode Go 额度无法查询**:与上同根——`refreshGoQuota` 返回体携带的账本状态同样击穿 strict codec,网关拒绝整个响应;随账本清洗一并修复(额度端点 `opencode.ai/zen/go/v1/usage` 与 Key 发现链实测正常,真实 Key 返回 200)。
- 测试:`verify.mjs` 新增旧账本兼容回归(含 `reasoning: null`/缺失字段/非法条目的 fixture + strict codec `safeParse` 断言)。


本文件按 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式维护。

## [1.4.0] - 2026-08-17

### 新增

- **真实场景截图**:README 中英版新增真实 DSH Web 峰时提示截图(侧边栏与设置页),英文版使用英文界面截图。
- **峰时高价时段显著提示(PR #8)**:侧边栏预算框、侧边栏今日费用区域与设置页预算面板在峰时段显示一行警示提示(「当前为 DeepSeek 峰时高价时段,按峰时价计费」,中英双语);复用 `peakEnabled` / `peakEffectiveAt` / `peakWindows` 门控,rail 窄栏不显示。
- **峰时提示独立开关(`peakNotice`)**:设置 → 费用 → 峰谷计价 下方新增「峰时高价时段显著提示」开关(默认开启),关闭后三处提示全部隐藏。

### 变更

- **非 DeepSeek provider 计费适配**:按 provider + model 隔离价格与账本明细,支持 OpenAI、Anthropic、Google Gemini、Mistral 的 flat input/output/cache/reasoning token 价格;非 DeepSeek 未配置模型不再静默套用 DeepSeek 默认价。
- **官方价格目录**:新增 `docs/provider-pricing.json`,首批记录 OpenAI、Anthropic、Gemini、Mistral 官方 API 价格、来源 URL、核对日期与限制说明;未确认的官方型号不编造价格。
- **价格表适配更多模型计费方式**:支持 `input`/`output` 两档简写(Anthropic / Gemini / Mistral 等无缓存折扣模型)与任意子集——`cacheMiss` 缺省取 `input`、`cacheHit` 缺省取 `cacheMiss`(无缓存折扣时命中价 = 未命中价),峰谷子档同样适用;此前两档写法会被误判为非法、缺省命中价会被按 0 计费。
- 账本入账 token 归一化:非数字/负数 token 按 0 处理,防止污染聚合(计费数学本身已有防护,此变更覆盖账本累加)。
- 修复:设置页编辑价格表保存会把模型的 `legacyBase` 抹掉(客户端解析未保留该字段),现已在客户端解析与草稿回传中完整保留。

- **价格表按官方当前定价更新(纯峰谷两档)**:官方已取消基础价档与生效时间,改为纯峰谷两档(空闲 = 高峰一半):flash 空闲 0.007/0.22/0.66、峰值 0.014/0.44/1.32;pro 空闲 0.022/0.66/1.98、峰值 0.044/1.32/3.96;内置表基础档改为与空闲档同价,默认生效时间改为过去时刻(两档即时生效)。
- **官方价格同步适配新页面**:解析器适配官方新单表结构(OFF-PEAK/PEAK 两档行);页面无生效时间时,同步后 `peakEffectiveAt` 设为当前时间(峰谷立即生效);计费图示与中英 AI 同步提示词同步更新。
- **历史计费正确性**:2026-08-16 16:00 UTC(峰谷时代分界)之前的调用按当时的基础价计费(flash 0.0028/0.14/0.28、pro 0.003625/0.435/0.87,`legacyBase`),之后的调用按峰谷两档;账本入账与会话徽章(投影 v2,按事件时刻逐次计费)同步生效。
- 官方价格同步成功后,设置页草稿整体对齐最新配置(价格表显示即时刷新)。

## [1.3.1] - 2026-08-16

### 新增

- **Token 用量统计**(费用设置内):历史累计 token 总量(输入 / 缓存 / 输出 / 调用次数)+ 类 Codex 的 **26 周每日用量方格热图**——格子自适应、横向铺满整个设置页宽度;无用量日为半透明无色玻璃格(带宿主风格边框),有用量为四档蓝色,今天描边高亮,悬停任意格子见当日 token 明细、调用次数与费用;月份标签在网格下方;界面中英双语。
- 文档:会话徽章两位置(输入区下方 / 会话标题栏)截图更新为局部放大版。

### 修复

- **多窗口配置互覆**:设置保存由整份草稿改为**只提交改动的顶层键**(diff 补丁)——多个 dsh 窗口同开时,旧窗口不再用整份旧配置覆盖其它窗口已保存的改动。
- 设置页打开期间,周期轮询刷新不再覆盖有未保存改动的草稿(v1.3.0 轮询引入的回归)。

## [1.3.0] - 2026-08-16

### 新增

- **OpenCode Go 订阅额度**:读取 opencode.ai 的滚动 5 小时 / 本周 / 本月用量百分比与重置时间;侧边栏新增「Go」图框(与预算图框同风格:标签 + 已用% + 进度条 + 5h/周明细 + 重置时间,窄栏为百分比方块),设置页新增额度面板(三档进度条 + 手动刷新);API Key 按「配置 → DSH 凭据库(OPENCODE_GO_API_KEY)→ 环境变量 → opencode auth.json」顺序自动发现;显示位置 / 刷新间隔可配。
- **右下角(dock)额度 / 预算 chips**:显示设置新增「右下角显示」开关与四项独立子开关(滚动 5 小时 / 本周 / 本月额度、预算已用%);多开时一行右对齐自动换行,单开时单独一个小 chip;预算 chip 沿用预算图框口径(≥80% 预警、≥100% 超支),悬停见重置时间 / 预算明细。
- **文档截图 v2**:新增 OpenCode Go 额度相关实拍截图(侧边栏合并卡片 / 设置页额度面板 / 右下角 chips / 显示设置 / 窄栏 rail),README 中英双语同步引用。

### 变更

- **OpenCode Go 额度启用开关**(设置 → 费用顶部额度面板,像「启用预算」一样的总开关):关闭后不读取、不显示(侧边栏图框/设置页/右下角全部隐藏),面板显示未启用说明;默认开启。
- **无订阅场景兜底**:未找到 API Key、API 返回 401/403(无 Go 订阅或 Key 无效)时,面板给出明确的中英文提示;未启用时手动刷新会被明确拒绝。
- Go 图框与预算图框**同时出现时合并为一张卡片**(Go 在上、预算在下,细分隔线,各自保留预警色),单独出现时保持单框外观。
- **Go 额度主档位可配**(显示设置新增「Go 额度主档位」:滚动 5 小时 / 本周 / 本月,默认滚动 5 小时):图框主百分比与进度条按主档位显示,其余两档在下方一行展示;设置页额度面板与右下角 chips 同步按主档位排序(主档位高亮)。
- 设置 → 费用:OpenCode Go 额度面板移至**最顶部**(预算面板之上,余额面板第三)。
- 「**Go 图框详细信息**」「**预算图框详细信息**」独立开关(显示设置):关闭后图框只保留 标签 + 已用% + 进度条;合并卡片中两段各自生效,可进一步压缩高度。
- 合并卡片压缩高度:合并时省略「重置时间 / 已用与额度」次要行,收紧内边距与进度条高度。
- 侧边栏 rail 模式:余额行与今日行的文本符号(¥)改为官方风格钱包图标(16×16 填充式 SVG,currentColor,跟随主题色);宽栏文案、悬停明细与错误态(⚠)不变。
- 侧边栏底部与其它插件图标兼容(dsh-remote-web-ui 的「检查更新 / 移动端远程控制」行):展开(wide)时本插件余额行与预算图框保持最左;窄栏(rail)时外壳底部改为纵向排布,本插件图标置底,同一行的其它插件图标上移。

### 修复

- **OpenCode Go 额度 HTTP 403(#2)**:Key 解析优先级与 DeepSeek 余额路径对齐——显式配置 → DSH 凭据库(OPENCODE_GO_API_KEY)→ OPENCODE_GO_API_KEY 环境变量 → 兼容旧名 OPENCODE_API_KEY → opencode auth.json,多 Key 机器不再拿错;额度请求补浏览器 User-Agent,修复被 opencode.ai 前置 Cloudflare 拦截(error 1010)导致的 403;goQuotaKeyMissing 提示文案同步修正。
- **侧边栏数据冻结在页面加载时刻(#3)**:客户端新增 60 秒周期轮询(页面隐藏时跳过)与 visibilitychange 重新可见立即刷新,reload 加并发防抖,卸载时清理定时器与监听;「今日费用 / 余额」与设置页看板现在会自动跟进账本与余额缓存。

## [1.2.0] - 2026-08-14

### 新增

- **中英双语界面**:全部插件文案(会话徽章、侧边栏余额与预算图框、设置页)接入 i18n,支持 简体中文 / English / 跟随浏览器(自动);
- **界面语言设置**:设置 → 费用 → 显示设置 → 界面语言,切换即时生效并自动保存;设置页左侧分节标签随语言切换(费用 / Cost);
- 语言探测写回:默认「跟随浏览器」时,首次加载把浏览器语言探测结果写回配置,服务端消息(余额查询、官方价格同步、配置校验等)与界面语言保持一致;
- 服务端消息本地化:余额查询/刷新、官方价格同步、配置校验错误等返回文案按当前语言输出。

### 变更

- 配置新增 `locale` 键(auto | zh | en,默认 auto);旧账本自动补齐默认值,无需迁移;
- Typert 清单摘要与文档注释改为中英双语;package.json 补充 i18n/bilingual 等关键词;
- package.json 新增 `dshhub` 清单(DSH Hub 收录所需:displayName / summary / categories / surfaces / capabilities / compatibility / permissions)。

### 修复(安全)

- **余额查询凭据收紧**:`balanceEndpoint` 仅允许官方域名 `api.deepseek.com`;`llm-deepseek.baseURL` / `DEEPSEEK_BASE_URL` 指向非官方域名时,余额查询直接拒绝发请求(中英双语报错),API Key 不再有被发往非官方端点的风险;
- **可审计的固定安装链**:`install.ps1` 固定发布 tag(v1.2.0)与 pnpm 版本(11.21.0),git/tarball 两种来源均按 tag 安装,`irm` 一键行也固定到 tag URL;README 安装说明同步更新,并注明"先审阅再运行"。

## [1.1.2] - 2026-08-14

### 新增

- **一键安装**:仓库内置 `install.ps1`,支持 `irm … | iex` 远程直装(自动补齐 pnpm、自动探测 git、无 git 时退回 GitHub tarball 直链;已安装时重跑即为更新);
- **远程直装**:支持 `dsh plugin --profile web add github:Han-1413141/dsh-cost-meter` 与 GitHub 打包直链,无需克隆仓库;
- CI:新增 `install-smoke` 工作流,在 Windows / Linux 真机验证一键安装路径与插件图接入。

### 变更

- package.json 补充 `repository` / `homepage` / `keywords` 元数据。
- README 中英双语化:新增 `README.en.md` 英文版,与中文版顶部互链可切换;新增中英双语「架构与数据流」「计费规则与峰谷计价」SVG 图示;新增 `docs/AI-PRICE-SYNC-PROMPT.en.md` 英文提示词。

## [1.1.1] - 2026-08-14

### 修复

- 侧边栏外壳的 footerActions 为横向 flex,余额行与预算图框此前并排渲染;改为单个条目内自建纵向堆叠(余额在上、图框在下),rail 模式同样垂直排列。
- 文档:侧边栏截图改为紧凑的底部区域(余额 + 图框 + 设置按钮),替换过长整列图。

## [1.1.0] - 2026-08-14

### 变更

- 侧边栏布局:余额行移到预算圆角图框**上方**(关闭预算时余额仍显示在设置按钮上方);
- 预算图框新增**今日费用与占预算百分比**(「今日 ¥x · 占预算 y%」行);
- 文档:补充本会话费用两种位置(输入区下方 / 会话标题栏)的实拍截图。

### 修复

- `normalizePrice` 读取谷时/峰时档时误用外层闭包,导致任何配置保存都会把 offPeak/peak 清零;已修复并重新同步官方价格。

## [1.0.0] - 2026-08-14

首个正式版本。功能全览:

- 本会话费用徽章(输入区下方/会话标题栏,位置可配),输入/缓存/输出 token 分列;
- 侧边栏当日费用徽章与预算圆角图框(设置按钮上方,预算/已用%/进度条,≥80% 预警、≥100% 超支);
- 预算:额度(按显示币种)与周期(今日/本月/累计/自定义日期区间);
- 官方开放平台余额:总余额/赠送/充值,显示位置(侧边栏/设置页/两者/关闭)与刷新间隔可配,手动刷新;
- 设置页:汇总卡片、今日会话明细、按天历史记录、价格表(基础/谷时/峰时)、峰谷计价开关与当前档位状态;
- 计费:DeepSeek 官方价格模型(美元/1M tokens),缓存写入按命中价,峰谷计价按时点门控(生效前基础价);
- 官方价格一键同步(解析官方定价页)+ [AI 价格同步提示词](docs/AI-PRICE-SYNC-PROMPT.md);
- 所有设置修改即时自动保存(600ms 防抖);
- 文档:README 图文演示(侧边栏/会话/设置页截图)、宣传图、CHANGELOG、LICENSE。

## [0.4.0] - 2026-08-14

### 新增

- 官方开放平台余额:调用 `GET {baseURL}/user/balance`(与模型请求同一把 API Key,来自 设置→模型/凭证服务),显示总余额/赠送/充值;
- 余额显示位置可配:主页面侧边栏 / 设置页 / 两者 / 关闭;自动刷新间隔可配(默认 5 分钟),设置页可手动刷新;
- 设置页全部配置改为**即时自动保存**(600ms 防抖),移除保存按钮,顶部显示 保存中/已自动保存/失败 状态;
- 峰谷计价状态提示:设置页显示当前状态(未生效按基础价 / 峰时段 / 谷时段);计费本身始终按官方生效时间(2026-08-16 16:00 UTC)门控,生效前不使用峰谷价;
- `docs/AI-PRICE-SYNC-PROMPT.md`:AI 价格同步提示词,便于用户让 AI 自主读取官方定价、同步不同模型不同时间的价格。

## [0.3.0] - 2026-08-14

### 新增

- 自定义预算周期:预算周期新增「自定义区间」,可设置开始/结束日期(结束留空 = 今日);已用金额由宿主按区间聚合(`budgetUsed` 随状态下发)。
- 主页面预算图框:启用预算后,侧边栏底部(设置按钮上方)显示圆角方形图框,内含「预算」标签、已用百分比、进度条与 已用/额度 金额;窄栏(rail)模式显示百分比方块。≥80% 橙色预警、≥100% 红色超支。
- 仓库宣传图:docs/promo.png(鲸鱼娘主题)。

## [0.2.0] - 2026-08-13

### 新增

- 预算:设置页顶部新增「预算」面板,支持启用/关闭、预算额度(按显示币种)与周期(今日/本月/累计),显示已用金额与已用百分比进度条(≥80% 橙色预警、≥100% 红色超支)。

### 变更

- 输入/缓存/输出 token 在汇总卡片、侧边栏提示、会话徽章与历史表中分开显示(此前缓存并入输入);缓存读写按命中价计费,界面显式标注。

## [0.1.0] - 2026-08-13

### 新增

- 本会话费用徽章:输入区下方(dock)与会话标题栏(header)两种位置,可配置或关闭。
- 当日费用徽章:侧边栏底部,悬停显示今日调用/token 与本、月累计费用。
- 设置 →「费用」独立页面:今日/本月/累计汇总卡片、今日会话明细、按天历史记录。
- 显示设置:位置、侧边栏开关、货币单位(CNY/USD/EUR)、货币符号、汇率、小数位数。
- 峰谷计价:DeepSeek 官方 2026-08-16 生效的峰/谷时段计费(可关闭、时段可配)。
- 价格表管理:每模型 基础/谷时/峰时 三档价格,支持增删改与默认回退。
- 从官方文档同步价格:抓取并解析 [DeepSeek 官方定价页](https://api-docs.deepseek.com/quick_start/pricing),一键应用。
- 账本持久化:$DSH_HOME/storages/cost-meter/ledger.json,原子写入 + 防抖,历史保留天数可配。
- 数据通道:costUsage 会话投影(本会话)+ Typert RPC(costMeter/getState、updateConfig、fetchPrices、resetHistory)。

### 已知限制

- 官方页面解析依赖当前页面结构,页面改版后需手动编辑价格表兜底。
- 会话徽章按当前价格档位估算;精确计费以账本为准。
- 安装/更新插件后需重启 `dsh web` 生效。
