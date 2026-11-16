// Shared provider identities for price routing and subscription attribution.
export const FORWARDING_PROVIDER_IDS = [
  'vercel', 'copilot', 'cline', 'qoder', 'qoder-cn', 'qoder-global', 'trae', 'trae-cn', 'trae-global',
  'zcode', 'mimo-app', 'commandcode-plan', 'cursor', 'windsurf', 'augment', 'roo', 'codebuddy',
]
export const PLAN_PROVIDER_ALIASES = {
  opendesign: ['opendesign', 'open-design', 'open-design-api', 'amr-link.open-design.ai'],
  go: ['go', 'zen', 'opencode', 'opencode-go', 'opencode-go-plus', 'dsh-opencode-go'],
  codex: ['codex', 'openai-codex', 'dsh-openai-codex', 'codex-chatgpt'],
  // 以下别名来自 @eddyskywalker/dsh-chatgpt-subscription 的 9 条订阅线路
  // (见 lib/chatgpt-subscription-compat.js):其用量走订阅额度,归入对应 Plan 家族。
  anthropic: ['anthropic', 'claude-subscription'],
  zai: ['zai', 'glm-coding-plan'],
  minimax: ['minimax', 'minimax-code', 'minimax-m-plan', 'minimax-mplan', 'minimax-token-plan'],
  kimi: ['kimi', 'kimi-code', 'kimi-coding', 'kimi-coding-plan'],
  commandcode: ['commandcode', 'command-code'],
  clinepass: ['clinepass', 'cline-pass'],
  workbuddy: ['workbuddy', 'workbuddy-subscription', 'workbuddy-ai', 'workbuddy-global', 'xdpool', 'xdpool-global'],
  antigravity: ['antigravity'],
  stepfun: ['stepfun', 'step-code'],
  'volcengine-agent': ['volcengine-agent', 'ark-agent-plan', 'volcengine-agent-plan'],
  'tencent-coding': ['tencent-coding', 'tencent-coding-plan', 'tokenhub-coding-plan'],
  'tencent-token': ['tencent-token', 'tencent-token-plan', 'tokenhub-token-plan', 'tencent-hy-token-plan', 'tokenhub-hy-token-plan'],
  'baidu-coding': ['baidu-coding-plan', 'qianfan-coding-plan', 'baidu-token-plan', 'qianfan-token-plan', 'baidu-tokenplan', 'qianfan-tokenplan'],
  qwen: ['qwen', 'qwen-tokenplan', 'qianwen-tokenplan', 'qwen-token-plan', 'qianwen-token-plan'],
  scnet: ['scnet', 'scnet-tokenplan', 'scnet-token-plan'],
  mimo: [
    'mimo', 'xiaomimimo', 'mimo-token-plan', 'xiaomi-token-plan',
    'xiaomi-token-plan-cn', 'xiaomi-token-plan-sgp', 'xiaomi-token-plan-ams',
  ],
  factory: ['factory', 'droid', 'factory-a', 'factory-g', 'factory-o'],
}
