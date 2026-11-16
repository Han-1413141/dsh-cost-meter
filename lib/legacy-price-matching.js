// Frozen v1.9.69 matching rules from 33d39df for saved price versions only.
// New calls use pricing.js. Keep historical model identities and default fallback reproducible.
import { OPENDESIGN_PROVIDER_IDS } from './opendesign.js'
import { withProviderPeakSchedule } from './peak-schedule.js'
import { cnyPrice } from './price-multiplier.js'
const OLLAMA_CLOUD_PRICED_MODELS = new Set(['deepseek-v4.1-flash', 'deepseek-v4-pro'])

export function createLegacyPriceMatcher({ normalizePrice, normalizeCustomPrice }) {
  function priceEntryFor(modelId, table) {
    const models = table?.models ?? {}
    if (typeof modelId === 'string' && modelId.length > 0) {
      // 仅认自有属性:models[modelId] 直取会命中 Object.prototype('__proto__'/'toString' 等)。
      const exact = Object.hasOwn(models, modelId) ? models[modelId] : undefined
      if (exact !== undefined) return exact
      // 别名匹配:deepseek-chat → 任何以 '-' 连接的相近 id 不再猜测,直接回退 default。
    }
    return table?.default ?? { cacheHit: 0, cacheMiss: 0, output: 0 }
  }

  // ── 模型名自动匹配(精确 → 归一化 → 安全后缀) ───────────

  /**
   * 模型名归一化:NFKC 全角/兼容字符归一化后转小写,仅去掉已知渠道附注 (go)/(zen),再只保留 Unicode 字母与数字。
   * 大小写、空格、横杠、下划线、点号等差异全部忽略:'GPT-5.6 Luna (Go)' → 'gpt56luna'。
   */
  function modelNameText(id) {
    return String(id ?? '').normalize('NFKC').toLowerCase().replace(/[(（]\s*(?:go|zen)\s*[)）]/g, ' ').trim()
  }
  function canonModelId(id) {
    return modelNameText(id).replace(/[^\p{L}\p{N}]+/gu, '')
  }

  function stripIdDecor(id, snapshotTags = true, shortSnapshotTags = true) {
    // Strip request decorations one at a time; candidate snapshots keep their identity.
    const text = modelNameText(id)
    if (snapshotTags && /[-_./:@](?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/.test(text)) return text.slice(0, -5)
    if (snapshotTags && shortSnapshotTags && /[-_./:@]\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/.test(text)) return text.slice(0, -7)
    return text.replace(/[-_./:@](?:\d{4}-?\d{2}-?\d{2}|v\d+(?:\.\d+)*|\d+k|latest)$/, '')
  }

  /** Exact IDs precede unique punctuation aliases and request-only safe decorations. */
  function matchModelId(modelId, candidates, exactId = modelId, snapshotTags = true, shortSnapshotTags = true) {
    if (typeof modelId !== 'string' || modelId.length === 0) return null
    const list = Array.isArray(candidates) ? candidates.filter(c => typeof c === 'string' && c.length > 0) : []
    const exact = list.find(c => c === exactId)
    if (exact !== undefined) return exact
    let target = modelId.normalize('NFKC').trim()
    if (/[:(（]\s*(?:free|online)\b/i.test(target)) return null
    for (;;) {
      const canon = canonModelId(target)
      if (canon.length === 0) return null
      const hits = list.filter(c => canonModelId(c) === canon)
      if (hits.length > 0) return hits.length === 1 ? hits[0] : null
      const stripped = stripIdDecor(target, snapshotTags, shortSnapshotTags)
      if (stripped === target.toLowerCase()) return null
      target = stripped
    }
  }

  const SCOPED_PRICE_PROVIDERS = new Set(['openrouter', 'opencode-zen', 'opencode-go', 'opencode-go-plus', 'zen', 'opencode', ...OPENDESIGN_PROVIDER_IDS])
  const MODEL_VENDOR_PREFIXES = {
    openai: /^(?:gpt|o\d|codex)/i, anthropic: /^claude/i, google: /^gemini/i, stepfun: /^step-/i,
    deepseek: /^deepseek/i, moonshot: /^kimi/i, 'z-ai': /^glm/i, xai: /^grok/i,
    alibaba: /^qwen/i, minimax: /^minimax/i, tencent: /^(?:hunyuan|hy\d)/i,
    xiaomi: /^mimo/i, upstage: /^solar/i, nvidia: /^nemotron/i, mistral: /^mistral/i,
    meta: /^(?:muse|llama)/i, meituan: /^longcat/i,
  }
  function priceBillingMode(entry) {
    return ['deepseek-peak', 'utc-peak'].includes(entry?.billingMode) ? entry.billingMode : 'flat'
  }
  // Full IDs win. Auto aliases may remove a known upstream namespace, never a routing variant.
  // Gemini API model resource names use models/{model}: https://ai.google.dev/api/models
  function priceModelHit(modelId, models, provider, mode, prices) {
    if (typeof modelId !== 'string') return null
    if (Object.hasOwn(models, modelId)) return modelId
    if (mode !== 'auto') return null
    let target = modelId.normalize('NFKC').trim().replace(/^models\/(?=gemini)/i, 'google/')
    const sep = target.search(/[/:]/)
    if (sep > 0) {
      const vendor = target.slice(0, sep).trim().toLowerCase(), bare = target.slice(sep + 1).trim()
      if (Object.hasOwn(MODEL_VENDOR_PREFIXES, vendor)
        && (vendor === provider || (provider === 'opencode-zen' || provider === 'opencode-go')
          && (MODEL_VENDOR_PREFIXES[vendor].test(bare)
            || matchModelId(bare, Object.keys(vendor === 'deepseek' ? prices?.models ?? {} : prices?.providers?.[vendor]?.models ?? {}), bare, prices?.snapshotTags !== false, prices?.shortSnapshotTags !== false) !== null))) target = bare
      else if (Object.hasOwn(MODEL_VENDOR_PREFIXES, vendor)) return null
    }
    // Formatting a request must not create a literal hit that bypasses alias collisions.
    return matchModelId(target, Object.keys(models), modelId, prices?.snapshotTags !== false, prices?.shortSnapshotTags !== false)
  }

  /**
   * provider-aware 价格查找。provider 缺失时保持旧版 DeepSeek 行为；
   * 已知非 DeepSeek provider 未配置模型时返回 null，避免误套 DeepSeek default。
   * @param options - { mode: 'auto'|'exact', overrides: { 'provider:modelId': '目标' } };
   *   overrides 目标可为同 provider 模型 id,或 'provider:modelId' 跨 provider 引用;
   *   'deepseek:__default__' 表示回退 DeepSeek 默认价。
   */
  /**
   * 在已归一化的渠道下解析价格(原始实现,providerPriceEntryFor 的主体):
   * 手动覆盖优先于自动匹配;覆盖值可为同渠道模型 id(裸值)或 'provider:model'
   * 跨渠道引用;'deepseek:__default__' 表示回退 DeepSeek 默认价。
   */
  function providerPriceEntryForNormalized(normalized, modelId, prices, options) {
    const mode = options?.mode === 'exact' ? 'exact' : 'auto'
    const overrides = options?.overrides !== null && typeof options?.overrides === 'object' ? options.overrides : {}
    let targetModel = modelId
    let targetProvider = normalized
    const overrideKey = (normalized === '' ? 'deepseek' : normalized) + ':' + modelId
    const override = overrides[overrideKey]
    if (override === '__custom__') {
      const entry = normalizeCustomPrice(prices?.custom?.[overrideKey])
      return { entry, billingMode: entry?.billingMode ?? 'flat', priced: entry !== null, currency: entry?.currency ?? 'USD' }
    }
    // 「本地模型(零消耗)」哨兵(v1.6.11,issue #76 后续):覆盖目标 __local__ 表示
    // 把该 provider:model 显式标记为本地来源——token 照记、费用恒 0;设置页
    // 「已命中模型」与「未命中模型」列表的下拉框均提供该选项。
    if (override === '__local__') {
      return { entry: null, billingMode: 'flat', priced: false }
    }
    if (typeof override === 'string' && override.length > 0) {
      const sep = override.indexOf(':')
      if (sep > 0 && override.slice(sep + 1).length > 0) {
        targetProvider = override.slice(0, sep).trim().toLowerCase()
        targetModel = override.slice(sep + 1)
      } else {
        targetModel = override
      }
      if (targetProvider === 'deepseek' && targetModel === '__default__') {
        const raw = prices?.default ?? { cacheHit: 0, cacheMiss: 0, output: 0 }
        const entry = normalizePrice(raw)
        if (entry === null) return { entry: null, billingMode: 'flat', priced: false }
        return { entry, billingMode: 'deepseek-peak', priced: entry.unpriced !== true }
      }
    }
    // 保留历史宿主 Zen/Go 别名；用户在原渠道手写的条目优先。
    if (['zen', 'opencode', 'opencode-go-plus'].includes(targetProvider)) {
      const own = priceModelHit(targetModel, prices?.providers?.[targetProvider]?.models ?? {}, 'opencode-go', mode, prices)
      if (own === null) targetProvider = 'opencode-go'
      else targetModel = own
    }
    // 本地推理来源零价守卫(issue #76 附带):置于覆盖解析之后——显式 priceOverrides
    // 把本地模型改指任意(云端)目标时自然放行,未覆盖时一律未定价,自动匹配
    // (含下方 DeepSeek 主表与跨厂商兜底的模糊命中)不再误套云端价。
    if (OPENDESIGN_PROVIDER_IDS.includes(targetProvider) && targetProvider !== 'opendesign'
      && priceModelHit(targetModel, prices?.providers?.[targetProvider]?.models ?? {}, targetProvider, mode, prices) === null) targetProvider = 'opendesign'
    if (isLocalOriginProviderOrModel(targetProvider, targetModel)) {
      return { entry: null, billingMode: 'flat', priced: false }
    }
    // OpenRouter 的 :free / :online 等变体有独立价格；完整 id 精确查价，避免
    // 新目录加入免费项后，未收录的付费模型或其他变体通过模糊匹配被记作免费。
    if (targetProvider === 'openrouter') {
      const models = prices?.providers?.openrouter?.models ?? {}
      const entry = Object.hasOwn(models, targetModel) ? normalizePrice(models[targetModel]) : null
      return { entry, billingMode: 'flat', priced: entry !== null && entry.unpriced !== true }
    }
    if (targetProvider === '' || targetProvider === 'deepseek' || targetProvider.includes('deepseek')) {
      const models = prices?.models ?? {}
      // 仅认自有属性(防原型链键);命中后统一 normalizePrice 补齐两档简写等写法,
      // 避免 {input,output} 直返导致 costOf 取到 undefined → NaN。
      const hit = priceModelHit(targetModel, models, 'deepseek', mode, prices)
      if (hit !== null && hit !== undefined) {
        const raw = models[hit]
        const entry = normalizePrice(raw)
        if (entry === null || entry.unpriced === true) return { entry: null, billingMode: 'flat', priced: false }
        return { entry, billingMode: 'deepseek-peak', priced: true }
      }
      // 回退: provider 缺失/DeepSeek 但模型实际属于 Go 等其它目录时，避免
      // 误套 DeepSeek 默认低价(0.007/0.22/0.66)，导致 Go 金额系统性偏低。
      // 例如 provider='' + 'minimax-m3'/'kimi-k2.6'/'gmicloud/…' 若按默认
      // 仅 0.22 $/M，真实应为 0.3-3 $/M，差 5-15 倍 (用户反馈 773M/¥51)。
      if (mode === 'auto') {
        let bestEntry = null
        let bestLen = -1
        let ambiguous = false
        let bestMode = 'flat'
        for (const [prov, table] of Object.entries(prices?.providers ?? {})) {
          if (SCOPED_PRICE_PROVIDERS.has(prov)) continue // 渠道价不作为其他渠道的兜底价。
          const modelsCat = table?.models ?? {}
          const h = priceModelHit(targetModel, modelsCat, prov, mode, prices)
          if (h === null) continue
          const entry = normalizePrice(modelsCat[h])
          if (entry === null) continue
          const score = +(h === targetModel || canonModelId(h) === canonModelId(targetModel))
          if (score > bestLen) {
            bestEntry = entry
            bestLen = score
            ambiguous = false
            bestMode = priceBillingMode(modelsCat[h])
          } else if (score === bestLen) ambiguous = true
        }
        if (ambiguous) return { entry: null, billingMode: 'flat', priced: false }
        if (bestEntry !== null) return { entry: bestEntry, billingMode: bestMode, priced: bestEntry.unpriced !== true }
      }
      const raw = priceEntryFor(targetModel, prices)
      const entry = normalizePrice(raw)
      if (entry === null) return { entry: null, billingMode: 'flat', priced: false }
      return { entry, billingMode: 'deepseek-peak', priced: entry.unpriced !== true }
    }
    const providerTable = prices?.providers?.[targetProvider]
    const catalog = providerTable?.models ?? {}
    const hit = priceModelHit(targetModel, catalog, targetProvider, mode, prices)
    if (hit === null && SCOPED_PRICE_PROVIDERS.has(targetProvider)) return { entry: null, billingMode: 'flat', priced: false }
    if (hit === null && Object.hasOwn(MODEL_VENDOR_PREFIXES, targetProvider)) return { entry: null, billingMode: 'flat', priced: false }
    if (hit === null && mode === 'auto') {
      // 跨厂商兑底:请求携带的 provider 未在价格表登记(opencode / zen 等路由入口)时,
      // 按模型名全库查找——先查 DeepSeek 主表(保留峰谷两档),按精确优先、同等级多渠道命中拒绝猜价。
      let bestEntry = null
      let bestLen = -1
      let ambiguous = false
      let bestMode = 'flat'
      for (const [prov, table] of [['deepseek', { models: prices?.models ?? {} }], ...Object.entries(prices?.providers ?? {})]) {
        if (prov === targetProvider || SCOPED_PRICE_PROVIDERS.has(prov)) continue
        const models = table?.models ?? {}
        const h = priceModelHit(targetModel, models, prov, mode, prices)
        if (h === null) continue
        const entry = normalizePrice(models[h])
        if (entry === null) continue
        // Mistral 的 DeepSeek 转售 ID 与 Ollama 日期标签归一化后相同。
        // 完整 ID 或明确的 Mistral 来源可用转售价；其他渠道保留 DeepSeek 日期标签匹配。
        if (prov === 'mistral' && h.startsWith('deepseek-') && h !== targetModel
          && !targetProvider.includes('mistral') && !/^mistral[/:]/i.test(String(targetModel).trim())) continue
        const score = +(h === targetModel || canonModelId(h) === canonModelId(targetModel))
        if (score > bestLen) {
          bestEntry = entry
          bestLen = score
          ambiguous = false
          bestMode = prov === 'deepseek' ? 'deepseek-peak' : priceBillingMode(models[h])
        } else if (score === bestLen) ambiguous = true
      }
      if (ambiguous) return { entry: null, billingMode: 'flat', priced: false }
      if (bestEntry !== null) return { entry: bestEntry, billingMode: bestMode, priced: bestEntry.unpriced !== true }
    }
    if (hit === null) return { entry: null, billingMode: 'flat', priced: false }
    const entry = normalizePrice(catalog[hit])
    if (entry === null || entry.unpriced === true) return { entry: null, billingMode: 'flat', priced: false }
    return { entry, billingMode: priceBillingMode(catalog[hit]), priced: true }
  }

  /**
   * 裸名回退(issue #56)专用:模型名在 DeepSeek 主表中确有显式条目才命中
   * (exact 仅精确名,auto 含归一化匹配);不吃默认兜底价——未知名字保持未定价,
   * 避免把任意未知裸名按默认价计费。
   */
  function deepseekExplicitEntry(modelName, prices, mode) {
    const models = prices?.models ?? {}
    // 仅认自有属性(防原型链键);命中后 normalizePrice 补齐简写(与主路径同口径)。
    const hit = Object.hasOwn(models, modelName)
      ? modelName
      : (mode === 'auto' ? matchModelId(modelName, Object.keys(models), modelName, prices?.snapshotTags !== false, prices?.shortSnapshotTags !== false) : null)
    if (hit === null || hit === undefined) return null
    const raw = models[hit]
    const entry = normalizePrice(raw)
    if (entry === null || entry.unpriced === true) return null
    return { entry, billingMode: 'deepseek-peak', priced: true }
  }

  /**
   * 是否 modlens 视觉包装层 provider id(`modlens-<upstream>` / `deepseek-modlens`)。
   *
   * modlens 插件(@liustack/modlens)为每条承载纯文本 DeepSeek/GLM 模型的 provider
   * 路由自动注册「(modlens vision)」包装模型,provider id 形如 `modlens-opencode-go`
   * (deepseek-official 路由固定为 `deepseek-modlens`)。包装层会在自身监听器体内
   * 再发起一次上游 llm.stream 转发同一份 usage——该内层分发发生在瀑布派发期,
   * 逃逸 billing-stream 的 ALS 深度标记,实时钩子与历史回放照单全收会把每次调用
   * 记两遍(上游 + 包装层,issue #70 实测账本 token/费用整体翻倍)。统一判定函数
   * 供各计费入口(实时钩子 / 会话投影 / 历史回放 / 账本清洗)跳过包装层、只记上游真实流。
   */
  function isWrapperProviderId(provider) {
    if (typeof provider !== 'string' || provider.length === 0) return false
    return provider.startsWith('modlens-') || provider === 'deepseek-modlens'
  }

  /**
   * 包装层 provider 对应的上游 provider id:`modlens-opencode-go` → `opencode-go`,
   * `deepseek-modlens` → `deepseek-official`(modlens 对官方路由的固定包装名);
   * 非包装层返回 null。供账本清洗把「仅包装层入账」的存量条目改挂回上游键。
   */
  function wrapperUpstreamProvider(provider) {
    if (typeof provider !== 'string' || provider.length === 0) return null
    if (provider === 'deepseek-modlens') return 'deepseek-official'
    if (provider.startsWith('modlens-')) {
      const upstream = provider.slice('modlens-'.length)
      return upstream.length > 0 ? upstream : null
    }
    return null
  }

  /**
   * 本地推理来源判定(issue #76 附带):本地网关(lmstudio / ollama / vLLM 等)
   * 承载的模型没有云端价,自动匹配却会按模型名模糊命中同家族云端变体(实测
   * lmstudio:qwen3.8-9b-heretic-… 被套阿里 qwen3.8-max 单价,64 次多计 $3.29)。
   * 判定命中时价格解析直接返回未定价(token 照记、费用 0),显式 priceOverrides
   * 仍可为其指定价格(逃生门)或 '__local__' 哨兵(显式零消耗)。provider 参数须传
   * 已归一化(小写、llm- 前缀剥离)值。名单须与 src/client.js 的客户端镜像保持
   * 一致(verify.mjs 漂移守卫锁定双侧同输入同结果)。
   */
  const LOCAL_PROVIDER_IDS = new Set([
    'local', 'lmstudio', 'ollama', 'jan', 'gpt4all', 'koboldcpp', 'llamacpp', 'llama-cpp', 'localai',
    'vllm', 'sglang', 'tabbyapi', 'lmdeploy', 'oobabooga', 'text-generation-webui', 'llama-server',
  ])
  const LOCAL_MODEL_PREFIXES = [
    'lmstudio:', 'lmstudio/', 'ollama:', 'ollama/', 'jan:', 'jan/', 'gpt4all:', 'gpt4all/',
    'koboldcpp:', 'koboldcpp/', 'llamacpp:', 'llamacpp/', 'llama-cpp:', 'llama-cpp/',
    'localai:', 'localai/', 'vllm:', 'vllm/', 'sglang:', 'sglang/', 'tabbyapi:', 'tabbyapi/',
    'lmdeploy:', 'oobabooga/', 'text-generation-webui/', 'llama-server:', 'gguf:', 'local:',
  ]
  function isLocalOriginProviderOrModel(provider, modelId) {
    if (typeof provider === 'string' && LOCAL_PROVIDER_IDS.has(provider)) return true
    const model = typeof modelId === 'string' ? modelNameText(modelId) : ''
    return LOCAL_MODEL_PREFIXES.some(prefix => model.startsWith(prefix))
  }

  /**
   * provider-aware 价格查找。provider 缺失时保持旧版 DeepSeek 行为；
   * 已知非 DeepSeek provider 未配置模型时返回 null，避免误套 DeepSeek default。
   * @param options - { mode: 'auto'|'exact', overrides: { 'provider:modelId': '目标' } };
   *   overrides 目标可为同 provider 模型 id,或 'provider:modelId' 跨 provider 引用;
   *   'deepseek:__default__' 表示回退 DeepSeek 默认价。
   */
  // Magpie keeps upstream/account prefixes in model IDs. Explicit assignments and full catalog IDs win.
  function magpiePriceTarget(provider, modelId, prices, mode, overrides) {
    const override = overrides?.[(provider || 'deepseek') + ':' + modelId]
    if (!provider || mode === 'exact' || typeof modelId !== 'string'
      || isLocalOriginProviderOrModel(provider, modelId) || ['our-free-model', 'our-free-model-region'].includes(provider)
      || typeof override === 'string' && override.length > 0
      || Object.hasOwn(prices?.providers?.[provider]?.models ?? {}, modelId)) return null
    const separator = modelId.indexOf('/')
    if (separator <= 0 || separator === modelId.length - 1) return null
    const route = modelId.slice(0, separator).toLowerCase()
    const model = modelId.slice(separator + 1)
    const aliases = { codex: 'openai', claude: 'anthropic', gemini: 'google', 'ollama-cloud': 'ollama-cloud', volcengine: 'volcengine', ark: 'ark' }
    const magpie = /^(?:dsh-)?magpie(?:$|-)/.test(provider)
    const knownRoute = Object.hasOwn(aliases, route) || SCOPED_PRICE_PROVIDERS.has(route)
      || ['workbuddy', 'workbuddy-ai', 'qoder', 'qoder-cn', 'trae-cn', 'trae-global', 'zcode', 'mimo-app', 'commandcode-plan', 'cline', 'copilot', 'vercel'].includes(route)
    if (!magpie && (!knownRoute || Object.hasOwn(MODEL_VENDOR_PREFIXES, provider) || SCOPED_PRICE_PROVIDERS.has(provider))) return null
    // An unknown free-only route must not inherit a paid reference price.
    if (/(?:^|-)free$/.test(route) && !Object.hasOwn(prices?.providers ?? {}, route)) return null
    const upstream = aliases[route] ?? route
    if (upstream === 'deepseek' && priceModelHit(model, prices?.models ?? {}, 'deepseek', 'auto', prices) === null) return null
    return {
      provider: Object.hasOwn(aliases, route) || SCOPED_PRICE_PROVIDERS.has(upstream)
        || Object.hasOwn(MODEL_VENDOR_PREFIXES, upstream) || Object.hasOwn(prices?.providers ?? {}, upstream)
        || isLocalOriginProviderOrModel(upstream, model) ? upstream : provider,
      model,
    }
  }

  function providerPriceEntryFor(provider, modelId, prices, options) {
    const rawProvider = typeof provider === 'string' ? provider.trim().toLowerCase() : ''
    let normalized = rawProvider.startsWith('llm-') ? rawProvider.slice(4) : rawProvider
    const route = magpiePriceTarget(normalized, modelId, prices, options?.mode, options?.overrides)
    if (route) {
      normalized = route.provider
      modelId = route.model
      options = { ...options, overrides: {} }
    }
    if (['our-free-model', 'our-free-model-region'].includes(normalized) && options?.overrides?.[normalized + ':*'] === '__free__') return { entry: { cacheHit: 0, cacheMiss: 0, cacheWrite: 0, output: 0, reasoning: 0 }, currency: 'USD', priced: true, billingMode: 'flat' }
    const result = withProviderPeakSchedule(resolveProviderPriceEntry(normalized, modelId, prices, options), normalized, prices)
    if (['volcengine', 'ark'].includes(normalized) && prices?.volcenginePeak !== false && result.entry && result.billingMode === 'deepseek-peak') {
      return { ...result, entry: { ...result.entry, peakSchedule: result.entry.peakSchedule ?? 'volcengine' } }
    }
    // Tag a copy of the resolved entry; billingMode stays deepseek-peak (API class, peak switch).
    // Frozen price versions saved before v1.9.13 carry ollamaPeak: false and keep DeepSeek's windows.
    if (normalized === 'ollama-cloud' && prices?.ollamaPeak !== false && result.entry && result.billingMode === 'deepseek-peak'
      && (prices?.ollamaTaggedPeak === false ? OLLAMA_CLOUD_PRICED_MODELS.has(typeof modelId === 'string' ? modelId.trim().toLowerCase() : '') : matchModelId(modelId, [...OLLAMA_CLOUD_PRICED_MODELS]) !== null)) {
      return { ...result, entry: { ...result.entry, peakSchedule: result.entry.peakSchedule ?? 'ollama' } }
    }
    return result
  }

  function resolveProviderPriceEntry(normalized, modelId, prices, options) {
    const primary = providerPriceEntryForNormalized(normalized, modelId, prices, options)
    if (primary.currency) return primary
    if (primary.priced) return selectPriceCurrency(primary, prices)
    // issue #56:v1.5.42 及之前设置页下拉框把 DeepSeek 目标模型存成裸名(缺
    // 'deepseek:' 前缀),被按「同渠道换名」解析——映射键的渠道与 DeepSeek 不同时
    // 查无此价,金额归零。此处对「裸值覆盖 + 非 DeepSeek 渠道解析失败」回退按
    // DeepSeek 渠道再查一次,存量错误配置无需手工修正即自愈。
    if (normalized === '' || normalized === 'deepseek' || normalized.includes('deepseek')) return selectPriceCurrency(primary, prices)
    const overrides = options?.overrides !== null && typeof options?.overrides === 'object' ? options.overrides : {}
    const override = overrides[normalized + ':' + modelId]
    if (typeof override !== 'string' || override.length === 0 || override === '__local__' || override.includes(':')) return selectPriceCurrency(primary, prices)
    const mode = options?.mode === 'exact' ? 'exact' : 'auto'
    return selectPriceCurrency(deepseekExplicitEntry(override, prices, mode) ?? primary, prices)
  }

  function selectPriceCurrency(result, prices) {
    if (result.currency) return result
    if (!result.priced) return { ...result, currency: 'USD' }
    if (prices?.currency === 'CNY' && result.entry?.cny) {
      return { ...result, entry: cnyPrice(result.entry), currency: 'CNY' }
    }
    return { ...result, currency: result.billingMode === 'deepseek-peak' && prices?.currency === 'CNY' ? 'CNY' : 'USD' }
  }


  return providerPriceEntryFor
}
