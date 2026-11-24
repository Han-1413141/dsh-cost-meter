/** Infer a subscription family only from an explicit plan marker and one vendor. */
export const PLAN_NAME_HINTS = {
  opendesign: 'opendesign|open[._-]?design',
  codex: 'codex|chatgpt', 'baidu-coding': 'baidu|qianfan|百度|千帆',
  'tencent-coding': 'tencent|tokenhub|腾讯',
  anthropic: 'anthropic|claude', zai: 'z[._-]?ai|zhipu|glm|智谱', minimax: 'minimax|海螺',
  kimi: 'kimi|moonshot|moonshotai|月之暗面', openrouter: 'openrouter', siliconflow: 'siliconflow|硅基',
  commandcode: 'commandcode', clinepass: 'cline[._-]?pass|clinepass', scnet: 'scnet|sugon|超算',
  volcengine: 'volcengine|volcano|volc|ark|火山|方舟', qwen: 'qwen|qianwen|千问|通义',
  mimo: 'mimo|xiaomi|小米', factory: 'factory|droid', go: 'opencode(?:[-_\\s]?go)?|zen|go', trae: 'trae',
}
const matchers = Object.entries(PLAN_NAME_HINTS).map(([id, hints]) => [id, new RegExp('(?:^|[^a-z0-9])(?:' + hints + ')(?=$|[^a-z0-9])')])
export function inferPlanProviderId(provider, modelId) {
  for (const raw of [provider, modelId]) {
    const text = String(raw ?? '').normalize('NFKC').replace(/([a-zA-Z0-9\u3400-\u9fff])(?=(?:MPlan|Coding|Token|Agent|Plan|Subscription))/g, '$1-').replace(/([a-z0-9])((?:coding|token|agent|m)?plan|subscription)$/i, '$1-$2').toLowerCase()
    if (!/(?:^|[^a-z0-9])(?:(?:coding|token|agent|m)[-_\s]*)?plan(?:$|[^a-z0-9])|(?:^|[^a-z0-9])subscription(?:$|[^a-z0-9])|套餐|订阅/.test(text)) continue
    const matches = matchers.filter(([, pattern]) => pattern.test(text))
    if (matches.length) {
      if (matches.length !== 1) return null
      const id = matches[0][0]
      if (id === 'volcengine' && /agent[-_\s]*plan|智能体.*套餐/.test(text)) return 'volcengine-agent'
      if (id === 'tencent-coding') {
        const token = /token[-_\s]*plan|令牌.*套餐/.test(text), coding = /coding[-_\s]*plan|编程.*套餐/.test(text)
        return token === coding ? null : token ? 'tencent-token' : id
      }
      return id
    }
  }
  return null
}
