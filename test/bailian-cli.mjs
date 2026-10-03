import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import {
  parseBailianUsage, queryBailianCli,
  BAILIAN_TOKEN_PLAN_ARGS, BAILIAN_CODING_PLAN_ARGS,
} from '../lib/bailian-cli.js'
import { resolveNpmCli } from '../lib/cli-bridge.js'
import { applyConfigPatch, sanitizeConfig } from '../lib/store.js'
import { TYPERT } from '../lib/typert.host.js'
import { apply } from '../lib/index.js'

// ── 解析器:真实形态(本机实测 bl usage coding-plan 2.0.1)与合并规则 ──
const codingPayload = {
  per5Hour: { usedQuota: 0, totalQuota: 6000, resetTime: 1790094288000, percentage: 0 },
  perWeek: { usedQuota: 900, totalQuota: 45000, resetTime: 1790524800000, percentage: 0.02 },
  perBillMonth: { usedQuota: 77, totalQuota: 90000, resetTime: 1792252800000, percentage: 0.0008555555555555556 },
  instanceType: 'pro',
}
const windows = parseBailianUsage({ token: {}, coding: codingPayload }, 'en').windows
assert.equal(windows.fiveHour.percent, 0)
assert.equal(windows.fiveHour.resetsAt, new Date(1790094288000).toISOString(), 'epoch ms resetTime becomes ISO')
assert.equal(windows.weekly.percent, 2)
assert.equal(windows.monthly.percent, 0.1, 'CLI ratios become percent with one decimal place')
assert.equal(windows.monthly.resetsAt, new Date(1792252800000).toISOString())
assert.equal(windows.source.text, 'Coding Plan (pro) (CLI)')

// Token Plan 优先同名 5h/周窗;Coding Plan 独占月窗;来源行合并。
const merged = parseBailianUsage({
  token: { per5HourPercentage: 0.55, per5HourResetTime: 0 },
  coding: codingPayload,
}).windows
assert.equal(merged.fiveHour.percent, 55, 'Token Plan wins the shared 5h window')
assert.equal(merged.fiveHour.resetsAt, '', 'zero resetTime renders no boundary')
assert.equal(merged.weekly.percent, 2, 'Coding Plan fills the unshared window')
assert.equal(merged.monthly.percent, 0.1)
assert.equal(merged.source.text, 'Token Plan + Coding Plan (pro) (CLI)')

// percentage 缺失按 used/total 推算;上限为 0/缺失的窗口跳过;无 instanceType 时来源降级。
const derived = parseBailianUsage({ token: null, coding: {
  per5Hour: { usedQuota: 5, totalQuota: 0, percentage: 100 },
  perWeek: { usedQuota: 450, totalQuota: 45000 },
} }).windows
assert.equal(derived.fiveHour, undefined, 'unbounded window produces no percent')
assert.equal(derived.weekly.percent, 1, 'percentage derived from used/total')
assert.equal(derived.source.text, 'Coding Plan (CLI)')

// 非法形态 → invalid;双空 → unavailable(soft)。
for (const bad of [
  { token: [], coding: null },
  { token: 'x', coding: null },
  { token: { per5HourPercentage: 'no' }, coding: null },
  { token: null, coding: { perWeek: [1] } },
]) assert.throws(() => parseBailianUsage(bad, 'en'), { code: 'invalid' })
for (const bad of [null, '', true, -1, Infinity, '0.5']) {
  assert.throws(() => parseBailianUsage({ token: { per5HourPercentage: bad } }), { code: 'invalid' })
}
assert.equal(parseBailianUsage({ token: { per1WeekPercentage: 0 }, coding: [] }).windows.weekly.percent, 0)
assert.equal(parseBailianUsage({ token: 'bad', coding: codingPayload }).windows.weekly.percent, 2, 'Invalid source cannot hide a valid subscription')
assert.throws(() => parseBailianUsage({ token: { per5HourPercentage: 0.5, per5HourResetTime: 1e30 } }), { code: 'invalid' })
assert.equal(parseBailianUsage({ token: { per5HourPercentage: 0.5, per1WeekPercentage: 1 } }).windows.fiveHour.percent, 50)
for (const empty of [{ token: {}, coding: {} }, { token: null, coding: null }, { token: {}, coding: { instanceType: 'pro' } }]) {
  assert.throws(() => parseBailianUsage(empty, 'en'), e => e.code === 'unavailable' && e.soft === true)
}

