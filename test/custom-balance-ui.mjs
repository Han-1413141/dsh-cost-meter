import { withCustomBalanceEditor } from './custom-balance-editor-fixture.mjs'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync, readdirSync } from 'node:fs'
import { sanitizeConfig, applyConfigPatch } from '../lib/store.js'

// 执行真实客户端组件及回调：覆盖新增、展开、凭据输入、删除与读取币种。
// 仅在测试 VM 中暴露闭包函数，不在发布 bundle 中增加测试接口。
const dir = new URL('../src/client/', import.meta.url)
const source = withCustomBalanceEditor(readdirSync(dir).filter(name => name.endsWith('.js')).sort().map(name => readFileSync(new URL(name, dir), 'utf8')).join(''))
const code = source.replace('exports.apply = apply', 'exports.test = { QuotasSection, CustomBalanceEntryPanel, CustomBalanceEntryRow, CustomBalanceEntryBox, customBalanceUnitOf, formatCustomBalanceMoney, segmentsForCustomBalance, customBalanceDetailText, parseConfig, makeT, fixedAmount }; exports.apply = apply')
let factory
let slots = []
let cursor = 0
const react = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  Fragment: 'fragment',
  useState: initial => {
    const i = cursor++
    if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
    return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next }]
  },
  useRef: value => ({ current: value }), useEffect() {},
}
function verifyCreditsUI() {
  const entry = { enabled: true, unit: 'CREDITS', request: { url: 'http://127.0.0.1:3080/status' } }
  const config = sanitizeConfig({ decimals: 4, exchangeRate: 100, customBalances: [entry], balance: { budgetCap: 10000, showProgressBar: true } })
  const live = { status: 'ok', unit: 'CREDITS', remaining: 0.125, spend: 1.875, maxBudget: 2, fetchedAt: 0 }
  const state = { config, today: { cost: 1000 }, customBalance: live }
  assert.equal(ui.formatCustomBalanceMoney(live.remaining, config, live, entry), '0.125 Credits')
  const segments = ui.segmentsForCustomBalance(state, config, live, entry)
  assert.equal(segments.cap, 2, '积分上限来自接口，不借用全局货币预算')
  assert.equal(segments.todayPct, 0, '美元消费不转换为积分')
  assert.equal(segments.remainingPct, 6.25)
  assert.equal(ui.segmentsForCustomBalance(state, config, { ...live, maxBudget: null }, entry).cap, null)
  const detail = ui.customBalanceDetailText(live, config, ui.makeT('en'), state, entry)
  assert.ok(!detail.includes('10000'))
  assert.equal(ui.parseConfig(config, 'config').customBalances[0].unit, 'CREDITS')
}
vm.runInNewContext(code, { window: { __ModuleLoader__: { load: value => { factory = value.factory } } }, navigator: { language: 'en' } })
const ui = factory(name => name === 'react' ? react : {}).test
// 额度区统一后卡片外壳为 QuotaCard 组件:渲染时多展开一层,拿到内部节点。
const render = (component, props) => {
  cursor = 0
  const tree = component(props)
  return tree && typeof tree.type === 'function' && tree.type !== 'fragment' ? tree.type(tree.props) : tree
}
const nodes = tree => tree && typeof tree === 'object' ? [tree, ...(tree.children ?? []).flatMap(nodes)] : []
const textOf = tree => typeof tree === 'string' ? tree : (tree?.children ?? []).map(textOf).join('')
const button = (tree, label) => nodes(tree).find(node => node.type === 'button' && textOf(node) === label)

