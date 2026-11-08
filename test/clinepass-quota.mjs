/**
 * Cline Pass 额度(第 15 家 Coding Plan)。
 *
 * 官方 GET /api/v1/users/me/plan/usage-limits 的返回**不是固定的三档**:不同订阅/账号
 * 可能只报其中若干窗口(甚至将来新增窗口类型),percentUsed 也已经是 0-100 的已用百分比。
 * 因此这里与 factory-quota / mimo-quota 同口径:
 *  - 按每个夹具实际给出的窗口断言,不把「正好三个窗口」写死;
 *  - 未知 type 跳过、部分窗口可用仍返回、非法百分比不伪造;
 *  - 客户端卡片按 windows 数量渲染,有几个窗口画几行(而不是断言固定三行);
 *  - 再覆盖注册表/凭据目标/配置清洗/plan 轨归属/queryCodingPlan 接线与双端源码登记。
 */
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CODING_PLAN_ENDPOINTS,
  CODING_PLAN_PROVIDERS,
  CODING_PLAN_PROVIDER_IDS,
  parseClinePassUsage,
  queryCodingPlan,
} from '../lib/coding-plans.js'
import { SECRET_TARGETS, applyConfigPatch, sanitizeConfig, secretRefOf } from '../lib/store.js'
import { billingClassOf, enabledPlanSetOf, planProviderIdOf } from '../lib/plan-billing.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ENDPOINT = 'https://api.cline.bot/api/v1/users/me/plan/usage-limits'

// ── 注册表 / 端点 / 凭据目标 ─────────────────────────────────────────
assert.ok(CODING_PLAN_PROVIDER_IDS.includes('clinepass'), 'clinepass 进入 CODING_PLAN_PROVIDER_IDS')
assert.equal(CODING_PLAN_PROVIDERS.clinepass.label, 'Cline Pass', '标签')
assert.deepEqual(CODING_PLAN_PROVIDERS.clinepass.credentialEnvs, ['CLINE_PASS_API_KEY'], '凭据 env')
assert.deepEqual(CODING_PLAN_ENDPOINTS.clinepass, [ENDPOINT], '只查询官方 usage-limits 端点')
assert.ok(SECRET_TARGETS.includes('codingPlans.clinepass'), '凭据目标已登记')
assert.equal(secretRefOf('codingPlans.clinepass'), 'CLINE_PASS_API_KEY')

// ── 配置清洗与 plan 轨归属 ───────────────────────────────────────────
const patched = applyConfigPatch(sanitizeConfig({}), {
  codingPlans: { clinepass: { enabled: true, display: 'both', refreshMinutes: 30 }, bogus: { enabled: true } },
})
assert.equal(patched.errors.length, 0, 'clinepass 补丁合法')
assert.equal(patched.config.codingPlans.clinepass.enabled, true)
assert.equal(patched.config.codingPlans.clinepass.display, 'both')
assert.equal(patched.config.codingPlans.clinepass.refreshMinutes, 30)
assert.equal(patched.config.codingPlans.bogus, undefined, '未知 provider 被剔除')
const normalized = sanitizeConfig({ codingPlans: { clinepass: {} } }).codingPlans.clinepass
assert.equal(normalized.enabled, false)
assert.equal(normalized.display, 'settings')
assert.equal(normalized.refreshMinutes, 15)
assert.equal(normalized.apiKey, '')
const enabledConfig = sanitizeConfig({ codingPlans: { clinepass: { enabled: true } } })
assert.equal(planProviderIdOf('cline-pass', enabledConfig.planBilling, 'cline-pass/deepseek-v4.1-flash'), 'clinepass', 'cline-pass 别名归到 clinepass')
assert.equal(planProviderIdOf('clinepass', enabledConfig.planBilling, 'x'), 'clinepass')
assert.equal(
  billingClassOf('cline-pass', 'cline-pass/deepseek-v4.1-flash', enabledConfig.planBilling, enabledPlanSetOf(enabledConfig)),
  'plan',
  '启用额度查询后订阅调用归 Plan 轨',
)