// ── 配置三态:local / cli / bailian ──
assert.equal(sanitizeConfig({ codingPlans: { qwen: { quotaSource: 'bailian' } } }).codingPlans.qwen.quotaSource, 'bailian')
assert.equal(applyConfigPatch(sanitizeConfig({}), { codingPlans: { qwen: { quotaSource: 'bailian' } } }).config.codingPlans.qwen.quotaSource, 'bailian')
for (const value of [undefined, null, 'BAILIAN', 'bailian ', 'auto', 1, true]) {
  assert.equal(sanitizeConfig({ codingPlans: { qwen: { quotaSource: value } } }).codingPlans.qwen.quotaSource, 'local')
}

// ── 真实子进程:合成 npm 布局的 bailian-cli 包(路径含 shell 元字符) ──
const root = mkdtempSync(join(tmpdir(), 'cm-bailian-'))
const bin = join(root, 'CLI 空格 & percent%')
const pkg = join(bin, 'node_modules', 'bailian-cli')
const entry = join(pkg, 'dist', 'bailian.mjs')
const fixture = join(root, 'response.json'), calls = join(root, 'calls.jsonl')
const env = { ...process.env, PATH: bin }
for (const key of Object.keys(env)) if (key !== 'PATH' && key.toLowerCase() === 'path') delete env[key]
const options = { env }
const DEFAULT = () => ({ token: { payload: {} }, coding: { payload: codingPayload } })
const setResponse = value => writeFileSync(fixture, JSON.stringify({ ...DEFAULT(), ...value }))
const readCalls = () => existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : []
const count = () => readCalls().length
const until = async predicate => {
  for (let i = 0; i < 400; i++) { if (predicate()) return; await delay(10) }
  throw new Error('fixture condition timed out')
}
const savedEnv = { PATH: process.env.PATH, DSH_HOME: process.env.DSH_HOME }
const cleanups = []
try {
  mkdirSync(dirname(entry), { recursive: true })
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'bailian-cli', type: 'module', bin: { bl: 'dist/bailian.mjs', bailian: 'dist/bailian.mjs' } }))
  // 毒 shim:Windows 解析绝不能落到 npm 的 .cmd/.ps1 包装脚本上。
  writeFileSync(join(bin, 'bl.cmd'), '@echo SHOULD_NOT_EXECUTE_THIS_SHIM\r\nexit /b 99\r\n')
  const program = `import fs from 'node:fs';
const config = JSON.parse(fs.readFileSync(${JSON.stringify(fixture)}, 'utf8'));
const which = process.argv.includes('token-plan') ? 'token' : 'coding';
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2)) + '\\n');
const spec = config[which] ?? {};
if (spec.wait) await new Promise(r => setTimeout(r, spec.wait));
if (spec.stderr) process.stderr.write(spec.stderr);
if (spec.exit) process.exit(spec.exit);
process.stdout.write(spec.raw ?? JSON.stringify(spec.payload ?? {}));
`
  writeFileSync(entry, program)
  writeFileSync(join(bin, 'bl'), `#!${process.execPath}\nimport(${JSON.stringify(pathToFileURL(entry).href)});\n`)
  chmodSync(join(bin, 'bl'), 0o755)

  // resolve:npm 布局 → Node 直跑入口;相对/空 PATH 拒绝;Unix 走裸 bl。
  const command = await resolveNpmCli({ packageName: 'bailian-cli', binName: 'bl', env, platform: 'win32' })
  assert.equal(command.file, process.execPath)
  assert.deepEqual(command.args, [entry])
  assert.equal(await resolveNpmCli({ packageName: 'bailian-cli', binName: 'bl', env: { PATH: '.;' }, platform: 'win32' }), null)
  assert.deepEqual(await resolveNpmCli({ packageName: 'bailian-cli', binName: 'bl', env, platform: 'linux' }), { file: join(bin, 'bl'), args: [] })

  setResponse({})
  const first = await queryBailianCli('en', options)
  assert.equal(first.windows.source.text, 'Coding Plan (pro) (CLI)')
  const argvs = readCalls()
  assert.equal(argvs.length, 2, 'one query runs both read-only subcommands')
  assert.deepEqual(new Set(argvs.map(a => a.join('|'))), new Set([BAILIAN_TOKEN_PLAN_ARGS.join('|'), BAILIAN_CODING_PLAN_ARGS.join('|')]))

  // 单命令失败 → 另一来源作答;双命令失败 → 分类错误且绝不回吐子进程输出。
  setResponse({ token: { exit: 3, stderr: 'SECRET_TOKEN_OUTPUT' } })
  assert.equal((await queryBailianCli('en', options)).windows.source.text, 'Coding Plan (pro) (CLI)')
  setResponse({ token: { exit: 3, stderr: 'SECRET_A' }, coding: { exit: 3, stderr: 'SECRET_B' } })
  await assert.rejects(queryBailianCli('en', options), e => e.code === 'failed' && !JSON.stringify(e).includes('SECRET') && !e.message.includes('SECRET'))
  setResponse({ token: { raw: 'SECRET_INVALID' }, coding: { raw: 'SECRET_INVALID' } })
  await assert.rejects(queryBailianCli('en', { ...options, maxBuffer: 2048 }), e => e.code === 'invalid' && !JSON.stringify(e).includes('SECRET'))
  setResponse({ token: { raw: 'x'.repeat(10000) }, coding: { raw: 'x'.repeat(10000) } })
  await assert.rejects(queryBailianCli('en', { ...options, maxBuffer: 2048 }), e => e.code === 'invalid' && !JSON.stringify(e).includes('SECRET'))
  // 超时:双命令都超时 → timeout;单边超时 → 另一来源仍作答。
  setResponse({ token: { wait: 1000 }, coding: { wait: 1000 } })
  await assert.rejects(queryBailianCli('en', { ...options, timeoutMs: 100 }), { code: 'timeout' })
  // Allow a healthy Node child to start on a busy Windows host, while the other
  // command still exceeds the deadline. This tests partial timeout, not CPU speed.
  setResponse({ token: { wait: 5000 }, coding: { payload: codingPayload } })
  assert.equal((await queryBailianCli('en', { ...options, timeoutMs: 1500 })).windows.source.text, 'Coding Plan (pro) (CLI)')
  // 取消与缺失。
  setResponse({ token: { wait: 1000 }, coding: { wait: 1000 } })
  const controller = new AbortController()
  const cancellation = queryBailianCli('en', { ...options, signal: controller.signal })
  controller.abort()
  await assert.rejects(cancellation)
  await assert.rejects(queryBailianCli('en', { env: { PATH: '.;' }, platform: 'win32' }), e => e.code === 'missing' && e.soft === true)

  // ── e2e:三态配置、调度、缓存、账本与 codec ──
  process.env.PATH = bin
  process.env.DSH_HOME = join(root, 'dsh')
  const services = {}
  apply({ on: () => () => {}, inject() {}, get: () => undefined, logger: { info() {}, warn() {}, error() {} },
    effect: fn => { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
    provide: (name, service) => { services[name] = service },
  })
  const api = services.costMeter
  const codec = state => {
    const result = TYPERT.invocations.find(x => x.method === 'getState').result.schema.safeParse(JSON.parse(JSON.stringify(state)))
    assert.equal(result.success, true, result.success ? '' : JSON.stringify(result.error.issues))
  }
  const start = count()
  let state = await api.updateConfig({ locale: 'en', codingPlans: { qwen: { enabled: true, display: 'both' } } })
  assert.equal(state.codingPlans.qwen.quotaSource, 'local')
  assert.equal(count(), start, 'local mode never runs the CLI')

  setResponse({})
  await api.updateConfig({ codingPlans: { qwen: { quotaSource: 'bailian' } } })
  let result = await api.refreshCodingPlan('qwen')
  assert.equal(result.ok, true)
  state = result.state
  codec(state)
  assert.equal(state.codingPlans.qwen.quotaSource, 'bailian')
  assert.equal(state.codingPlans.qwen.windows.fiveHour.percent, 0)
  assert.equal(state.codingPlans.qwen.windows.source.text, 'Coding Plan (pro) (CLI)')
  const afterRefresh = count()
  assert.equal(afterRefresh, start + 2, 'e2e refresh runs both subcommands')
  await api.getState(); await api.getState()
  assert.equal(count(), afterRefresh, 'polls reuse the CLI result')
  assert.equal(state.planStats.providers.qwen, undefined, 'no local estimates from an unknown CLI billing period')

  const readLedger = () => JSON.parse(readFileSync(join(process.env.DSH_HOME, 'storages', 'cost-meter', 'ledger.json'), 'utf8'))
  await until(() => existsSync(join(process.env.DSH_HOME, 'storages', 'cost-meter', 'ledger.json')) && readLedger().config.codingPlans.qwen.quotaSource === 'bailian')
  assert.equal(readLedger().config.codingPlans.qwen.quotaSource, 'bailian', 'disk persists the Bailian source')

  // 并发刷新合并为一次查询(两个子进程)。
  setResponse({ token: { wait: 200 }, coding: { wait: 200 } })
  const concurrentStart = count()
  await Promise.all([api.refreshCodingPlan('qwen'), api.refreshCodingPlan('qwen'), api.refreshCodingPlan('qwen')])
  assert.equal(count(), concurrentStart + 2, 'concurrent refreshes share one query pair')

  // soft 失败:有登录态但无任何订阅 → off + 中性文案。
  setResponse({ token: { payload: {} }, coding: { payload: {} } })
  result = await api.refreshCodingPlan('qwen')
  assert.equal(result.ok, false)
  assert.equal(result.state.codingPlans.qwen.status, 'off')
  assert.match(result.message, /no valid plan quota/)
  assert.deepEqual(result.state.codingPlans.qwen.windows, {})
  // 硬失败:双命令退出 → error + 登录提示,错误遵守查询间隔。
  setResponse({ token: { exit: 3, stderr: 'SECRET_CHILD_A' }, coding: { exit: 3, stderr: 'SECRET_CHILD_B' } })
  result = await api.refreshCodingPlan('qwen')
  assert.equal(result.ok, false)
  assert.equal(result.state.codingPlans.qwen.status, 'error')
  assert.match(result.message, /bl auth status/)
  assert.ok(!JSON.stringify(result).includes('SECRET'))
  const errorCount = count()
  await api.getState(); await api.getState()
  assert.equal(count(), errorCount, 'errors are cached instead of spawning every poll')

  // 竞态:晚到的 Bailian 结果不能覆盖已切回的本地估算。
  setResponse({ token: { wait: 1500 }, coding: { wait: 1500 } })
  const beforeRace = count()
  const inFlight = api.refreshCodingPlan('qwen')
  await until(() => count() > beforeRace)
  state = await api.updateConfig({ codingPlans: { qwen: { quotaSource: 'local' } } })
  await inFlight
  state = await api.getState()
  assert.match(state.codingPlans.qwen.windows.credits.text, /est/)
  assert.equal(state.codingPlans.qwen.windows.fiveHour, undefined, 'late Bailian result cannot overwrite local mode')

  // 关闭与隐藏:不再启动子进程。
  setResponse({})
  await api.updateConfig({ codingPlans: { qwen: { quotaSource: 'bailian', enabled: false } } })
  const disabledCount = count()
  await api.getState(); await api.refreshCodingPlan('qwen')
  assert.equal(count(), disabledCount)
  await api.updateConfig({ codingPlans: { qwen: { enabled: true, display: 'off' } } })
  await api.getState()
  assert.equal(count(), disabledCount, 'hidden source never executes the CLI')

  // 重启读回:磁盘三态配置经 store 加载路径保留(此时 display=off,不触发查询)。
  // 账本 flush 有防抖:先等 off 真正落盘,再起第二个实例,否则旧快照会重新触发查询。
  await until(() => existsSync(join(process.env.DSH_HOME, 'storages', 'cost-meter', 'ledger.json')) && readLedger().config.codingPlans.qwen.display === 'off')
  const services2 = {}
  apply({ on: () => () => {}, inject() {}, get: () => undefined, logger: { info() {}, warn() {}, error() {} },
    effect: fn => { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
    provide: (name, service) => { services2[name] = service },
  })
  const reloaded = await services2.costMeter.getState()
  assert.equal(reloaded.codingPlans.qwen.quotaSource, 'bailian', 'disk reload keeps the Bailian source')
  codec(reloaded)
  assert.equal(count(), disabledCount, 'reload with display=off spawns nothing')

  // 设置客户端哨兵:第三选项与双语 note 已进入打包产物。
  const clientSrc = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.ok(clientSrc.includes('value:"bailian"'), '额度来源下拉含百炼第三项')
  assert.ok(clientSrc.includes('qwenBailianNote') && clientSrc.includes('qwenSourceBailian'), '百炼双语文案存在')
} finally {
  for (const cleanup of cleanups.reverse()) cleanup()
  for (const [name, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[name]; else process.env[name] = value }
  assert.equal(dirname(resolve(root)), resolve(tmpdir()))
  rmSync(root, { recursive: true, force: true })
}
console.log('[ok] 百炼 CLI 三档额度来源:解析/合并、真实子进程、脱敏、超时、缓存、并发、切源、账本与 codec 回归通过')