for (const locale of ['zh', 'en']) {
  slots = []
  const config = sanitizeConfig({ locale })
  let draft = structuredClone(config)
  const t = ui.makeT(locale)
  const state = { config, customBalances: [], customVarStatus: {} }
  const panelProps = () => ({ state, draft, setDraft: value => { draft = value }, api: {}, t })
  let tree = render(ui.QuotasSection, panelProps())
  button(tree, t('aliyunBalanceAdd')).props.onClick()
  assert.equal(draft.customBalances.length, 1)
  assert.equal(draft.customBalances[0].adapter, 'aliyun')
  assert.equal(draft.customBalances[0].request.method, 'POST')
  assert.deepEqual(applyConfigPatch(config, draft).errors, [], '新增入口生成可保存配置')
  const parsed = ui.parseConfig(sanitizeConfig(draft), 'config')
  assert.equal(parsed.customBalances[0].adapter, 'aliyun', '刷新后类型不丢失')
  tree = render(ui.QuotasSection, panelProps())
  const entryNode = nodes(tree).find(node => node.type === ui.CustomBalanceEntryPanel)
  slots = []
  let card = render(ui.CustomBalanceEntryPanel, entryNode.props)
  assert.ok(button(card, t('quotaRemove')), '仅剩一条也可删除')
  nodes(card).find(node => node.props.className === 'cm-collapse-h').props.onClick()
  card = render(ui.CustomBalanceEntryPanel, entryNode.props)
  assert.ok(textOf(card).includes(t('aliyunBalanceNote')))
  assert.ok(!textOf(card).includes(t('customBalanceUrl')), '固定 adapter 不展示无效 HTTP 配置')
  const fields = nodes(card).filter(node => node.props.target?.startsWith('customVar:'))
  assert.equal(fields.length, 3)
  assert.ok(fields.some(node => node.props.target === 'customVar:ALIBABA_CLOUD_ACCESS_KEY_SECRET'))
  assert.equal(ui.customBalanceUnitOf(config, { unit: 'CNY' }, { adapter: 'aliyun', unit: 'USD' }), 'CNY')
  assert.equal(ui.customBalanceUnitOf(config, { unit: 'USD' }, { adapter: 'aliyun', unit: 'CNY' }), 'USD')
  button(card, t('quotaRemove')).props.onClick()
  assert.equal(applyConfigPatch(config, draft).config.customBalances.length, 0)
}
verifyCreditsUI()

// #310: the one-click preset is editable, uses the management token and keeps credits distinct.
for (const locale of ['zh', 'en']) {
  slots = []
  const config = sanitizeConfig({ locale })
  let draft = structuredClone(config)
  const t = ui.makeT(locale), state = { config, customBalances: [], customVarStatus: {} }
  let tree = render(ui.QuotasSection, { state, draft, setDraft: value => { draft = value }, api: {}, t })
  button(tree, t('workBuddyBalanceAdd')).props.onClick()
  const saved = applyConfigPatch(config, draft)
  assert.deepEqual(saved.errors, [])
  const entry = ui.parseConfig(saved.config, 'config').customBalances[0]
  assert.equal(entry.unit, 'CREDITS')
  assert.equal(entry.enabled, false)
  assert.equal(entry.request.url, 'http://127.0.0.1:8790/api/credits/expiry?package_limit=1')
  assert.equal(entry.request.headers['X-Admin-Token'], '{{WORKBUDDY2API_ADMIN_TOKEN}}')
  assert.equal(entry.extract.remaining, 'summary.available_remaining')
  slots = []
  let patch
  const props = { state: { ...state, config: saved.config }, entry, index: 0, onPatch: value => { patch = value }, api: {}, t }
  let card = render(ui.CustomBalanceEntryPanel, props)
  nodes(card).find(node => node.props.className === 'cm-collapse-h').props.onClick()
  card = render(ui.CustomBalanceEntryPanel, props)
  assert.ok(nodes(card).some(node => node.props.target === 'customVar:WORKBUDDY2API_ADMIN_TOKEN'))
  const httpLabel = nodes(card).find(node => node.type === 'label' && textOf(node).includes(t('customBalanceHttp')))
  httpLabel.children.find(node => node.type === 'input').props.onChange({ target: { checked: true } })
  assert.equal(patch.allowInsecureHttp, true)
  assert.equal(ui.parseConfig(sanitizeConfig({ customBalances: [{ ...entry, ...patch }] }), 'config').customBalances[0].allowInsecureHttp, true)
}