// ── 解析层:按夹具实际窗口断言,不假设固定档位 ──────────────────────
const parse = limits => parseClinePassUsage({ data: { limits }, success: true })

const threeWindows = parse([
  { type: 'five_hour', percentUsed: 4, resetsAt: '2026-10-19T13:27:27.52628613Z' },
  { type: 'weekly', percentUsed: 0.5, resetsAt: '2026-10-26T08:27:27.528144468Z' },
  { type: 'monthly', percentUsed: 0, resetsAt: '2026-11-18T08:27:27.530013742Z' },
])
assert.deepEqual(Object.keys(threeWindows), ['fiveHour', 'weekly', 'monthly'], '五个小时的 type 映射为 fiveHour')
assert.equal(threeWindows.fiveHour.percent, 4)
assert.equal(threeWindows.weekly.percent, 0.5, '0.5% 保持 0.5,不被 normalizePercent 放大成 50%')
assert.equal(threeWindows.monthly.percent, 0, '0% 是合法值')
assert.equal(threeWindows.fiveHour.resetsAt, '2026-10-19T13:27:27.526Z', '重置时间归一化为 ISO')

// 订阅档位不同 → 窗口数量不同:二档、单档、混合未知 type 都必须照实返回。
const shorter = [
  ['二档(周 + 月)', [
    { type: 'weekly', percentUsed: 12, resetsAt: '2026-10-26T08:27:27Z' },
    { type: 'monthly', percentUsed: 3, resetsAt: '2026-11-18T08:27:27Z' },
  ], ['weekly', 'monthly']],
  ['单档(仅月)', [{ type: 'monthly', percentUsed: 3 }], ['monthly']],
  ['未知 type 与已知混排', [
    { type: 'daily', percentUsed: 99 },
    { type: 'five_hour', percentUsed: 7, resetsAt: '2026-10-19T13:27:27Z' },
  ], ['fiveHour']],
]
for (const [label, limits, expected] of shorter) {
  const windows = parse(limits)
  assert.deepEqual(Object.keys(windows ?? {}), expected, label)
  for (const value of Object.values(windows)) {
    assert.ok(Number.isFinite(value.percent) && value.percent >= 0 && value.percent <= 100, label + ':百分比在 0-100')
  }
}

// 百分比边界:超过 100 封顶,负数/非数值跳过。
assert.equal(parse([{ type: 'five_hour', percentUsed: 130 }]).fiveHour.percent, 100, '>100 封顶')
const clamped = parse([
  { type: 'weekly', percentUsed: -1 },
  { type: 'monthly', percentUsed: 'NaN' },
  { type: 'five_hour', percentUsed: '6' },
])
assert.deepEqual(Object.keys(clamped), ['fiveHour'], '负数与非数值被跳过,数字字符串仍可用')
assert.equal(clamped.fiveHour.percent, 6)

// 无效类型不能被 Number() 伪装成 0/1:null、空串、纯空白、布尔、数组、对象、十六进制串都要跳过。
for (const invalid of [null, '', '   ', false, true, [], {}, 'abc', '0x10']) {
  assert.equal(parse([{ type: 'weekly', percentUsed: invalid }]), null, 'invalid percentUsed: ' + JSON.stringify(invalid))
}
// 合法值保留原始百分比含义:0 = 0%、0.5 = 0.5%、1 = 1%(不按 0-1 小数解释)。
const literal = parse([
  { type: 'five_hour', percentUsed: 0 },
  { type: 'weekly', percentUsed: 0.5 },
  { type: 'monthly', percentUsed: 1 },
])
assert.deepEqual(
  [literal.fiveHour.percent, literal.weekly.percent, literal.monthly.percent],
  [0, 0.5, 1],
  '0 / 0.5 / 1 的原义保持不变',
)
assert.equal(parse([{ type: 'weekly', percentUsed: ' 6 ' }]).weekly.percent, 6, '带空白的数字字符串可用')

