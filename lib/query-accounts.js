// Query-account metadata is public. Credentials remain in the host store.
export const QUERY_ACCOUNT_SOURCES = ['balance', 'goQuota', ...['opendesign', 'anthropic', 'zai', 'minimax', 'kimi', 'openrouter', 'siliconflow', 'commandcode', 'clinepass', 'volcengine', 'mimo', 'baidu-coding', 'factory'].map(id => 'codingPlans.' + id)]
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const validId = id => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{7,63}$/.test(id) && id !== 'default'
const validLabel = label => typeof label === 'string' && label.trim().length > 0 && label.length <= 64 && !/[\u0000-\u001f\u007f]/.test(label)
export function normalizeQueryAccounts(value) {
  const out = {}
  if (!object(value)) return out
  for (const source of QUERY_ACCOUNT_SOURCES) {
    const group = value[source]
    if (!object(group)) continue
    const seen = new Set()
    const accounts = (Array.isArray(group.accounts) ? group.accounts : []).filter(row => {
      if (!object(row) || !validId(row.id) || !validLabel(row.label) || seen.has(row.id)) return false
      seen.add(row.id); return true
    }).slice(0, 10).map(({ id, label }) => ({ id, label: label.trim() }))
    const displayed = source !== 'balance' && Array.isArray(group.displayed)
      ? [...new Set(group.displayed.filter(id => id === 'default' || accounts.some(row => row.id === id)))] : undefined
    out[source] = { ...(displayed ? { displayed } : {}), selected: accounts.some(row => row.id === group.selected) ? group.selected : 'default', accounts }
  }
  return out
}
export function validQueryAccounts(value) {
  if (!object(value)) return false
  return Object.entries(value).every(([source, group]) => QUERY_ACCOUNT_SOURCES.includes(source) && object(group)
    && Object.keys(group).every(key => ['selected', 'accounts', 'displayed'].includes(key)) && Array.isArray(group.accounts) && group.accounts.length <= 10
    && group.accounts.every(row => object(row) && Object.keys(row).every(key => ['id', 'label'].includes(key)) && validId(row.id) && validLabel(row.label))
    && new Set(group.accounts.map(row => row.id)).size === group.accounts.length
    && (group.displayed === undefined || source !== 'balance' && Array.isArray(group.displayed)
      && group.displayed.length <= 11 && new Set(group.displayed).size === group.displayed.length
      && group.displayed.every(id => id === 'default' || group.accounts.some(row => row.id === id)))
    && (group.selected === 'default' || group.accounts.some(row => row.id === group.selected)))
}
export const queryAccountSource = target => target.replace(/\.(ak|sk)$/, '')
export const selectedQueryAccount = (config, source) => config?.queryAccounts?.[source]?.selected ?? 'default'
export function queryAccountTarget(config, target, defaultRef) {
  if (typeof target !== 'string') return null
  const [base, explicit, extra] = target.split('@'), source = queryAccountSource(base)
  const legacy = defaultRef(base)
  if (!legacy || extra !== undefined || (explicit !== undefined && !QUERY_ACCOUNT_SOURCES.includes(source))) return null
  const id = explicit ?? selectedQueryAccount(config, source)
  if (id !== 'default' && (!validId(id) || !config?.queryAccounts?.[source]?.accounts?.some(row => row.id === id))) return null
  return { base, source, id, ref: id === 'default' ? legacy : 'DSH_COST_METER_ACCOUNT_' + base.replace(/[^a-z0-9]/gi, '_').toUpperCase() + '_' + id.replaceAll('-', '_').toUpperCase() }
}