// #290：专用入口生成可保存配置，Cookie 走凭据 RPC，固定接口不显示 HTTP 编辑项。
for (const locale of ['zh', 'en']) {
  slots = []
  const config = sanitizeConfig({ locale })
  let draft = structuredClone(config)
  const t = ui.makeT(locale), state = { config, customBalances: [], customVarStatus: {} }
  const props = () => ({ state, draft, setDraft: value => { draft = value }, api: {}, t })
  let tree = render(ui.QuotasSection, props())
  button(tree, t('tokenRhythmBalanceAdd')).props.onClick()
  assert.equal(draft.customBalances[0].adapter, 'tokenrhythm')
  assert.equal(draft.customBalances[0].unit, 'CNY')
  assert.equal(draft.customBalances[0].request.method, 'GET')
  const saved = applyConfigPatch(config, draft)
  assert.deepEqual(saved.errors, [])
  assert.equal(ui.parseConfig(saved.config, 'config').customBalances[0].adapter, 'tokenrhythm')
  tree = render(ui.QuotasSection, props())
  const entryNode = nodes(tree).find(node => node.type === ui.CustomBalanceEntryPanel)
  slots = []
  let card = render(ui.CustomBalanceEntryPanel, entryNode.props)
  nodes(card).find(node => node.props.className === 'cm-collapse-h').props.onClick()
  card = render(ui.CustomBalanceEntryPanel, entryNode.props)
  assert.ok(textOf(card).includes(t('tokenRhythmBalanceNote')))
  for (const key of ['customBalanceUrl', 'customBalanceHeaders', 'customBalanceExtract', 'customBalanceUnitLabel']) assert.ok(!textOf(card).includes(t(key)))
  const fields = nodes(card).filter(node => node.props.target?.startsWith('customVar:'))
  assert.equal(fields.length, 1)
  assert.equal(fields[0].props.target, 'customVar:TOKENRHYTHM_COOKIE')
  assert.equal(fields[0].props.placeholder, 'tr_session=…')
  assert.equal(ui.formatCustomBalanceMoney(68.125, config, { unit: 'CNY' }, saved.config.customBalances[0]), '¥68.125')
  const budgetConfig = { ...config, balance: { ...config.balance, budgetCap: 200, showProgressBar: true } }
  const live = { status: 'ok', remaining: 68.125, unit: 'CNY', spend: null, maxBudget: null }
  assert.equal(ui.segmentsForCustomBalance(state, budgetConfig, live, saved.config.customBalances[0]).cap, null, 'Token Rhythm 不借用其他账户预算生成进度')
  assert.ok(!ui.customBalanceDetailText(live, budgetConfig, t, state, saved.config.customBalances[0]).includes('200'))
  button(card, t('quotaRemove')).props.onClick()
  assert.equal(applyConfigPatch(config, draft).config.customBalances.length, 0)
}