// 完全不可用时不伪造窗口。
for (const bad of [null, {}, { data: null }, { data: { limits: {} } }, { data: { limits: [] } }, { data: { limits: [{ type: 'unknown', percentUsed: 3 }] } }]) {
  assert.equal(parseClinePassUsage(bad), null, '无可用窗口 → null: ' + JSON.stringify(bad))
}

// ── queryCodingPlan 接线:缺密钥软失败、401 软失败、Bearer 与解析 ─────
const originalFetch = globalThis.fetch
const t = (_locale, code) => code
try {
  await assert.rejects(queryCodingPlan('clinepass', null, 'zh', t), error => error.soft === true && error.message === 'codingPlanKeyMissing')
  await assert.rejects(queryCodingPlan('nobody', 'sk-x', 'zh', t), error => error.message === 'codingPlanUnknown')

  let calls = []
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return Response.json({ data: { limits: [
    { type: 'five_hour', percentUsed: 4, resetsAt: '2026-10-19T13:27:27Z' },
    { type: 'monthly', percentUsed: 0 },
  ] } }) }
  const result = await queryCodingPlan('clinepass', 'sk-test', 'en', t)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, ENDPOINT)
  assert.equal(calls[0].init.headers.authorization, 'Bearer sk-test')
  assert.equal(result.endpoint, ENDPOINT)
  assert.deepEqual(Object.keys(result.windows), ['fiveHour', 'monthly'], '网关少报窗口时照实返回')

  // 审查回归:percentUsed:null 不能被当成成功的 0% 窗口(曾返回 {weekly:{percent:0}})。
  globalThis.fetch = async () => Response.json({ success: true, data: { limits: [{ type: 'weekly', percentUsed: null }] } })
  await assert.rejects(queryCodingPlan('clinepass', 'sk-test', 'en', t), /codingPlanNoUsage/)

  globalThis.fetch = async () => new Response('', { status: 401 })
  await assert.rejects(
    queryCodingPlan('clinepass', 'sk-test', 'en', t),
    error => error.soft === true && error.message === 'codingPlanUnauthorized',
  )

  globalThis.fetch = async () => new Response('INTERNAL', { status: 500 })
  await assert.rejects(queryCodingPlan('clinepass', 'sk-test', 'en', t), /codingPlanHttp/)

  globalThis.fetch = async () => new Response('not json', { status: 200, headers: { 'content-type': 'text/plain' } })
  await assert.rejects(queryCodingPlan('clinepass', 'sk-test', 'en', t), /codingPlanInvalidJson/)
} finally {
  globalThis.fetch = originalFetch
}

// ── 双端源码登记:i18n 两份、设置卡片行、侧栏别名/短标签/识别提示 ────
const i18nSrc = readFileSync(resolve(root, 'src/client/01-open-styles-i18n.js'), 'utf8')
assert.equal(i18nSrc.split('codingPlanClinepass:').length - 1, 2, 'i18n 中英两份都有 codingPlanClinepass')
const panelsSrc = readFileSync(resolve(root, 'src/client/03-settings-panels-main.js'), 'utf8')
assert.ok(panelsSrc.includes("{ id: 'clinepass', labelKey: 'codingPlanClinepass' }"), '设置页额度卡片已登记')
const sidebarSrc = readFileSync(resolve(root, 'src/client/02-validators-helpers-sidebar.js'), 'utf8')
assert.ok(sidebarSrc.includes("clinepass: ['clinepass', 'cline-pass']"), '客户端别名镜像')
assert.ok(sidebarSrc.includes("clinepass: 'CP'"), '额度横条短标签')
assert.ok(sidebarSrc.includes('cline[._-]?pass|clinepass'), 'Plan/API 自动识别提示')

