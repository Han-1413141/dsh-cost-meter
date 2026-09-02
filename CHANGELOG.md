# Changelog

## [1.7.7] - 2026-09-02

### 修复(issue #88:大日志回填 OOM;issue #89:对账余额变动口径)

- **回填流式化(issue #88,P0)**:用户实测一份 168MB(压缩后)的 `session.jsonl.zstd` 在启动回填时把 Electron 主进程堆耗尽崩溃(STATUS_BREAKPOINT),且同步解压全程占住事件循环(agent 界面卡死)。旧缓解(逐帧解压)只压了解压峰值,records 数组物化与巨长打包行的整行 JSON.parse 仍在。现三层防御:
  - **流式迭代器 `iterateSessionRecords`**:分块读文件(8MB) + 增量扫描帧边界,完整帧立即解压逐行产出并释放引用——任一时刻只持有单帧解压结果;每 64 帧 / 4096 事件 `setImmediate` 让出一次,回填期间宿主 UI 保持响应;
  - **打包行探针**:超 4096 字节的行先看头部 512 字符,命中 `text-chunks`/`reasoning-chunks`/`tool-call-chunks` 模式直接跳过,不再付出巨长行的 JSON.parse 瞬时峰值;
  - **解压预算**:单文件累计解压超 4GB 抛错(防解压炸弹),调用方按「单文件损坏」跳过,绝不拖崩主进程;结构损坏(连续一个分块无完整帧)按旧版全量扫描语义停止。
  回填/导入/重算/fork 清洗四条路径全部切到流式读取。
- **对账「官方余额当日变动」口径(issue #89)**:赠送余额(granted)当日到期归零时,total 减量混入整块赠送失效金额——不是消费,与账本今日费用必然对不上,造成「变动虚高」误报。现该日重置基准不对账(与既有「授予增加→重置」守卫对称),从零余额起继续对账;granted 维持剩余的场景口径不变。

### 验证

- verify.mjs 新增回归块(19-1/19-2/19-3):打包行探针行为、流式迭代器语义(多帧跨块行/解压预算抛错/结构损坏停止/打包行过滤)、大日志流式回归(500 事件+500 打包行,只保留事件行);对账新增赠送归零日重置 + granted 剩余场景两用例。
- 双时区全量通过;`dsh web` 实机启动冒烟通过;lib/client.js 无变化(262,062 字节)。

# Changelog

## [1.7.6] - 2026-09-01

### 安全与体验(issue #86:自定义余额凭据治理)

- **明文密钥永不落盘/下发**:v1.6.8 的密钥治理只覆盖 goQuota/codingPlans 专属字段,自定义余额请求头里的明文 key(`Bearer sk-…`、`X-Api-Key: …`)会原样写进 `ledger.json` 并随 getState 抵达浏览器。现 `stripSecrets`/`stripSecretPatch` 对 `customBalances[].request.headers` 按值形态判定脱敏——敏感头名(Authorization/api-key/token/secret/cookie 等)的非占位符值、典型密钥形状(Bearer/sk-/AIza/ghp_/JWT/≥32 位混合长串)一律置空;`{{VAR}}` 占位符与普通头(Content-Type 等)照常保留。落盘、下发、补丁三条路径同一闸门。
- **存量明文自动迁移**:启动时把请求头遗留明文导入 DSH 凭据库,并把头值替换为 `{{CUSTOM_BALANCE_KEY_…}}` 占位符(名称由条目 host + 头名稳定哈希派生,跨重启一致,重启后功能不丢)。与 runSecretMigration 同一套结局语义:凭据库已配置不覆盖、不可写保留明文并提示,绝不静默丢密钥。
- **凭据外带防护覆盖明文 key**:`usesCredentials` 判定从「{{VAR}} 占位符」扩展到「占位符或疑似明文密钥」——明文 key 发往白名单外主机同样直接拒绝(此前明文完全绕过 allowedHosts 校验,恰是最常见的外带场景)。
- **UI 补齐**:条目面板新增「凭据白名单主机」输入框(allowedHosts,逗号分隔,此前有字段无 UI);「凭据输入」区为请求头中每个 `{{VAR}}` 占位符渲染 write-only 输入框(经 setCredential 新增 `customVar:<NAME>` 目标写凭据库,状态经 `customVarStatus` 下发,写后作废相关余额快照缓存);「请求头 (JSON)」上方新增变量命名规则说明(`<ROUTE>_API_KEY`:Provider ID 大写、非字母数字换下划线,与模型页同名即共用同一把密钥)。
- **文档**:中英 README 补 `allowedHosts`、`{{VAR}}` 占位符、命名规则、明文迁移与白名单行为说明。

### 验证

- verify.mjs 新增回归块(18-1/18-1b/18-2/18-3/18-4/18-5):启发式判定、脱敏三路径(落盘/下发/补丁,含旧单条键)、迁移三路径(成功/已配置/不可写)+ 幂等、customVar e2e(写入/非法名/保留前缀/内置冲突/移除/状态下发)、外带防护覆盖明文 key、客户端与 schema 接线。
- 全量通过(TZ=本地 +8 与 TZ=UTC 双跑);`dsh web` 实机启动冒烟通过(端口 3998/3999,插件加载无报错);lib/client.js 重建 262,062 字节(上限 262,144)。
- 构建脚本字节口径统一:build.mjs 改用 UTF-8 字节(与 verify.mjs 门禁一致,此前为 UTF-16 字符数,中文文案下两者有差)。

# Changelog

## [1.7.5] - 2026-09-01

### 修复(issue #85:GLM-5.3 定价与目录缺失)

- **GLM-5.3 补价**(z-ai 目录):此前标记 `unpriced` 的依据「官方/Zen 均未公布单价」已不成立——智谱官方定价页已公布(国内 ¥8/¥28/缓存 ¥2),现按 OpenCode Go 目录核价收录 **$1.40 / $0.26 / $4.40**(输入/缓存/输出;与 Cloudflare Workers AI 目录一致,notes 注明国内直连价差约 20%)。
- **新增 GLM-5.3-Flash**(Ox Alpha 普惠版,2026-08-26 发布):z-ai 与 OpenCode Go 双目录收录 **$0.15 / $0.03 / $0.50**;大小写/归一化匹配命中;扩展目录家族(GLM-5 Flash / GLM Flash)同步,可挂载编辑。
- **同步范围消歧**:设置页「数据与同步」区新增说明——「从官方文档同步价格」仅更新 DeepSeek 官方模型价(含峰谷档),第三方扩展目录价不随该按钮变化(随插件版本发布维护,可在拓展价格表挂载编辑或经模型名匹配手动指定),消除「按钮会更新所有提供商」的歧义。
- docs/provider-pricing.json(随包发布)再生成同步。

### 验证

- verify.mjs 新增回归块(三档价锁定/双目录命中/大小写归一/扩展目录收录/发布 json 同步/计价冒烟 $0.65);更新旧断言「GLM-5.3 维持 unpriced」为已核价形态。
- 全量通过(TZ=本地 +8 与 TZ=UTC 双跑);lib/client.js 重建(261,301 字节,上限 262,144)。

## [1.7.4] - 2026-09-01

### 维护(依赖升级,#82/#83/#84)

- **生产依赖**:`@deepseek-ai/dsh-credentials` 与 `@deepseek-ai/dsh-home-paths` 0.1.0-rc.6 → **0.1.0-rc.8**;`zod` 4.4.3 → **4.5.1**(devDependencies `esbuild` ^0.28.1 → ^0.28.2)。
- **兼容性验证**:本地冻结安装(`pnpm install --frozen-lockfile`)下全量 104 测试块通过(本地 +8 与 TZ=UTC)、dsh 宿主级 typert manifest 校验通过、`dsh web` 实机启动冒烟通过;rc.8 的 peer 树(dsh-invariants@rc.8)与宿主 rc.1 共存无冲突。
- **锁版门禁断言修正**:此前断言硬编码具体版本号(`zod 锁定 4.4.3` 等),任何 Dependabot 升级都会误报红——这是三个 PR CI 全红的根因(升级本身无问题)。现改为锁「精确版本格式 + zod 大版本 4」,并新增 workspace 排除表与 package.json 锁版的一致性断言(升级漏改 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 会在测试期暴露,而不是 CI 安装失败)。
- pnpm-workspace.yaml 排除表与 lockfile 同步升级到 rc.8 / 0.28.2。

## [1.7.3] - 2026-09-01

### 改进(issue #65 讨论:中转链路缓存字段未上报的显式标注)

- **背景**:经中转/代理(如 cherrystudio)调用时,usage 里的缓存扩展字段(`prompt_cache_hit_tokens` 等)可能被剥离,或中转请求导致 prefix cache 真实未命中——两种情况插件端缓存命中都恒为 0,界面显示「命中率 0.0%」且金额按全未命中价计(上界),此前无从区分「真零命中」与「数据缺失」,造成「金额比官方账单高」的观感。
- **改进**:按模型统计新增「未上报?」标注——累计 ≥3 次调用、非缓存输入 ≥100k token 而缓存命中恒为 0 时(直连 DeepSeek 的 prefix cache 在此形态下几乎必然命中),命中率单元格显示「未上报?」、费用与命中率行均附 ⚠ 悬停说明:命中率无法统计、金额为全未命中价上界、直连官方 API 可恢复准确缓存命中。真零命中(单轮/短上下文/冷启动)不满足量级阈值,不会被误标。
- **边界说明**:插件无法恢复被剥离的数据或修复中转导致的真实缓存未命中(请求由宿主/中转组装,插件仅为计量方)——本改进是消除误导性显示,不是恢复数据。

### 验证

- verify.mjs 新增回归块:判定函数行为级(多轮长上下文恒零命中标注/有命中不标/量级不足的真零命中不标/空桶安全)+ 接线哨兵(单元格文案/双 tooltip/阈值锁定)。
- 全量通过(TZ=本地 +8 与 TZ=UTC 双跑);lib/client.js 重建(260,211 字节,上限 262,144)。

## [1.7.2] - 2026-09-01

### 修复(issue #81:对账警告同句币种符号不一致)

- **现象**:余额对账触发 drift 警告时,同一句话出现「本地账本今日官方渠道费用 **$3.99** 与官方余额当日变动 **¥42** 偏差较大」——本地费用侧恒用 `$`(账本美元口径),而余额变动侧按账户真实币种(CNY)显示 `¥`,同句混排误导。
- **修复**:两侧统一由同一币种判定驱动——余额账户为 CNY 时,本地费用按展示汇率折算为 `¥` 显示并附 `≈$` 参考值(与变动侧的 `¥ 原生 + ≈$` 对称);USD 账户维持两侧均为 `$`。折算率与展示口径一致取设置中的汇率(非法回落 7.2)。

### 验证

- verify.mjs 新增 2 个回归块:源级接线(currencyOf 统一判定/nativeCost 折算/spentCurrency 单点读取)与 e2e(注入 CNY 账户余额查询触发 drift,断言警告文案两侧均为 ¥ 且 cost 侧附 ≈$)。
- 全量通过(TZ=本地 +8 与 TZ=UTC 双跑)。

## [1.7.1] - 2026-08-31

### 修复(P0:v1.7.0 导致 dsh 无法启动)

- **根因**:v1.7.0 给 `refreshCustomBalance` 新增的 `index` 参数,其 codec **裸传了 zod schema**(而非 typert 契约要求的 strict codec 对象 `{ mode: 'strict', typeSymbol, schema }`),typert-loader 在注册期即拒绝——**整个插件树加载失败,`dsh web` 无法启动**(`typert-loader: parameter codec must use a strict codec`)。verify 只测服务端逻辑,测不到 manifest 注册层,因此逃过了发布前检查与 CI。
- **修复**:两侧 manifest(宿主 typert.host.js + 客户端)的 `index` 参数改为 strict codec 对象;并补 `acceptsUndefined: true`(网关按 wire 字段是否在 args 中判缺失,无此标志的 json 参数缺省会以 `arguments-invalid` 拒绝调用)——旧客户端的无参调用(等价全量刷新)继续可用。
- **回归加固**:verify.mjs 新增「宿主级 manifest 校验」块——直接调用本机安装的 dsh 携带的 `dsh-typert-loader` 导出的 `validateTypertManifest`,对本插件真实 TYPERT 清单全量校验(所有参数/result codec 的 strict 形态逐项断言;无宿主环境时退化为形态自检)。此类错误此后在测试期即暴露,不再等到用户启动失败。
- 附:用户侧观察到的 `dsh-typert-registry/client.js failed to load` 是宿主自身组件的浏览器端加载问题(与本插件无关,本插件不依赖也不引用该包);本机实测 v1.7.1 修复后 `dsh web` 正常启动。

### 验证

- 全量 101 块通过(TZ=本地 +8 与 TZ=UTC 双跑,含新增宿主级 manifest 校验块);本机 web profile(link: 本仓库)实测 `dsh web` 启动成功、无 typert 报错;lib/client.js 重建(258,211 字节,上限 262,144)。

## [1.7.0] - 2026-08-31

### 新增(issue #79:自定义 Provider 余额多配置)

- **支持同时配置多个自定义提供商(最多 8 条)**:设置页「自定义 Provider 余额」改为多条编辑--每条独立的名称/币种/显示位置/刷新间隔/请求与解析规则/启用开关,可添加与删除;侧边栏按条目逐卡显示(图框或余额行),点击逐条刷新。
- **每条独立缓存与刷新**:`customBalances[i]` 按条目缓存(独立 TTL/在途去重/软硬失败策略与原单条一致);ambient 快照刷新全部可见条目;`refreshCustomBalance(index)` RPC 按索引强刷单条(缺省全量,旧客户端调用不变)。
- **无缝迁移**:旧 `customBalance` 单配置在配置清洗时自动迁移为 `entries[0]`(有实际内容时),升级零操作;旧单条 config/state 键保留为兼容镜像(旧快照/旧宿主不破),运行期以数组为真源。
- **快照扩展**:`state.customBalances[]`(各条独立快照,含 `index` 定位);config 侧 `customBalances` 数组进 strict codec;降级兜底路径同步。
- 配置校验:逐条与原单条同口径(非法值报错/加载清洗回落),上限 8 条;`allowedHosts` 凭据外带白名单随条目保留。

### 验证

- verify.mjs 新增 3 个回归块:配置层(迁移/多条写入/上限/加载清洗)、e2e(快照数组/兼容镜像/RPC 索引刷新/strict codec)、客户端接线哨兵(逐条编辑/逐条刷新/多卡判定);既有断言更新 2 处(逐条 index 刷新形态、多条硬失败缓存形态)。
- 全量通过(TZ=本地 +8 与 TZ=UTC 双跑);lib/client.js 重建(257,961 字节,上限 262,144)。

## [1.6.13] - 2026-08-31

### 新增(issue #78:千问 Qwen Token Plan)

- **千问 AI 平台(platform.qianwenai.com)Token Plan 个人版接入**:设置 → Coding Plan 新增「千问 Qwen Token Plan」卡片,支持侧边栏/设置页展示月度 Credits 用量百分比与已用/总额文本。
- **实现方式:本地 Credits 计量(SCNet 同模式)**——调研确认千问平台未提供 API-Key 化的额度查询端点(额度仅控制台可见,查询需浏览器 cookie + 网关 sec_token 会话,第三方 CLI 无法安全复用);与 SCNet 一致按官方 Credits 抵扣率对本地账本估算当前计费周期(自然月或订阅锚日)用量,无需任何凭据,不发起网络请求。
- **内置抵扣表**:Token Plan 个人版 10 个文本模型(qwen3.8-max-preview / qwen3.7-max / qwen3.7-plus / qwen3.6-flash / glm-5.2 / deepseek-v4-pro / deepseek-v4-flash / kimi-k2.7-code / kimi-k2.6 / minimax-m2.5)的输入/缓存读/输出三费率(每百万 token 抵扣的 Credits);模型名归一比较(大小写/连接符差异等价),不在表内且未手动指定的模型不计入。
- **可配置**:月度 Credits 额度、订阅起始日(留空按自然月)、逐模型抵扣率覆盖(官方调整费率或表外模型可手动指定);非法值经配置清洗收敛(额度缺省 500000,费率仅正有限数保留)。
- **计费归类**:qwen 渠道默认 `auto`(启用即按 Plan 类,金额只记等值不动真金白银,与 SCNet 一致);plan-billing 默认表与域名白名单(package.json dshhub 权限)同步登记。

### 验证

- verify.mjs 新增 2 个回归块:估算窗口(抵扣表折算含 cacheWrite 并入未命中/归一模型合并/覆盖优先/周期外日期不计/未匹配不计/非法额度 null)与配置清洗 + 默认归类 + 接线哨兵 + e2e(启用后快照状态/窗口/strict codec)。
- 全量通过(TZ=本地 +8 与 TZ=UTC 双跑);lib/client.js 重建(253,754 字节,上限 262,144)。

## [1.6.12] - 2026-08-29

### 修复(issue #77:压缩摘要调用漏计,compaction/summary 不进折叠)

- **报告**(lizhuojunx86):压缩(compaction)摘要调用是一次真实的 provider 计费(把旧上下文发给模型总结),usage 记录在 `compaction/summary` 事件上——但该事件是 log-only、不是循环步,折叠此前只认 `assistant/chunk` 与 `assistant/message` 两种事件,摘要调用的 token 全部漏计(报告者语料:3 次压缩共 48,895 token,单次 MiniMax-M3 摘要 44,444 token)。上游 DSH 自己的投影也有同样缺口(tokscale 已在 junhoyeo/tokscale#1162 侧修复)。
- **核实**:摘要调用走 `ctx.llm.stream()`(上游 summarizer.ts `llmStreamCall: true`),**实时账本钩子本就覆盖**(侧边栏今日费用/账本不漏);漏的是会话投影(徽章)与历史回放。
- **修复**:投影折叠与历史回放计入 `compaction/summary` 的 `data.usage`(可选字段,缺省不入账)——归因优先用事件自带路由(两代宿主形态 `data.message.source.{provider,model}` 与 `data.{provider,model}` 都兼容),缺省回落 header 计费口径;摘要样本用独立去重键 `compaction:<seq>`(不占 `(turn, step)`,与循环步的样本替换互不干扰);豁免包装层指纹窗口(单源事件,无转发对,消除与邻近循环步同指纹的极小误杀面)。
- **stateVersion 7 → 8**:触发宿主对旧 checkpoint 全量重放,历史会话的摘要用量随之补齐(v1.6.11 的包装层改挂计数也一并自愈)。

### 验证

- verify.mjs 新增 2 个 v1.6.12 回归块:折叠(两代路由形态/缺省回落/无 usage 不入账/包装改挂/与邻近循环步同指纹互不误杀)与回放(计入摘要 + 折叠/回放净聚合逐位一致漂移守卫);stateVersion 哨兵更新。
- 全量通过(TZ=本地 +8 与 TZ=UTC 双跑);客户端未改动,lib/client.js 无需重建。

## [1.6.11] - 2026-08-29

### 修复(issue #76:modlens 包装路由整单漏计)

- **根因**:`modlens-go-ds4f` 命中包装层判定(`modlens-` 前缀),而 #70 时代的修复对包装层 provider 的 usage **一律丢弃**、只记「上游真实流」——当整条链路都是包装型 id(modlens 转售路由,上游不产生独立非包装流)时,唯一到达的 usage 也被丢弃:会话日志有 usage、账本 sessions=0、今日费用恒 ¥0。同一缺陷也存在于会话投影(徽章恒 0)与历史回放。
- **修复:指纹窗口去重取代「一律丢弃」**(lib/usage-dedup.js,账本入账钩子/投影折叠/历史回放三入口同语义):包装层样本先经 `wrapperUpstreamProvider` 改挂上游 id,再按 `(model, 五桶逐位指纹)` 10s 窗与已计入样本互斥——#70 的急切转发对无论到达顺序只记一次(语义保持),包装层单链照常入账(不再漏计);合法的两次同量普通调用互不去重(与旧行为一致,零回归)。
- **回放两遍扫**:历史回放对完整会话日志先收集非包装指纹集再逐事件判定,与实时折叠同结果(回归测试锁定双序一致性)。
- **provider 硬化**:非字符串 provider(日志实测 `[object Object]` 形态)归一为空串,按缺省渠道入账,不产生脏键。
- 注:此前被整单丢弃的 modlens 调用无账本数据可恢复,只有此后发起的调用会入账。

### 修复(issue #76 附带:本地模型被按云端价误计)

- **根因**:本地网关模型(如 `lmstudio:qwen3.8-9b-heretic-uncensored-i1`)经跨厂商兜底的模糊匹配误套同家族云端价(实测按阿里 `qwen3.8-max` 单价 64 次多计 $3.29)。
- **零价守卫**:价格解析在覆盖之后、目录匹配之前对本地来源直接判未定价(token 照记、费用 0);本地来源判定覆盖 provider(lmstudio / ollama / jan / gpt4all / koboldcpp / llamacpp / localai / **vllm / sglang / tabbyapi / lmdeploy / oobabooga / text-generation-webui / llama-server**)与模型 id 前缀(`lmstudio:` / `ollama:` / `vllm:` / `sglang:` / `gguf:` / `local:` 等)。
- **一次性清洗迁移 `local-model-unprice-v1`**:历史存量中本地来源桶的费用归零(token 保留,日/会话合计同步扣回,幂等)——报告者 8/28 被多计的 $3.29 即由此修正。
- **显式覆盖仍可定价**:priceOverrides 把本地模型改指任意条目时自然放行(逃生门)。

### 新增(UI:已命中模型可改映射 + 本地模型零消耗)

- **「本地模型(零消耗)」覆盖哨兵 `__local__`**:模型名匹配的目标下拉新增该选项;服务端把它解析为未定价(token 照记、费用恒 0),写入 `updateConfig` 时**历史桶即时归零**(幂等;取消标记后历史 0 值不自动回溯)。
- **「本月已命中价格的模型」区块**:设置页此前只能为「未命中」的模型手动指定条目;现把本月已自动命中的模型同样列出,行内选择目标即可改挂其它条目或标记为本地模型,写入后转入手动指定区。界面中英双语。

### 改进(今日费用实时化)

- **此前「今日费用」更新慢的原因**:侧边栏依赖 `getState` 快照,而客户端**纯 60s 轮询、无推送通道**(流结束入账是即时的,写盘防抖仅影响持久化不影响 UI)——对话结束后平均要等 30s、最坏 60s 数字才变;「本会话费用」徽章走宿主投影推送所以实时,反差更明显。
- **投影联动刷新**:客户端监听 costUsage 投影(宿主在每次 usage 入账时推送)的变化,800ms 防抖触发一次 `getState`——今日费用在**流结束后 ≈1s** 更新;60s 轮询保留作兜底。
- **getState 供陈值(serve-stale)**:有过任一快照后,过期的余额/额度刷新转入后台,getState 立即用现有值返回——ambient 快照不再被 15-20s 的网络查询内联阻塞;首次加载仍内联等待保证首屏真实数据;显式点击刷新保持内联强刷。

### 验证

- verify.mjs 新增 9 个 v1.6.11 回归块:去重器单元(改挂/双序互斥/窗口过期/普通互不去重/硬化)、投影折叠(包装单链计入/急切对单记/旧 checkpoint 兼容/recent 有界)、回放两遍扫、本地零价 + 覆盖逃生门、清洗迁移幂等、`__local__` 哨兵(解析/入账/updateConfig e2e/strict codec)、客户端镜像双侧漂移守卫、实时化接线哨兵。
- 全量通过(TZ=本地 +8 与 TZ=UTC 双跑);`node scripts/build.mjs` 重建 lib/client.js(249,751 字节,上限 262,144)。

## [1.6.10] - 2026-08-29

### 修复(issue #74:跨天会话「今日 ¥0」)

- **结论先行:归账口径本就正确**——`Ledger.account()` 的日键取**每次调用的发起时刻**(与官方请求侧计费同口径,v1.6.6),跨天会话按调用发生日拆分:同一会话 id 在每个发生日各有条目与会话行,token/费用独立。本次新增行为级测试锁定该保证(时间戳按「今日本地午夜 ±60s」构造,任意时区自洽,本地 +8 与 CI UTC 双跑验证)。
- **真正的根因:宿主进程时区与用户浏览器时区错位**——「今日/本月」日键按宿主机进程时区取(账本由服务端持久化,日键必须与查看端无关,这是刻意设计);当宿主跑在 UTC 而用户在 +8 时,本地午夜后(0-8 点)的调用记前一日——「今日」显示 ¥0、官方余额对账报偏差、月合计正常,与 #74 的全部证据吻合(账本无当日键、凌晨调用在前一日、12:58 会话正常)。此前 UI 对这种错位无任何提示,极易误判为漏计。
- **修复**:宿主在 `meta.timezone`(可选键,有值才携带)下发 IANA 时区名(偏移 `meta.timezoneOffsetMinutes` 原本就有);客户端检测到与浏览器时区偏移不同时,在概览页口径脚注下方显示双语提示——说明「今日/本月按宿主机时区统计、本地午夜后的调用记前一日(并非漏计)、可在宿主机以本地时区运行 dsh 对齐」。

### 验证

- verify.mjs 新增 v1.6.10 回归块:跨天归账行为锁定(两日条目/会话行按日重开/at 取当日首次调用/today() 可见);e2e `getState` 的 `meta.timezone` 下发与 strict codec;客户端 `formatTzOffset`/`timezoneMismatchOf` 行为(同偏移不提示、错位提示、无 IANA 名回退纯偏移、非法不误报);宿主/客户端/schema 接线源哨兵。
- 全量通过(TZ=本地 +8 与 TZ=UTC 双跑);`node scripts/build.mjs` 重建 lib/client.js(246,156 字节,上限 262,144)。

## [1.6.9] - 2026-08-28

### 修复(计费审计:客户端/服务端口径漂移)

背景:对全仓计费与核心链路做了一次完整代码审计(报告:[docs/code-audit-2026-08-28.md](docs/code-audit-2026-08-28.md))。核心计费链路(实时钩子 → 账本 → 投影 → 回放/回填 → 双轨 apiCost)复核无误;本版修复审计确认的三处客户端漂移与三处服务端加固。

- **官方余额条「当日已用」漏计 `deepseek-official` 键(客户端)**:`todayOfficialUsd` 只把 provider 前缀为 `deepseek` 的桶计入官方渠道,而 profile 内置官方路由实际落账键形如 `deepseek-official:模型`(v1.6.5 服务端已确认)——侧边栏官方余额进度条的当日段在纯官方路由账本上恒为 0/偏低,且与服务端 `officialCostOfDay`(双前缀口径)数字不一致。修复:客户端补 `deepseek-official` 双前缀判定,并同口径剥离宿主包装路由 `llm-` 前缀。
- **客户端回退计价丢失峰谷子档(峰时低估约 50%)**:`normalizeClientPrice` 只保留 `{cacheHit,cacheMiss,output,reasoning}`,把 `offPeak/peak/legacyBase` 子档剥掉;`usageSplit`(会话含 Plan 类模型时的 API/Plan 拆分路径,以及旧快照缺精确成本时的回退路径)据此调 `tierFor`,峰时只能取基础档(=谷价)。实测:峰时 2M 输入 + 1M 输出,服务端 $2.20、客户端回退估 $1.10。修复:子档随主档一并保留(`normalizeClientTier` 与服务端 `completeTier` 同口径),客户端 `tierFor` 补峰谷时代分界 `legacyBase` 分支——四相位(峰/谷/周末/分界前)档位与金额恢复与服务端逐位一致。
- **decimals=0 显示被抬成 2(客户端,纯显示)**:`formatMoneyValue` 的 `Number(config?.decimals) || 2` 把合法的 0 抬成 2,与服务端 `formatMoney`(专门修过同款坑并注释)实现漂移。修复:0 保留,缺省才回落 2。
- **官方渠道判定补 `llm-` 前缀剥离(服务端 `officialCostOfDay`)**:计价(`providerPriceEntryFor`)与 Plan 归类(`planProviderIdOf`)都会剥宿主包装路由的 `llm-` 前缀,官方渠道判定此前不剥——`llm-deepseek` 形态落账会被漏计。现剥前缀后判定(`llm-zen` 等第三方网关仍不计入)。
- **包装层重复清洗保留键优选(服务端 `repairProviderDupes`)**:指纹分组此前恒保留字母序第一个键,而 `deepseek-modlens:` 恰排在 `deepseek-official:` 之前——官方键被删、包装层键存活,需依赖后续 `modlens-wrapper-dedup-v1` 形态 3 改挂才恢复正确。现排序优先保留非包装层(上游真实)键,同包装层性时仍按字母序;合并语义不变。
- **`tierFor` 对 NaN 生效时刻口径归一(服务端 + 客户端)**:`effectiveAtMs` 为 NaN 时,`isPeakHour` 视作已生效而 offPeak 分支视作未生效——谷时段落 base 档、峰时段取 peak 档的不对称。现非有限值一律归一为「未知生效时刻」,两侧同口径(默认表 base=offPeak 同值,实际行为不变,仅消除 footgun)。

### 修复(CI:install-smoke 两腿回归门禁红)

- **时区炸弹:自然月用例硬编码期望值,v1.6.8 起回归门禁进 CI 后首跑即红**:`scnetPlanPeriod` 自然月用例断言输入 `2026-08-01T00:00:00+08:00` 的周期起点恒为 `'2026-08-01'`,而实现按**运行时本地日历**取自然月——CI(UTC)上该时刻是 7 月 31 日,函数正确返回 `'2026-07-01'`,ubuntu(51s)与 windows(9m59s,大头是 pnpm 安装耗时)两腿同断言失败。修复:期望值改由测试进程本地日历推导(起点取 `new Date(p2Now)` 的年月、月末同法),断言与实现同口径、任意时区自洽;本地以 TZ=UTC / UTC-8(洛杉矶)/ UTC+14(基里巴斯)/ UTC+8 四种时区全量复跑通过(Windows Node 支持 TZ 环境变量,可在本机模拟 CI 时区)。

### 已知边界(复核确认,文档化,本版不改)

- `repairProviderDupes` 的跨渠道指纹合并是启发式:两个真实渠道的桶六值全等且模型同名时会被误合并(一次性迁移,`provider-dedup-v1` 已打标不再重跑,存量风险有限);`deepseek-modlens-vision` 等深层变体不在 `isWrapperProviderId` 判定范围,同组无上游键时仍按字母序保留(既有测试 8g 语义)。
- billing-stream ALS 嵌套标记的设计边界(R-7,源码注释已声明):若未来包装路由改为「拉取期惰性」发起上游流,需改按流实例区分标记;当前 modlens 实测为瀑布派发期急切发起,语义正确。
- `canonicalWindowKey('2d') → weekly` 等滚动窗量级归并为刻意近似(源码注释已声明)。

### 验证

- verify.mjs 新增「v1.6.9 计费审计回归」块:NaN 生效时刻与 undefined 双口径一致;`llm-` 前缀官方渠道判定(llm-deepseek 计入 / llm-zen 不计);保留键优选(成对镜像保上游键 + 无包装层组仍按字母序的对照);**客户端助手区段抽取行为级漂移防护**——从 `src/client.js` 抽取纯计费助手在 Node 求值,断言子档保留、四相位档位与金额双端逐位一致、峰时金额级佐证(0.44/M,修复前 0.22)、decimals=0、`todayOfficialUsd` 双前缀。
- 测试 8g 注释补充深层变体保留原因;issue #36 源哨兵更新为双前缀判定。
- `node test/verify.mjs` 全量通过;`node scripts/build.mjs` 重建 lib/client.js(244,427 字节,DSH STORE 单文件上限 262,144)。

## [1.6.8] - 2026-08-28

### 修复(密钥治理,安全专项)

- **API Key 明文落盘(P0)**:v1.6.7 及更早把整个 config 原样序列化进 `$DSH_HOME/storages/cost-meter/ledger.json`——其中含 `goQuota.apiKey`、9 家 `codingPlans[*].apiKey`、火山方舟 `accessKeyId/secretAccessKey`,且写入未指定 mode(POSIX 下 0644),本机实测账本里存有两把明文 `sk-` 密钥。修复:新增 `stripSecrets`(store.js)——`flush()` 序列化前清空全部密钥字段(空占位字符串保形,strict codec 不受影响),**内存 config 仍保留明文供运行时解析兜底**;`applyConfigPatch` 最底层入口新增 `stripSecretPatch` 闸门,密钥不再能经配置补丁回到 config(updateConfig、测试、未来新增 RPC 一并受保护)。
- **密钥明文回传前端(P0)**:`buildState` 把 `ledger.config` 原样下发、`mergedCodingPlans()` 再带一次 `apiKey`——前端 `type="password"` 只是 UI 掩码,值早已抵达浏览器。修复:`buildState` 转异步并下发 `stripSecrets` 后的副本;`mergedCodingPlans` 转异步,`apiKey` 恒为空串,改以 `keyConfigured/keySource`(来自凭据库 `describe()`,该接口专为配置 UI 设计、永不返回值本身)描述配置状态;前端设置页全部密钥输入框(OpenCode Go / 各 Coding Plan / 火山 AK/SK)替换为 write-only 的 `CredentialField` 组件——值只沿 `setCredential` 单向上行,保存后不回显,仅显示「已配置(来源 x)」状态;新增 `SecretMigrationNotice` 组件提示未能自动迁移的密钥。

### 改进

- **密钥统一由 DSH 凭据库托管**:新增 `setCredential(target, value)` / `clearCredential(target)` 两个 RPC(`target` ∈ `goQuota` | `codingPlans.<id>` | `codingPlans.volcengine.ak` / `.sk`),值只进宿主凭据库(`credentials.set/unset`),不再经 `updateConfig` 传递;读路径优先级调整为 **DSH 凭据库 → 环境变量 → 自动发现(opencode auth.json / Claude 登录态)→ config 遗留明文兜底**(末位兜底保证迁移时间窗内功能不中断),每次 per-operation 重新 resolve 不缓存。
- **存量明文自动迁移**(升级即迁移):新增带 ctx 的异步启动钩子 `runSecretMigration`(挂在 `apply()` 内与历史导入同一个 3 秒延迟定时器,**先于**回填执行),把账本遗留明文逐项导入凭据库后清空 config 字段,迁移 id `secrets-to-credential-store-v1` 记入账本 migrations 防重跑。逐项四种结局:① 凭据库/环境已有值 → 只清空遗留明文,不覆盖;② 可写 → `set()` 成功后清空;③ 不可写且未配置 → **原样保留明文**并记入 `secretMigrationPending`(UI 提示手动导出对应环境变量),下个启动周期重试——绝不静默丢弃用户密钥;④ describe 不可用(宿主版本较旧)按③处理。火山 `AKID:SK` 整串先拆成 AK/SK 两字段再导入;全部处理完后立即落盘。
- **自定义余额端点收紧**:`customBalance.request.url` 强制 https(明文 http 直接报错);`fetchWithRetry` 显式 `redirect: 'manual'` 并拒绝 3xx 响应——禁止自动跟随重定向把凭据头转发到其他主机;请求头含凭据占位符(`{{VAR}}`)时,目标主机不在 `customBalance.allowedHosts` 白名单内则拒绝,未配置白名单则放行但警告提示收紧。
- **权限声明补真**:`dshhub.permissions.network` 从 4 个域名补全为代码实际出站的 16 个(opencode.ai、api.anthropic.com、api.z.ai、open.bigmodel.cn、www.minimaxi.com、www.minimax.io、api.kimi.com、api.moonshot.cn、openrouter.ai、api.siliconflow.cn、api.commandcode.ai、ax.ac.sugon.com + 既有 4 个);README 中英版补「密钥不落盘 / write-only 输入框」与「额度类端点仅在显式启用对应 Provider 时出站」说明。

### 工程化

- **CI 接入回归与产物门禁**:install-smoke workflow 在安装冒烟后追加 `node test/verify.mjs` 回归与 `node scripts/build.mjs && git diff --exit-code lib/client.js` 产物漂移检查(lib/client.js 是提交进仓库的压缩产物且无 prepack 钩子,此前全靠手工构建,实测发生过漂移);package.json 新增 `npm test` 与 `engines: node>=20`(与 dshhub.compatibility 对齐)。
- **CodeQL 误报抑制**:#10(`test/check-opencode-catalog.mjs` 价目表单元格文本提取)与 #7(`test/verify.mjs` 充值链接存在性断言)均为测试断言而非安全净化,按真实告警规则加 `codeql[...]` 抑制注释;补发 v1.6.4 / v1.6.5 / v1.6.6 三份 release notes。

### 破坏性变更

- 密钥配置方式变更:设置页密码框从「可回填值的掩码框」变为 **write-only**(保存后不回显,只显示配置状态);升级后首次启动会自动把存量明文密钥导入 DSH 凭据库,宿主凭据服务不可写的场景下密钥保留在账本中并提示手动导出环境变量(见升级说明)。

### 验证

- verify.mjs 新增「密钥治理」回归块:`stripSecrets` 输出与 `flush()` 落盘文件不含任何密钥明文(空占位保形)、真实 `apply()` → `getState()` 下发 state 不含明文且可过 getState strict codec(新增 `secretMigration` / `keyConfigured` / `keySource` 字段已入 schema)、迁移五路径(成功 / 已配置不覆盖 / 不可写保留 + pending / 幂等零重复 set / 火山 AKID:SK 拆分)、`setCredential`/`clearCredential` descriptor 双侧对齐与 write-only 组件接线、配置补丁密钥剥离闸门。
- `node test/verify.mjs` 全量通过;`node scripts/build.mjs` 后 lib/client.js 无漂移并同步提交(243,991 字节,DSH STORE 单文件上限 262,144)。

## [1.6.7] - 2026-08-27

### 修复(计费正确性)

- **价格同步把「峰谷生效时刻」重置为「现在」,峰时历史事件被半价重算(高危)**:官方价格页已无「生效时间」字段,`parsePricingHtml` 恒返回 null,`fetchPrices` 的兜底分支于是把 `peakEffectiveAt` 写成同步时刻——此后任何历史重算(会话投影 refold / 按模型回填)中,同步时刻之前的峰时事件全部回落基础档(= 谷价,半价);用户账本实证该键两次被重置为同步时刻(与 fetchedAt 逐毫秒相同)。修复:官方页无生效时间时不再改写该键(删除 else 兜底);新增幂等迁移 `peak-effective-at-clamp-v1` 把存量账本的 `peakEffectiveAt` 钳制到 2026-08-16 16:00 UTC 历史分界(tierFor 的硬编码分界先行生效,≤ 分界的取值对全部历史判档均正确,顺带修复已被污染的配置)。
- **币种切换不重算历史 → 新旧口径并存(用户「误差更大」的直接来源)**:切到 CNY 后价格表换 ¥ 价而存储账本不动(USD 口径),会话徽章(投影 refold 按当前表重算)却是 CNY 口径——插件自身两个表面对同一天差 ~5%。修复:新增 `recomputeLedgerPricingBasis`(backfill.js)——全量回放会话日志、按当前价表 + 修正后的生效时刻逐事件重定价,回放覆盖完整的日子整体替换,日志已清理的会话保持原口径,重算后跑 `splitLedgerApiCost` 防 apiCost 倒挂;触发点两处(设置页改「价格币种」/ 官方页同步前后币种翻转),异步执行让出事件循环,完成后提示重算天数与会话数;升级迁移 `currency-basis-recompute-v1` 对存量混口径 CNY 账本自动重算一次;设置页「价格币种」说明改为新语义(切换即全量换基准)。
- **已知近似(文档化)**:客户端回退计价(会话徽章的估算路径)以当前时刻档位给全部桶定价——含 Plan 类会话的徽章估算在峰时会高估谷时部分;README 中英版「已知限制」补充说明,精确金额以账本为准。另:#65 的 6 倍高估形态与 #62 修复前(CNY 数字按 USD 计)+ 环境不报缓存字段的历史组合吻合,现行代码端到端验证无此问题,升级即解。

### 验证

- verify.mjs 新增:effectiveAt 源哨兵(同步不再写键)、tierFor 半价缺陷回归(污染时刻 vs 分界时刻恰为两倍)、clamp 迁移幂等、USD 口径账本切 CNY 重算后 = CNY 口径(含峰时事件 2 倍档)端到端断言。
- 真实账本影子验证(副本,不落盘):今日总额 ¥5.8315(USD 口径)→ ¥5.7369(CNY 口径,vision 峰时按 2 倍档),与官方 ¥5.64 偏差从 ~3.4% 收窄至 ~1.7%;残差来自日志覆盖不全而保持原口径的会话,符合设计。

## [1.6.6] - 2026-08-27

### 改进

- **峰谷档位改按请求发起时刻判定**:流式调用可能跨峰谷边界整点——一次 17:59 发起、18:01 完成的调用,按完成时刻归档会被算进谷时档,而官方口径为请求侧计时。billing-stream 现在在瀑布分发(即请求发起)时刻捕获时间戳并传给账本,`deps.now` 作为可注入时钟供测试使用;verify.mjs 新增开始时刻传递断言与跨整点两侧费率恰为两倍的金额级佐证。消除跨点调用的档位分歧(vision 实测案例)。
- **概览页新增口径脚注**(用户实测对账疑问驱动):汇总卡片下方固定一行双语说明——本地金额为最近一次落盘快照(2 秒防抖,正常关闭先强制落盘),与官方实时账单存在分钟级时差属预期;关停瞬间仍在途的流被服务端照常扣费而 usage 无人接收;tokens 列为五桶合计且 reasoning 由 API 单列上报但不计费(官方并入输出列展示),对账以金额为准。README 中英版计费规则同步补「峰谷发起时刻」与「官方账单对齐口径」两条。

## [1.6.5] - 2026-08-27

### 修复

- **官方余额对账双错:今日官方费用恒 $0 + ¥ 变动错标 $(用户实测反馈)**:① 官方渠道判定只认 `deepseek` 前缀键,而 profile 内置官方路由的实际 provider id 是 `deepseek-official`(账本键形如 `deepseek-official:deepseek-v4-flash`)——「今日官方渠道费用」与余额条「当日已用」恒为 $0.0000,CNY 余额一旦减少必然误报 drift;② 对账比较直接拿「¥ 计价的余额差」减「USD 计价的本地账本」,跨币种错配,¥ 账号即使有正常消费也几乎恒报 drift。修复:渠道白名单补入 `deepseek-official`;余额差先按 `config.exchangeRate` 折算为 USD 再比阈值(事件携带原生币种/原生金额/折算值);提示文案的变动金额按余额真实币种取符号并附 ≈USD 折算参考(zh/en 模板零改动)。`deepseek:v4:x` 这类模型名含冒号的键取前缀判定不受影响;go/zen 等第三方网关仍不计入。

## [1.6.4] - 2026-08-27

### 修复

- **全新安装报 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`(issue #72)**:生产依赖此前是浮动区间(`^0.1.0-rc.6`、`^4.4.3`),首次安装时 pnpm 会把区间解析到**当时最新发布版**——实测 `^0.1.0-rc.6` 漂到 2026-08-19 才发布的 rc.8;启用了「最小发布年龄」供应链策略的 pnpm 环境(pnpm 配置或上层安装器自带)在校验 profile lockfile 时直接拒绝这类过新条目,一键安装失败。三个运行时依赖 `@deepseek-ai/dsh-credentials`、`@deepseek-ai/dsh-home-paths`、`zod` 全部改为精确锁版:锁定版本的发布时间是固定值,对任意年龄阈值永远满足,该错误对本插件不再可能复发。附带说明:插件仓库内的 `minimumReleaseAgeExclude` 只在本仓开发/CI 安装(读取本仓 workspace 配置)生效,end-user 安装的外层校验读取的是 profile 目录自己的配置,不能替代锁版——文件内已加注释固化该边界,排除表补入 `esbuild@0.28.1`;README 中英版安装章节同步新增该错误的排障条目。

## [1.6.3] - 2026-08-27

### 修复

- **modlens 视觉包装层重复计费(issue #70,报告 @lucas-wang-1)**:modlens 插件为承载纯文本模型的 provider 路由自动注册 `modlens-<upstream>`(官方路由为 `deepseek-modlens`)视觉包装模型,并在监听器体内再发起一次上游 `llm.stream` 转发同一份 usage——该内层分发逃逸 billing-stream 的 ALS 嵌套深度标记,实时钩子、会话投影与历史回放照单全收,同一次调用在上游与包装层两个 provider 键下各入账一次,token/费用整体翻倍。新增统一判定 `isWrapperProviderId` / `wrapperUpstreamProvider`,三个计费入口(实时 llm/stream 钩子、costUsage 投影、backfill 回放)对包装层 provider 事件一律跳过,只记上游真实流。
- **modlens 历史翻倍账本一次性清洗(迁移 `modlens-wrapper-dedup-v1`)**:与 #48 指纹合并(provider-dedup-v1,保留字母序第一个键)的遗留交互区分四种形态逐容器(day 与其下每个 session)修正——镜像对扣除包装层份;#48 合并残留 + 新镜像混存(上游 ⊆ 包装层)扣除上游键、包装层全量改挂上游;仅包装层入账的残留改挂上游;同日直连 + 包装混存(包装层 ⊆ 上游)扣除纯镜像份。互不为子集的条目保守不动;改挂后按新 provider 重算 plan/api 分类;幂等。
- **火山方舟 Coding Plan 额度解析失败(issue #71,报告 @suyukun)**:管控面 Action 白名单缺 `GetCodingPlanUsage`——该接口才是 CodingPlan 官方用量接口,无参即返回 `Result.QuotaUsage[]` 三窗(session/weekly/monthly,只含 `Percent`);而位列首位的 `GetAFPUsage` 实为 AgentPlan 接口,CodingPlan 用户拿到全 0/空。`GetCodingPlanUsage` 置于白名单首位,解析器补 `QuotaUsage` 数组与 `Level` 窗名字段(session/weekly/monthly),原 Action 保留作兜底变体。

## [1.6.2] - 2026-08-26

### 修复(计费逻辑专项审计)

- **客户端回退计价金额放大汇率倍(高危)**:设置页 `parseConfig` 白名单丢失 `prices.currency`——官方价格币种为 CNY 时,会话徽章/明细的回退估算不除汇率入账,展示时又乘回汇率,金额被放大汇率倍(默认 7.2×)。补齐白名单键。
- **第三方模型「取消挂载」永不生效**:`applyConfigPatch` 只对 DeepSeek 主表 models 做替换语义,`prices.providers[*].models` 走深合并把已删除模型原样复活,下次轮询重新出现在价格表。补齐同款替换语义。
- **自定义余额空值强转残留(B-3 变体)**:`extractByRule` 内部 `Number(null)/Number('')/Number(false)` 均为 0 并通过 isFinite 守卫,提取失败仍可伪造成「余额 $0 / 预算打满」的成功读数;subtract/add/divide 成员缺失也静默按 0 参与运算。改严格数值解析:null/布尔/非数值串一律 fail-loud。
- **模型名匹配数字分叉绕过(issue #18 残留)**:跨版本守卫此前只在家族 token 阶段,宽泛包含/前缀/token 耗尽三条路径仍会把 `glm-5.3` 匹配到 `glm-5`(实测低计 ~29%)、`gpt-5.9` 匹配到 `gpt-5-nano`。三个阶段全部补齐守卫(≥3 位日期快照与 `-128k` 容量后缀不受影响),pricing.js 与 client.js 镜像同步。
- **usage:null 击穿判空**:投影与计费流对 usage 块用 `!== undefined` 判空,null 可通过——宿主异常收尾路径会打断成本投影,或用 null 覆盖已捕获的有效 usage 快照导致整次调用漏计。统一改 `!= null`。
- **Anthropic 子配额窗口覆盖主周窗**:`seven_day_sonnet` 等子配额与主窗共用归一键,后解析者覆盖采样列与面板百分比(`seven_day: 12%` 显示成 sonnet 的 3%),周窗满窗估算严重偏低。子配额窗口整体丢弃,只保留主窗口。
- **MiniMax 双域 Key 401 不换域重试**:国际域(minimax.io)发放的 Key 在国内域(minimaxi.com)首端点即报「凭据无效」,第二域永远轮不到——与 zai/kimi 双域同待遇(issue #42 同型),单域 401 继续换域尝试。
- **清空价格档被写成显式 0 价**:价格输入框全选删除后空串按 0 提交并持久化,该档位之后所有调用静默变免费;汇率清空则触发整包校验报错。输入组件新增 emptyMode 三档语义:offPeak/peak 清空删档恢复「无档按基础价计」、基础价/第三方三桶/汇率忽略清空、预算等 0 为合法值的场景保持不变。
- **官方余额符号错位**:¥ 计价的官方余额在 USD 显示档渲染成 "$53"(数值不换算、符号却切换)。符号改按 `balance.currency` 取,与数值同币种。
- **客户端跨厂商兑底 billingMode 失步**:徽章回退计价硬编码 flat,服务端同路径保留峰谷两档(billingMode),口径漂移。与服务端 bestMode 对齐。

### 加固

- `splitLedgerApiCost` 以容器 cost 封顶 apiCost:桶级合计异常超过容器总额时不再下发 apiCost>cost 的倒挂数字(下次冷加载钳制前)。
- backfill「全覆盖重算」判定补 reasoning 字段:旧样本缺失 reasoningTokens 时其余四桶恰好相等,会以不含推理成本的回放值无痕覆盖当日 cost;会话级 reduce 同步补齐。
- Kimi 滚动窗命名(`'1w'/'2d'/'30m'`)在 `canonicalWindowKey` 按时间量级归入最近标准周期,不再落进 periodStartOf 的 48h 兜底导致满窗估算单位错配(分钟级维持原样;窗口键名不变)。
- 中文峰时段窗口解析允许省略冒号/空白(`北京时间9:00` 紧凑排版),解析失败静默沿用上一次同步旧窗口的隐患消除。
- 投影去重键 turn/step 缺省值与 backfill 回放器对齐(`?? 0`),实时与回放对同一事件产生同一去重键。
- `fetchWithRetry` 单次尝试超时信号与调用方取消信号用 AbortSignal.any 组合,不再无条件吞掉外部 signal。
- hunyuan-a13b 目录价由 CNY 原值(¥0.5/¥2)改为按默认展示汇率折算的 USD($0.0694/$0.2778)入账,消除 ~7 倍高估。

## [1.6.1] - 2026-08-26

### 修复(全仓安全审计)

- **账本退出丢写(高危)**:`Ledger.close()` 先置 `closed` 再调 `flush()`,而 `flush()` 对 closed 状态直接返回——「卸载/退出前最终落盘」从未生效,每次进程退出丢失最后 ≤2 秒防抖窗口内的全部入账。现先强制落盘再关门;顺带修复写失败后 `pendingWrite` 已复位导致数据永不重试的问题(失败自动按防抖重排,关门前不丢)。
- **发版脚本命令注入(高危)**:`scripts/release.mjs` 把取自 UPDATE-HISTORY 标题的发布标题未转义拼进 `execSync` shell 串——恶意 PR 可在维护者发版机上以仓库凭据执行任意命令。全部改为 `execFileSync` 数组参数绕开 shell,并新增 tag 格式白名单校验。
- **面板空指针崩溃(高危)**:Go 额度框对 `monthly` 窗口未判空(rolling/weekly 均有守卫),宿主下发单窗空值时整个渲染树崩溃。补齐空值守卫,与侧边栏口径一致显示 '—'。
- **路由调用小时桶漏记(计费正确性)**:provider 为空/'deepseek' 且命中第三方目录的路由调用被归为 plan 类却不写 provider×小时桶,而整天段聚合又计入——今日段本地量系统性偏低,额度估算同步失真。现在 account 与聚合共用同一路由兜底判定(`isRoutedThirdPartyCall` 转正为导出)。
- **官方余额对账告警失效**:客户端 `parseState` 重建 state 时丢弃宿主下发的 `reconcile` 字段,漂移警告 ⚠ 永不显示。补齐解析。
- **自定义余额提取失败误显 $0**:`extractByRule` 失败返回 null 而 `Number(null)===0`,提取规则配错时静默变成「余额 0/预算打满」的正常读数。null 不再被当作 0,缺失/非法照常报错。
- **历史重算后 apiCost 倒挂**:backfill 按事件时刻重算容器 cost 后不重算 apiCost,向下修正出现 apiCost>cost 的双轨倒挂。重算末尾统一跑一遍幂等的 `splitLedgerApiCost`(有变化才触发落盘)。
- **非法会话条目残留空指针**:`sanitizeDays` 对损坏会话 `continue` 保留 null 元素,后续 `account()` 的 `sessions.find` 读 `.id` 即崩。改为原地过滤剔除。
- **计费流中断泄漏**:llm/stream 计费包裹在消费方提前 break 时从不关闭下游迭代器——上游请求继续跑到完(厂商照扣全额)而 usage 无人消费。finally 中向下游传播取消(`iterator.return`)。
- **额度查询击穿回退链**:coding-plans 非 volcengine 路径的 `response.json()` 无保护,200+HTML(Cloudflare 页)直接抛异常冲出多端点串行回退。补 try/catch 归一为软错误继续下一端点。
- **DeepSeek 分支价格条目未规范化**:同函数内 provider 分支与跨库兑底均做 normalizePrice,唯独 DeepSeek 直查路径原样返回——两桶简写配置产出 NaN 成本入账。全路径统一 normalize。
- **SCNet 订阅周期末日少一天**:显式 planStart 时周期末日落在次月对应日前一天,对应日全天用量滚入下期、resetAt 显示偏早。改用排他次日边界(含对应日 23:59:59.999)。
- **设置页自动保存基线竞态**:防抖保存 diff 对最新服务端配置比较,并发写入方(另一窗口/引导按钮/轮询)的键会被草稿旧值回滚。改为每份草稿冻结基线(frozen baseline)后再 diff。
- 其余批次:历史表格并行加载互斥导致的假「暂无会话」、会话排行乱序响应覆盖、「添加模型」首帧空指针、Codex 徽章误随 Coding Plan 开关隐藏、token 格式化 1000K 边界、numInput 负数入参、峰谷生效时刻非法日期静默失效、Kimi/MiniMax 百分比负值钳制、格式化注释与实现矛盾等。

### 加固

- 账本文件损坏/版本不受支持时先把原文件改名备份(`ledger.json.corrupt-*`)再按空账本启动,不再被下一次落盘无声覆盖。
- 配置补丁合并前结构化克隆,拒绝的补丁不再把就地规范化泄入活配置;mergeDeep 跳过 `__proto__`/`constructor`/`prototype`;价格表查询全部改自有属性判定(模型 id 为 `__proto__` 不再把原型当价格);默认价表深拷贝,杜绝嵌套档位跨实例共享。
- 凭据模板替换改函数形式,密钥值含 `$&`/`$$` 等特殊序列不再损坏 header;HTML 实体解码单趟化消除双重解码;官方页金额解析支持千分位逗号与括号价;目录抓取/校验脚本加超时。
- 路由分类缓存改 WeakMap(长驻进程不再随配置保存次数线性增长);小时桶修剪结果回赋内存;启动导入扫描让出事件循环(大会话库不再冻结 UI);backfill 提前丢弃打包行(内存占用减半以上);AbortError 仅在旧版 undici 超时形态下重试,手动取消不再盲重。
- install.ps1:corepack 引导兼容 PS5.1 stderr 重定向坑(npm 回退分支恢复可达),profile 清单解析失败给出明确报错;清空全部历史时连 Plan 采样/小时桶/余额基准一并清理;插件卸载时清理启动导入定时器。

## [1.6.0] - 2026-08-25

### 修复

- **累计费用失真(桶/容器 apiCost 脱节,用户实测:插件 $5.26 vs 桶级分布 $12.41)**:`splitLedgerApiCost` 此前只重算容器级(day/session)、从不回写桶级;而每次加载时 `sanitizeDays` 会把缺 `apiCost` 的旧桶回落为「全额 cost」——各天容器值来自不同时刻的计算,互相矛盾且与桶级分布脱节。现升级为**计费口径一致性重建**(迁移标记 `billing-rebuild-v3`,幂等):桶级 apiCost 按分类回写、容器 = Σ桶。
- **无模型明细的历史残差漏计**:日合计存在但 byProviderModel 缺失的差额(用户账本 08-17 达 $2.80)此前不进任何口径。按用户决定,**残差归 API**(宁多勿少):容器 apiCost = Σ桶 + max(0, cost − Σ桶cost),会话级同理。
- **modlens-zen 包装前缀不做任何特判**:统一按普通规则计费(该前缀不在订阅别名表 → 全部计入真金白银 API 口径,历史存量与新增一致;重建迁移 v4 按此重算)。

### 新增

- **路由调用归类**:provider 为空/'deepseek' 且模型不在 DeepSeek 主表(canon 等价)、但在第三方目录命中的调用(Go/Zen 网关路由落账 provider 缺失的场景),自动按 'go' 归类继续判定——不再误入真金白银;真 DeepSeek 官方模型不受影响,`planBilling.models` 覆盖优先。宿主 account/重建迁移/backfill 回放/客户端镜像全链路生效。
- **「含 Plan 总额」全局开关(showTotalWithPlan)**:概览页汇总卡片下方新增快捷开关(随自动保存即时生效);关闭(默认)= 真金白银口径(apiCost,全部按量渠道);开启 = 总等值金额(cost,含 Plan 订阅等值)。作用范围:概览三卡、侧边栏今日徽章及悬停、预算图框与预算已用%(宿主 budgetUsed 同步分支)、历史/今日会话/会话排行表格、热图悬停、会话徽章与 dock(开启时回到单一总额展示)。配置全链路(defaultConfig/校验/清洗/strict codec/读侧白名单)齐备。

## [1.5.53] - 2026-08-25

### 修复

- **DeepSeek/空 provider 渠道误套默认低价(用户实测反馈:773M tokens 仅计 ¥51,差 5-15 倍)**:provider 缺失或为 deepseek、但模型实际属于 Go/厂商目录时(`minimax-m3`/`kimi-k2.6` 等),auto 模式此前直接回退 DeepSeek 默认价($0.22/M)。现于 DeepSeek 分支内先做**跨目录最佳匹配兑底**(精确命中加权 +1000 分,unpriced 跳过),真 DeepSeek 模型不受影响仍走峰谷主表;既有跨厂商兑底同步采用精确优先评分。
- **百分比量化误差(用户复核追问)**:各家额度接口的百分比读数存在个位级量化——显示 `1%` 的真实值可能在 `0.5%~1.5%`,此前逐对采样差分把显示值当真值,小跨度时每 1%/满窗估算相对误差可达 ±50% 以上甚至更宽(live 折算的分母同样受影响)。现改为**段式首尾差分**:把样本序列切成「连续可信段」(周期切换/p 或本地累计单调性破坏/7 天滑动上限处切段),每段做端点差分——中间读数的量化误差两两抵消,只剩段首尾两点;段跨度越大误差越小(Δp=20 时 ≤±5%)。
- **置信分档与标注**:估算新增 `confidence` 字段——差分跨度 Δp ≥ 5 个百分点为 `high`(个位量化误差压到 ±10% 以内),不足或 live 回退为 `low`,设置页方法列附「读数精度受限」标注,口径说明同步补充。日/周/月曲线按桶聚合 Σtokens÷Σpct,多区间累加天然抗量化,不受此问题影响。
- **「账本不可用」修复(confidence 击穿 strict codec)**:`planStats.windows[*].confidence` 在 `method='none'` 时返回 `null`,而 schema 误声明为 `z.enum(['high','low']).optional()`(不接受 null),导致每次 getState 被拒、整个快照走降级链(目录/额度状态被剔除)。现改为 `z.union([z.enum(['high','low']), z.null()]).optional()`,并补 method=none/live/sample 三形态的 codec 防回归断言。
- **历史定价修复器 apiCost NaN 防护**:`repairLedgerPricing`(pricing-go-fix-v1 迁移,修复第三方模型被误套 DeepSeek 默认低价的历史账目)对缺失 `apiCost` 的旧记录存在 `Number(undefined) ?? fallback` 失效问题(`??` 不兜底 NaN),会把日/会话 `apiCost` 写成 NaN 并随 JSON 序列化为 null;现显式判有限数后再钳制,并补行为级测试(flat 重算/peak 跳过/三级联动/幂等)。
- **zen 路由真实 id 精确计价**:对表夹具发现 Zen 目录新增 `gemini-3.1-pro`(≤200K:$2/$12/缓读 $0.20)补入 google 键,消除对宽泛包含匹配 `-preview` 条目的依赖;对表夹具现为 70 条全对齐。

## [1.5.52] - 2026-08-25

### 修复

- **Token Plan 周/月估算系统性偏低(用户反馈复核)**:`aggregateUsageSince` 的完整天过滤把**周期首日**(每周一/每月 1 日)整天丢弃——既不进日账本聚合又超出旧环形缓冲 24h 保留期,导致「本周期实际」「每 1% 额度」「满窗」全部低估;凌晨场景 5 小时滚动窗还会丢失昨日尾部。现改为**时间区间与「日」求交**:start 恰为午夜时该日即为完整天,首日尾部与今日部分由小时桶精确覆盖,无遗漏无双计。
- **重度使用下 5 小时窗低估**:旧近期调用环形缓冲有 2000 条硬上限,子代理/压缩密集的会话单日即可触顶截断;现改为 **provider×小时聚合桶**(整点对齐、保留 48h、体积恒定无截断),v1.5.51 的旧缓冲数据加载时自动转换;窗口边界按小时粒度近似(误差 ≤1 小时,口径说明已注明)。

### 新增

- **历史 Plan 渠道静默自动归类**:启动时扫描账本中出现过的 provider 前缀(`zen:`/`minimax:` 等),对「分类仍为 auto 且额度查询未启用」的已用厂商自动写入 `providers[id]='plan'` 并幂等重算全量历史 `apiCost`(migrations 标记 `plan-autodetect-v1` 保证只跑一次,用户事后手动改回不翻转);`updateConfig` 触及 `planBilling/codingPlans/goQuota` 任一键时同样自动重算,手动调整分类也保持历史一致。openrouter/siliconflow 默认显式 api 永不翻转。
- **采样差分区间 7 天时效**:最近区间超龄不再参与估算(回退「当前用量折算」并在方法列标注基准时刻 sampleAt),避免展示过期数字。
- **zen 路由真实 id 精确计价**:对表夹具发现 Go/Zen 目录新增 `gemini-3.1-pro`(≤200K:$2/$12/缓读 $0.20)补入 google 键,消除对宽泛包含匹配 `-preview` 条目的依赖;`llm-` 包装路由前缀归并与 pricing 对齐(`llm-zen:` 历史键正确计入 go 统计);对表夹具现为 70 条全对齐。

## [1.5.51] - 2026-08-25

### 新增

- **Plan/API 双轨计费分离(issue #64,感谢 @mumchristmas 报告)**:MiniMax/Codex 等「订阅制(额度制)」渠道的调用此前仍按目录 API 价计入账本金额,导致每日真实支出虚大(Z.ai 等家因模型未核价计费为 0 而未被察觉)。现引入 `planBilling` 分类配置:厂商级默认(auto = 跟随该家额度查询启用开关;openrouter/siliconflow/deepseek 默认按量)+ `provider:model` 级显式覆盖(如 Codex 手动标记),优先级为 模型覆盖 > 厂商配置 > auto。账本 day/session/byProviderModel 三级新增 `apiCost`(真金白银部分,`cost` 语义不变仍为总等值金额),同一会话同时使用两类渠道时可精确区分。**全部金额展示切换为真金白银口径**:今日费用徽章、概览三卡、预算(含宿主 `budgetUsed` 聚合)、历史/会话表格、会话徽章与 dock——有 Plan 类用量时徽章显示 `¥x(API)`、dock 追加「Plan 等值 ¥y」,悬停明细单列;历史数据由一次性迁移 `plan-billing-split-v1` 按分类回溯重算(幂等);回填/导入回放同口径写入。
- **Token Plan 用量统计面板(设置 → 用量)**:各已启用 Plan 厂商(9 家 + OpenCode Go)当前窗口卡:已用% | 本周期实际(本地账本)| **每 1% 额度 ≈ token 数 · 等值金额** | **满窗 100% ≈ token 数 · 等值金额** | 重置时刻 + 估算方法标注(采样差分/当前用量折算/样本不足)。估算采用**另存百分比采样历史**方案:每次额度刷新成功记录 `{t, p%, 本地累计token/等值额, 重置标记}`(每 provider×窗口上限 400 条 / 90 天,SCNet 本地自估不参与),相邻采样差分(Δ本地用量 ÷ Δ百分比)即每 1% 与满窗值;样本不足时回退「本周期实际 ÷ 当前已用%」。附日(30 天)/周(12 周)/月(12 月)三档粒度曲线(采样区间聚合,悬停见每 1% 折算与区间明细)。Plan 类调用同步进入 24h/2000 条环形缓冲支撑 5 小时滚动窗聚合。按模型统计行新增「API 按量 / Plan 订阅」计费方式标记;verify.mjs 新增分类器/三级拆分/迁移幂等/估算数学(含重置断开与 live 回退)/采样裁剪/strict codec 漂移/配置校验/UI 接线九组断言。

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