// #165: edit the actual POST payload without rewriting JSON numbers or strings.
for (const locale of ['zh', 'en']) {
  slots = []
  const config = sanitizeConfig({ locale, customBalances: [{ request: { url: 'https://balance.example/query', method: 'GET' } }] })
  let entry = structuredClone(config.customBalances[0]), patches = 0
  const t = ui.makeT(locale), state = { config, customBalances: [], customVarStatus: {} }
  const props = () => ({ state, api: {}, t, entry, index: 0, onPatch: patch => { entry = { ...entry, ...patch }; patches++ } })
  const field = (tree, label, type = 'textarea') => nodes(tree).find(node =>
    node.type === 'div' && node.children.some(child => child?.type === 'label' && textOf(child) === t(label)))?.children.find(child => child?.type === type)
  let tree = render(ui.CustomBalanceEntryPanel, props())
  nodes(tree).find(node => node.props.className === 'cm-collapse-h').props.onClick()
  tree = render(ui.CustomBalanceEntryPanel, props())
  assert.ok(textOf(tree).includes(t('customBalanceHeadersVarNote')), 'header credential guidance is rendered in both languages')
  assert.equal(field(tree, 'customBalanceBody'), undefined, 'GET has no body editor')
  field(tree, 'customBalanceMethod', 'select').props.onChange({ target: { value: 'POST' } })
  const update = (label, value) => {
    tree = render(ui.CustomBalanceEntryPanel, props())
    field(tree, label).props.onChange({ target: { value } })
    tree = render(ui.CustomBalanceEntryPanel, props())
  }
  const raw = '{\n  "account": "测试", "id": 9007199254740993, "filter": {"active":true}\n}'
  for (const value of [raw, '[]', 'null', 'false', '0', '"a JSON string"']) {
    update('customBalanceBody', value)
    assert.equal(entry.request.body, value, 'JSON is sent as entered, including top-level strings')
    const saved = applyConfigPatch(config, JSON.parse(JSON.stringify({ customBalances: [entry] })))
    assert.deepEqual(saved.errors, [])
    assert.equal(ui.parseConfig(saved.config, 'config').customBalances[0].request.body, value)
  }
  const beforeInvalid = patches, previousBody = entry.request.body
  update('customBalanceBody', '{"account":')
  assert.equal(patches, beforeInvalid, 'invalid JSON never enters the saved configuration')
  assert.equal(entry.request.body, previousBody)
  assert.equal(field(tree, 'customBalanceBody').props.value, '{"account":')
  assert.ok(textOf(tree).includes(t('customBalanceInvalidJson')))
  update('customBalanceBody', raw)
  assert.ok(!textOf(tree).includes(t('customBalanceInvalidJson')))
  field(tree, 'customBalanceMethod', 'select').props.onChange({ target: { value: 'GET' } })
  tree = render(ui.CustomBalanceEntryPanel, props())
  assert.equal(field(tree, 'customBalanceBody'), undefined)
  assert.equal(entry.request.body, raw, 'GET hides but retains the configured POST body')
  field(tree, 'customBalanceMethod', 'select').props.onChange({ target: { value: 'POST' } })
  tree = render(ui.CustomBalanceEntryPanel, props())
  assert.equal(field(tree, 'customBalanceBody').props.value, raw)
  update('customBalanceBody', ' \n ')
  const cleared = applyConfigPatch(config, JSON.parse(JSON.stringify({ customBalances: [entry] }))).config
  assert.equal(cleared.customBalances[0].request.body, undefined)
  update('customBalanceHeaders', '{"X-Account":"{{ACCOUNT_ID}}","X-Other":"{{ACCOUNT_ID}} {{OTHER_ID}}"}')
  assert.deepEqual(nodes(tree).filter(n => n.props.target?.startsWith('customVar:')).map(n => n.props.target), ['customVar:ACCOUNT_ID', 'customVar:OTHER_ID'])
  const beforeBadHeaders = patches
  update('customBalanceHeaders', '{"X-Account":42}')
  assert.equal(patches, beforeBadHeaders, 'headers still require string values')
  update('customBalanceExtract', '{"remaining":"data.balance"}')
  assert.equal(entry.extract.remaining, 'data.balance')
  const beforeBadExtract = patches
  update('customBalanceExtract', '[]')
  assert.equal(patches, beforeBadExtract, 'extract still requires an object')
  for (const savedBody of [{ nested: [1, false, null] }, 'legacy=raw-text']) {
    slots = []
    entry = { ...entry, request: { ...entry.request, body: savedBody } }
    tree = render(ui.CustomBalanceEntryPanel, props())
    nodes(tree).find(node => node.props.className === 'cm-collapse-h').props.onClick()
    tree = render(ui.CustomBalanceEntryPanel, props())
    assert.equal(field(tree, 'customBalanceBody').props.value, typeof savedBody === 'string' ? savedBody : JSON.stringify(savedBody, null, 2))
    assert.deepEqual(entry.request.body, savedBody, 'opening the editor preserves existing request bodies')
  }
}