// ── 客户端卡片:有几个窗口画几行 ──────────────────────────────────────
const dir = new URL('../src/client/', import.meta.url)
const source = readdirSync(dir).filter(name => name.endsWith('.js')).sort()
  .map(name => readFileSync(new URL(name, dir), 'utf8')).join('')
let factory
vm.runInNewContext(source.replace('exports.apply = apply', 'exports.test = { CodingPlanBox }; exports.apply = apply'), {
  window: { __ModuleLoader__: { load: value => { factory = value.factory } }, localStorage: { getItem: () => null } },
  navigator: { language: 'zh' },
})
const el = (type, props, ...children) => ({ type, props: props ?? {}, children })
const React = {
  createElement: el,
  Fragment: 'fragment',
  useState: init => [typeof init === 'function' ? init() : init, () => {}],
  useEffect() {},
  useRef: value => ({ current: value }),
}
const ui = factory(name => name === 'react' ? React : { Tooltip: 'tooltip' }).test

const inSeconds = seconds => new Date(Date.now() + seconds * 1000).toISOString()
const stateWith = windows => ({
  config: { locale: 'zh', barDirections: { plan: 'used' } },
  codingPlans: {
    clinepass: {
      status: 'ok', message: '', fetchedAt: Date.now(), keyConfigured: true,
      windows: Object.fromEntries(Object.entries(windows).map(([name, win]) => [name, {
        percent: win.percent,
        resetsAt: win.resetsAt ?? inSeconds(3600),
      }])),
    },
  },
})
const textOf = node => node == null ? ''
  : typeof node === 'object'
    ? (Array.isArray(node) ? node.map(textOf).join(' ') : node.children.map(textOf).join(' '))
    : String(node)
const rowsOf = (node, out = []) => {
  if (node === null || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    node.forEach(child => rowsOf(child, out))
    return out
  }
  const cls = node.props?.className
  if (typeof cls === 'string' && cls.split(/\s+/).includes('cm-mm-row')) out.push(node)
  node.children.forEach(child => rowsOf(child, out))
  return out
}
const LABELS = { fiveHour: '5h', weekly: '周', monthly: '月' }

const cases = [
  ['三档', { fiveHour: { percent: 4 }, weekly: { percent: 1 }, monthly: { percent: 0 } }],
  ['二档', { weekly: { percent: 12 }, monthly: { percent: 3 } }],
  ['单档', { monthly: { percent: 3 } }],
]
for (const [label, windows] of cases) {
  const state = stateWith(windows)
  const card = ui.CodingPlanBox({ id: 'clinepass', state })
  assert.ok(card, label + ':侧栏卡片存在')
  const body = card.children[0]
  const bodyText = textOf(body)
  const names = Object.keys(windows)
  assert.match(bodyText, /Cline Pass/, label + ':卡片标题')
  assert.equal(rowsOf(body).length, names.length, label + ':窗口几行就画几行')
  for (const name of names) {
    assert.match(bodyText, new RegExp(LABELS[name]), label + ':窗口标签 ' + name)
    assert.match(bodyText, new RegExp(Math.round(windows[name].percent) + '%'), label + ':百分比 ' + name)
  }
  const railText = textOf(ui.CodingPlanBox({ id: 'clinepass', state, wide: false }).children[0])
  const expectedRail = names.slice(0, 2).map(name => Math.round(windows[name].percent) + '%').join(' ')
  assert.match(railText, new RegExp(expectedRail.replace(' ', '\\s+')), label + ':收窄侧栏百分比')
}

// 空响应保留卡片与重试入口，不伪造额度进度。
const emptyCard = ui.CodingPlanBox({ id: 'clinepass', state: stateWith({}) })
assert.match(textOf(emptyCard), /暂无额度数据/)
assert.equal(rowsOf(emptyCard).length, 0, '无窗口不渲染额度进度')

console.log('[ok] Cline Pass: adapter, partial windows, wiring and one-card rendering')
