// Public plan names and rules, checked 2026-10-28. Quota values come from each account's usage response.
export const SUBSCRIPTION_CATALOG = {
  kimi: {
    checkedAt: '2026-10-28',
    sourceUrl: 'https://www.kimi.com/code/docs/kimi-code/membership.html',
    tiers: ['Go', 'Plus', 'Pro', 'Max', 'Ultra'],
    legacyTiers: ['Andante', 'Moderato', 'Allegretto', 'Vivace'],
    models: ['k3.1-pro', 'k3.1-pro-highspeed', 'k3', 'k3-256k', 'kimi-for-coding', 'kimi-for-coding-highspeed'],
    zh: '新套餐：Go、Plus、Pro、Max、Ultra。Plus 起提供 Kimi Code，Pro 起提供高速版和 1M 上下文。新套餐使用 5 小时窗口及月总额度；老套餐保留周窗口。',
    en: 'Current tiers: Go, Plus, Pro, Max and Ultra. Kimi Code starts at Plus; Pro adds Highspeed and 1M context. New plans use a 5-hour window and monthly total; legacy plans retain weekly limits.',
  },
  minimax: {
    checkedAt: '2026-10-28',
    sourceUrl: 'https://platform.minimax.io/docs/m-plan/intro',
    tiers: ['Go', 'Explore', 'Build'],
    legacyTiers: ['Plus', 'Max', 'Ultra'],
    models: ['MiniMax-M3.1-Flash'],
    zh: 'M Plan：Go、Explore、Build，均包含 M3.1 Flash；Explore、Build 另含 H3 视频。原 Token Plan 的 Plus、Max、Ultra 保留。使用现有 MiniMax 查询凭据。',
    en: 'M Plan: Go, Explore and Build, all including M3.1 Flash. Explore and Build also include H3 video. Legacy Token Plan Plus, Max and Ultra remain. Uses the existing MiniMax quota credential.',
  },
  go: {
    checkedAt: '2026-10-28', sourceUrl: 'https://opencode.ai/v2/docs/console/go/',
    tiers: ['Go', 'Go Plus'],
    models: ['kimi-k3.1-pro', 'minimax-m3.1-flash', 'step-5-preview', 'gemini-4-argon', 'beam-free', 'iceman-contributor-free'],
    zh: 'Go 为 $10/月，Go Plus 为 $40/月。新增 Kimi K3.1 Pro、MiniMax M3.1 Flash 等模型，各模型使用独立的月度额度标准。',
    en: 'Go costs $10/month; Go Plus costs $40/month. Includes Kimi K3.1 Pro, MiniMax M3.1 Flash and other additions, with model-specific monthly allowances.',
  },
  'tencent-token': {
    checkedAt: '2026-10-28', sourceUrl: 'https://cloud.tencent.com/document/product/1823/130060',
    tiers: ['Lite', 'Standard', 'Pro', 'Max'], products: ['Token Plan', 'Hy Token Plan'],
    zh: '腾讯通用 Token Plan 与 Hy Token Plan 共用 API Key 和请求地址，按模型从对应套餐扣减积分。当前支持套餐归属统计。',
    en: 'Tencent Token Plan and Hy Token Plan share an API key and endpoints; credits are deducted from the applicable plan for each model. Plan classification is supported.',
  },
  qoder: {
    checkedAt: '2026-11-20', sourceUrl: 'https://github.com/dingminhua/dsh-connect-qoder',
    tiers: ['CN'],
    models: ['qmodel_latest', 'qmodel_latest_preview'],
    zh: 'Qoder CN 订阅积分按包发放(基础包/加油包),每包 30 天有效;签到每日可得 100 积分。到期时间显示账户套餐到期时间(非单个积分包周期);无 5 小时/每周速率限额。额度经 dsh-connect-qoder 连接插件读取,仅 CN 区。',
    en: 'Qoder CN subscription credits come in packages (base/add-on), each valid for 30 days; daily check-in grants 100 credits. The expiry shown is the account plan expiry, not an individual package cycle; there is no 5-hour/weekly rate limit. Credits are read through the dsh-connect-qoder connector, CN region only.',
  },
}