// #162: convert only USD at presentation time; never rewrite the source balance.
{
  const raw = { status: 'ok', unit: 'USD', remaining: 54.3792, spend: 45.6208, maxBudget: 100, fetchedAt: 0, index: 0 }
  const before = JSON.stringify(raw)
  const entry = { enabled: true, unit: 'USD', display: 'both', request: { url: 'https://balance.example/status' } }
  const config = sanitizeConfig({ decimals: 2, currency: 'CNY', symbol: '¥', exchangeRate: 7.2, customBalances: [entry] })
  const enabled = { ...config.customBalances[0], convertToDisplayCurrency: true }
  const format = (cfg = config, balance = raw, row = enabled) => ui.formatCustomBalanceMoney(balance.remaining, cfg, balance, row)
  assert.equal(format(config, raw, entry), '$54.38', '开关缺省关闭，保留源币种')
  assert.equal(format(), '¥391.53', '余额数值和符号一起换算')
  assert.equal(format({ ...config, decimals: 4 }), '¥391.5302')
  assert.equal(format({ ...config, decimals: 0 }), '¥392')
  assert.equal(format({ ...config, currency: 'USD', symbol: '$' }), '$54.38', '同币种不再次乘汇率')
  assert.equal(format({ ...config, currency: 'EUR', symbol: '€', exchangeRate: 0.92 }), '€50.03')
  assert.equal(format({ ...config, currency: 'custom', symbol: '£', exchangeRate: 0.8 }), '£43.5')
  for (const rate of [0, -1, NaN, Infinity]) assert.equal(format({ ...config, exchangeRate: rate }), '$54.38', '无效汇率保留原币种')
  assert.equal(format(config, { ...raw, remaining: Number.MAX_VALUE }), '—', '换算溢出不能显示 Infinity')
  assert.equal(format(config, { ...raw, remaining: 0 }), '¥0')
  assert.equal(format(config, { ...raw, remaining: -10 }), '¥-72')
  for (const [unit, expected] of [['CNY', '¥54.38'], ['EUR', '€54.38'], ['CREDITS', '54.38 Credits']]) {
    assert.equal(format(config, { ...raw, unit }, { ...enabled, unit }), expected)
  }
  assert.equal(format(config, { ...raw, unit: 'CNY' }, { ...enabled, adapter: 'aliyun' }), '¥54.38', '阿里云以返回币种为准')
  assert.equal(ui.formatCustomBalanceMoney(raw.remaining, { ...config, customBalance: enabled }, raw), '¥391.53', '旧单条路径支持转换')
  assert.equal(format({ ...config, customBalance: enabled }, raw, entry), '$54.38', '条目配置覆盖旧单条配置')
  for (const locale of ['en', 'zh']) {
    const t = ui.makeT(locale)
    for (const showProgressBar of [false, true]) {
      const cfg = { ...config, locale, balance: { ...config.balance, showProgressBar } }
      const state = { config: cfg, today: { cost: 1 }, customBalances: [raw] }
      const detail = ui.customBalanceDetailText(raw, cfg, t, state, enabled)
      assert.ok(detail.includes('¥391.53') && detail.includes('¥720'))
      assert.ok(!detail.includes('$'))
      if (showProgressBar) {
        assert.ok(detail.includes('¥7.2'), '当日支出只换算一次')
        assert.deepEqual(ui.segmentsForCustomBalance(state, cfg, raw, enabled), ui.segmentsForCustomBalance(state, cfg, raw, entry), '转换不改变进度比例')
      } else assert.ok(detail.includes('¥328.47'))
      const manual = { ...cfg, balance: { ...cfg.balance, budgetCap: 200 } }
      assert.ok(ui.customBalanceDetailText(raw, manual, t, state, enabled).includes('¥1440'), '手动上限按原币种输入、显示时一起换算')
      slots = []
      const rendered = render(showProgressBar ? ui.CustomBalanceEntryBox : ui.CustomBalanceEntryRow, { state, entry: enabled, snapshot: raw, index: 0, wide: true, t })
      assert.ok(textOf(rendered).includes('¥391.53'), '侧栏余额行和图框均转换')
    }
    slots = []
    let edited = { ...enabled, convertToDisplayCurrency: false }
    const patches = []
    const panel = () => render(ui.CustomBalanceEntryPanel, {
      state: { config, customBalances: [raw] }, entry: edited, index: 0, t, api: {},
      onPatch: patch => { patches.push(patch); edited = { ...edited, ...patch } },
    })
    nodes(panel()).find(node => node.props.className === 'cm-collapse-h').props.onClick()
    const checkbox = () => nodes(panel()).find(node => node.type === 'label' && textOf(node) === t('customBalanceConvert')).children[0]
    assert.equal(checkbox().props.checked, false)
    checkbox().props.onChange({ target: { checked: true } })
    assert.deepEqual(patches.map(p => JSON.parse(JSON.stringify(p))), [{ convertToDisplayCurrency: true }])
    const saved = applyConfigPatch(config, { customBalances: [edited] })
    assert.deepEqual(saved.errors, [])
    edited = ui.parseConfig(saved.config, 'config').customBalances[0]
    assert.equal(checkbox().props.checked, true, '回读不丢开关')
    assert.ok(textOf(panel()).includes('¥391.53'), '设置页预览即时转换')
    edited = { ...edited, unit: 'CREDITS' }
    assert.equal(checkbox().props.disabled, true)
    edited = { ...edited, unit: 'USD' }
    checkbox().props.onChange({ target: { checked: false } })
    assert.ok(textOf(panel()).includes('$54.38'), '关闭恢复原币种')
  }
  assert.equal(JSON.stringify(raw), before, '任何显示切换都不改原始快照')
}
// Shared fixed-decimal formatter retains integer zeros, trims only fractional zeros.
for (const [value, digits, expected] of [[100, 0, '100'], [100, 2, '100'], [1.2, 4, '1.2'], [-1.25, 3, '-1.25'], [1e21, 2, '1e+21'], [0.00001, 6, '0.00001']]) {
  assert.equal(ui.fixedAmount(value, digits), expected)
}
console.log('[ok] 自定义余额界面：双语新增/展开/凭据行/删除/币种与配置往返通过')
