/** Billing by recorded execution step. No message text is classified or retained. */
import { cachedStatistics } from './statistics-cache.js'
import { sessionCostSource } from './session-cost-source.js'
import { trajectorySchema } from './typert.host.js'
import { setImmediate } from 'node:timers/promises'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { replaySessionRecords } from './backfill.js'
import { sessionUsageRecords, costFromSamples } from './turn-cost.js'
import { sessionCostView, readSessionHeaders } from './session-tree.js'
import { withDsBotSamples } from './ds-bot-history.js'
import { nativeSearchRecordsFor } from './native-search-history.js'
import { billionRecordsFor } from './billion-context-history.js'

const valid = n => Number.isSafeInteger(n) && n >= 0
const keyOf = (turn, step) => JSON.stringify([turn, step])
const WEB_TOOLS = new Set(['websearch', 'web_search', 'search_web', 'web-search', 'web.run', 'web_search_preview'])
const FETCH_TOOLS = new Set(['web_fetch', 'webfetch', 'fetch_url', 'browse_web'])
const AGENT_TOOLS = new Set(['spawn_agent', 'send_message', 'send_message_to_agent', 'wait_agent', 'wait_agents', 'delegate_task', 'create_agent', 'resume_agent', 'close_agent'])
const OPERATION_TOOLS = {
  read: new Set(['read', 'read_file', 'read_files', 'read_text_file', 'read_multiple_files', 'view_file', 'open_file', 'view_image', 'list', 'ls', 'stat', 'list_files', 'list_directory', 'list_dir', 'directory_tree', 'list_resources', 'read_resource', 'read_mcp_resource', 'list_mcp_resources']),
  'local-search': new Set(['search', 'grep', 'rg', 'glob', 'find', 'find_files', 'search_files', 'search_file', 'file_search', 'search_code', 'code_search', 'search_text', 'search_content', 'grep_search', 'list_code_definition_names']),
  search: new Set([...WEB_TOOLS, 'browser_search', 'search_query', 'mcp__web__run']),
  fetch: FETCH_TOOLS,
  write: new Set(['write', 'write_file', 'write_files', 'edit', 'edit_file', 'edit_files', 'replace_in_file', 'replace_file_content', 'multi_replace_file_content', 'apply_patch', 'patch', 'create_file', 'delete_file', 'remove_file', 'move_file', 'rename_file', 'create_directory']),
  command: new Set(['bash', 'shell', 'terminal', 'exec', 'exec_command', 'execute', 'execute_command', 'run_command', 'run_shell_command', 'run_terminal_command', 'terminal_exec', 'write_stdin', 'powershell', 'python', 'python_exec', 'execute_code', 'node_repl']),
  coordination: AGENT_TOOLS,
}
const normalizedTool = name => name.toLowerCase().replace(/^tools\./, '')

/** Classify tool metadata only; a model call spanning several operations stays whole. */
export function stepOperation(row) {
  if (['search', 'fetch', 'compaction'].includes(row.kind)) return row.kind
  const kinds = new Set((row.tools ?? []).map(raw => {
    const name = normalizedTool(raw), leaf = name.split(/__|\./).at(-1)
    for (const [kind, tools] of Object.entries(OPERATION_TOOLS)) if (tools.has(name) || tools.has(leaf)) return kind
    return 'tool'
  }))
  if (kinds.size > 1) return 'multi-tool'
  return kinds.size ? [...kinds][0] : row.kind === 'model' ? 'model' : 'other'
}
const amountOf = (row, basis) => basis === 'api' ? row.apiCost : basis === 'plan' ? Math.max(0, row.cost - row.apiCost) : row.cost
const compareCost = basis => (a, b) => amountOf(b, basis) - amountOf(a, basis) || a.atMs - b.atMs || a.key.localeCompare(b.key)
function addParts(target, parts) {
  for (const part of parts) {
    let existing = target.find(row => row.bucket === part.bucket)
    if (!existing) { existing = { bucket: part.bucket, cost: 0, apiCost: 0, tokens: 0, unpriced: false }; target.push(existing) }
    for (const field of ['cost', 'apiCost', 'tokens']) existing[field] += part[field]
    existing.unpriced ||= part.unpriced
  }
}

const emptyGroup = (key, kind, tools = []) => ({ key, kind, sessionId: '', title: '', tools, steps: 0, calls: 0, cost: 0, apiCost: 0, unpriced: false, parts: [] })
function addStep(group, row) {
  group.steps++; group.calls += row.calls; group.cost += row.cost; group.apiCost += row.apiCost; group.unpriced ||= row.unpriced
  addParts(group.parts, (row.rows ?? []).map(part => ({ bucket: part.bucket, cost: part.cost, apiCost: part.plan ? 0 : part.cost, tokens: part.tokens, unpriced: !part.priced })))
}

/** Operations span all agents. Named tools are bounded inside each operation, not across it. */
export function groupOperationCosts(steps, basis = 'total') {
  const operations = new Map(), groups = new Map()
  const classified = steps.map(row => {
    const operationKey = stepOperation(row)
    const tools = [...new Set((row.tools ?? []).map(normalizedTool))].sort()
    const operationGroupKey = JSON.stringify([operationKey, tools])
    if (!operations.has(operationKey)) operations.set(operationKey, emptyGroup(operationKey, operationKey))
    if (!groups.has(operationGroupKey)) groups.set(operationGroupKey, { ...emptyGroup(operationGroupKey, operationKey, tools), operationKey })
    addStep(operations.get(operationKey), row); addStep(groups.get(operationGroupKey), row)
    return { ...row, operationKey, operationGroupKey }
  })
  const ordered = rows => rows.sort((a, b) => amountOf(b, basis) - amountOf(a, basis) || b.steps - a.steps || a.key.localeCompare(b.key))
  const remapped = new Map()
  for (const operationKey of operations.keys()) {
    const named = ordered([...groups.values()].filter(group => group.operationKey === operationKey && group.tools.length))
    if (named.length <= 5) continue
    const rest = { ...emptyGroup(JSON.stringify([operationKey, 'other-tools']), 'other-tools'), operationKey }
    for (const group of named.slice(5)) {
      remapped.set(group.key, rest.key); groups.delete(group.key)
      for (const field of ['steps', 'calls', 'cost', 'apiCost']) rest[field] += group[field]
      rest.unpriced ||= group.unpriced; addParts(rest.parts, group.parts)
    }
    groups.set(rest.key, rest)
  }
  for (const row of classified) if (remapped.has(row.operationGroupKey)) row.operationGroupKey = remapped.get(row.operationGroupKey)
  return { steps: classified, operations: ordered([...operations.values()]), operationGroups: ordered([...groups.values()]) }
}

/** Disjoint categories: each agent owns all its steps; parent tools never double-charge. */
export function groupStepCosts(steps, sessionId, basis = 'total', titles = new Map()) {
  const groups = new Map()
  const classified = steps.map(row => {
    const names = row.tools.map(name => name.toLowerCase().replace(/^tools\./, ''))
    let kind = row.kind, tools = [], owner = ''
    if (row.sessionId !== sessionId) { kind = 'subagent'; owner = row.sessionId }
    else if (kind === 'search' || names.length && names.every(name => WEB_TOOLS.has(name))) kind = 'search'
    else if (kind === 'fetch' || names.length && names.every(name => FETCH_TOOLS.has(name.split(/__|\./).at(-1)))) kind = 'fetch'
    else if (kind === 'compaction') kind = 'compaction'
    else if (names.length && names.every(name => AGENT_TOOLS.has(name))) kind = 'coordination'
    else if (row.tools.length > 1) kind = 'multi-tool'
    else if (row.tools.length) { kind = 'tool'; tools = row.tools }
    else kind = kind === 'model' ? 'model' : 'other'
    const key = JSON.stringify([kind, owner, tools])
    const group = groups.get(key) ?? { key, kind, sessionId: owner, title: titles.get(owner) ?? '', tools, steps: 0, calls: 0, cost: 0, apiCost: 0, unpriced: false, parts: [] }
    group.steps++; group.calls += row.calls; group.cost += row.cost; group.apiCost += row.apiCost; group.unpriced ||= row.unpriced
    addParts(group.parts, (row.rows ?? []).map(part => ({ bucket: part.bucket, cost: part.cost, apiCost: part.plan ? 0 : part.cost, tokens: part.tokens, unpriced: !part.priced })))
    groups.set(key, group)
    return { ...row, groupKey: key }
  })
  const toolGroups = [...groups.values()].filter(group => group.kind === 'tool')
    .sort((a, b) => amountOf(b, basis) - amountOf(a, basis) || b.steps - a.steps || a.key.localeCompare(b.key))
  if (toolGroups.length > 5) {
    const rest = { key: 'other-tools', kind: 'other-tools', sessionId: '', title: '', tools: [], steps: 0, calls: 0, cost: 0, apiCost: 0, unpriced: false, parts: [] }
    const merged = new Set()
    for (const group of toolGroups.slice(5)) {
      merged.add(group.key); groups.delete(group.key)
      for (const field of ['steps', 'calls', 'cost', 'apiCost']) rest[field] += group[field]
      rest.unpriced ||= group.unpriced
      addParts(rest.parts, group.parts)
    }
    groups.set(rest.key, rest)
    for (const row of classified) if (merged.has(row.groupKey)) row.groupKey = rest.key
  }
  return { steps: classified, groups: [...groups.values()].sort((a, b) => amountOf(b, basis) - amountOf(a, basis) || a.key.localeCompare(b.key)) }
}

/** Counts and accumulated costs make the long tail visible without hundreds of slices. */
export function stepCostDistribution(steps, basis = 'total') {
  const total = steps.reduce((sum, row) => sum + amountOf(row, basis), 0)
  const buckets = new Map(['tiny', 'small', 'medium', 'large', 'free', 'unpriced'].map(key => [key, { key, steps: 0, calls: 0, cost: 0, apiCost: 0, unpriced: false }]))
  for (const row of steps) {
    const amount = amountOf(row, basis), share = total > 0 ? amount / total : 0
    const key = row.unpriced ? 'unpriced' : amount === 0 ? 'free' : share < .001 ? 'tiny' : share < .01 ? 'small' : share < .05 ? 'medium' : 'large'
    const bucket = buckets.get(key)
    bucket.steps++; bucket.calls += row.calls; bucket.cost += row.cost; bucket.apiCost += row.apiCost; bucket.unpriced ||= row.unpriced
  }
  return [...buckets.values()].filter(bucket => bucket.steps > 0)
}

/** Agent totals include descendants; each category underneath contains only own steps. */
export function buildCostHierarchy(steps, sessionId, headers, titles, basis) {
  const identities = new Set([sessionId, ...steps.map(row => row.sessionId)])
  const parents = new Map(headers.map(header => [header.id, header.parentSession]))
  // Retain intermediate agents even when only their descendants incurred costs.
  for (const id of [...identities]) {
    let parent = parents.get(id), seen = new Set([id])
    while (parent && parent !== sessionId && !seen.has(parent)) { identities.add(parent); seen.add(parent); parent = parents.get(parent) }
  }
  const nodes = new Map([...identities].map(id => {
    const own = steps.filter(row => row.sessionId === id), grouped = groupStepCosts(own, id, basis)
    const operations = groupOperationCosts(own, basis).operations
    const byKey = new Map(grouped.steps.map(row => [row.key, row.groupKey]))
    for (const row of own) row.typeKey = byKey.get(row.key)
    const ownCost = own.reduce((sum, row) => sum + row.cost, 0), ownApiCost = own.reduce((sum, row) => sum + row.apiCost, 0)
    const calls = own.reduce((sum, row) => sum + row.calls, 0)
    return [id, { id, parentId: id === sessionId ? '' : identities.has(parents.get(id)) && parents.get(id) !== id ? parents.get(id) : sessionId,
      title: titles.get(id) ?? '', ownCost, ownApiCost, cost: ownCost, apiCost: ownApiCost, ownSteps: own.length, ownCalls: calls, steps: own.length, calls, unpriced: own.some(row => row.unpriced), groups: grouped.groups, operations }]
  }))
  const depth = node => {
    let level = 0, current = node, seen = new Set([node.id])
    while (current.parentId) {
      if (seen.has(current.parentId)) { node.parentId = sessionId; return 1 }
      seen.add(current.parentId); level++; current = nodes.get(current.parentId)
      if (!current) { node.parentId = sessionId; return 1 }
    }
    return level
  }
  const ordered = [...nodes.values()].map(node => ({ node, depth: depth(node) })).sort((a, b) => b.depth - a.depth)
  for (const { node } of ordered) {
    const parent = nodes.get(node.parentId)
    if (parent) for (const field of ['cost', 'apiCost', 'steps', 'calls']) parent[field] += node[field]
    if (parent) parent.unpriced ||= node.unpriced
  }
  return [...nodes.values()].sort((a, b) => a.id === sessionId ? -1 : b.id === sessionId ? 1 : amountOf(b, basis) - amountOf(a, basis) || a.id.localeCompare(b.id))
}

export async function scanStepTools(records) {
  const steps = new Map(), seen = new Set()
  let turn = null, step = null, createdAt = 0, count = 0
  for await (const event of records) {
    if (++count > 500000) throw new Error('Session exceeds the step limit')
    if (count % 2048 === 0) await setImmediate()
    if (event.type === 'session') { createdAt = Number(event.createdAt) || 0; continue }
    if (createdAt > 0 && event.time > 0 && event.time < createdAt) continue
    const d = event.data ?? {}
    if (event.type === 'turn/start') { turn = valid(d.turn) ? d.turn : null; step = null }
    if (event.type === 'step/start' || event.type === 'assistant/message') { turn = valid(d.turn) ? d.turn : turn; step = valid(d.step) ? d.step : null }
    if (['tool/call', 'tool/code-dispatch-start', 'tool/ptc-dispatch-start'].includes(event.type)) {
      const t = valid(d.turn) ? d.turn : turn, s = valid(d.step) ? d.step : step
      const key = keyOf(t, s), id = String(d.callId ?? d.subCallId ?? event.seq)
      if (!seen.has(key + ':' + id)) {
        seen.add(key + ':' + id)
        const names = steps.get(key) ?? new Set()
        if (typeof d.name === 'string' && d.name) names.add(d.name.slice(0, 240))
        steps.set(key, names)
      }
    }
    if (event.type === 'turn/end') { turn = null; step = null }
  }
  return new Map([...steps].map(([key, names]) => [key, [...names].sort()]))
}

function validSnapshot(value) {
  return value && Array.isArray(value.steps) && value.steps.length <= 100000 && Array.isArray(value.operations) && Array.isArray(value.operationGroups)
    && value.steps.every(row => typeof row.operationKey === 'string' && typeof row.operationGroupKey === 'string'
      && Array.isArray(row.callRefs) && row.callRefs.length === row.calls)
    && value.hierarchy?.every(node => Array.isArray(node.operations))
    && trajectorySchema.safeParse({ ...value, offset: 0, order: 'time', matchingSteps: value.totalSteps }).success
}

/** Bounded call tiles: every group retains its entire cost, including the long tail. */
export function costTiles(steps, groups, basis) {
  const buckets = new Map(groups.map(group => [group.key, []]))
  for (const row of steps) buckets.get(row.groupKey)?.push(row)
  const cap = Math.max(1, Math.min(24, Math.floor(256 / Math.max(1, groups.length))))
  const tiles = []
  for (const [groupKey, rows] of buckets) {
    const ordered = rows.filter(row => amountOf(row, basis) > 0).sort(compareCost(basis))
    const brief = row => ({ key: row.key, groupKey, sessionId: row.sessionId, turn: row.turn, step: row.step, kind: row.kind, tools: row.tools,
      cost: row.cost, apiCost: row.apiCost, unpriced: row.unpriced, count: 1, other: false })
    tiles.push(...ordered.slice(0, cap).map(brief))
    if (ordered.length > cap) {
      const rest = ordered.slice(cap)
      tiles.push({ key: groupKey + ':remainder', groupKey, sessionId: '', turn: null, step: null, kind: 'other', tools: [], other: true, count: rest.length,
        cost: rest.reduce((sum, row) => sum + row.cost, 0), apiCost: rest.reduce((sum, row) => sum + row.apiCost, 0), unpriced: rest.some(row => row.unpriced) })
    }
  }
  return tiles
}

/** live 会话 header 没有 title 的宿主(0.2.1 起)回退到 sessionQuery.readTitle。 */
async function sessionTitleOf(ctx, id) {
  try {
    const live = ctx?.get?.('sessions')?.get?.(id)?.header?.title
    if (typeof live === 'string' && live.trim()) return live
    const query = ctx?.get?.('sessionQuery')
    if (typeof query?.readTitle === 'function') {
      const stored = await query.readTitle(id)
      if (typeof stored === 'string' && stored.trim()) return stored
    }
  } catch { /* 标题只用于展示:读取失败时保留已有标题(可能为空)。 */ }
  return ''
}

async function calculateTrajectory(ledger, ctx, sessionId, basis) {
  const view = await sessionCostView(ledger, ctx, [sessionId]), ids = view.scopes.get(sessionId), steps = [], titles = new Map()
  for (const day of Object.values(view.days ?? {})) for (const row of day.sessions ?? [])
    if (ids.has(row.id) && typeof row.title === 'string' && row.title.trim()) titles.set(row.id, row.title.slice(0, 200))
  let cost = 0, apiCost = 0
  for (const id of ids) {
    const title = await sessionTitleOf(ctx, id)
    if (typeof title === 'string' && title.trim()) titles.set(id, title.slice(0, 200))
    const [records, native] = await Promise.all([sessionUsageRecords(ctx, id, ledger.path), nativeSearchRecordsFor(ledger.path, id)])
    const tools = await scanStepTools(records)
    const logged = replaySessionRecords([...records, ...native, ...await billionRecordsFor(ledger.path, id)], ledger.config, null, true).samples
    const samples = withDsBotSamples(logged, view.samples.get(id))
      .filter(row => !row.seed && (!view.dsIds.has(id) || row.atMs > (ledger.historyReset?.at ?? 0))
        && (basis === 'total' || (basis === 'plan' ? row.plan : !row.plan)))
    const grouped = new Map()
    for (const sample of samples) {
      // Unknown step identities cannot safely be merged with neighbouring steps.
      const key = JSON.stringify([sample.kind, sample.turn, sample.step, sample.step == null ? sample.logSeq ?? sample.atMs : null])
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key).push(sample)
    }
    for (const [key, samples] of grouped) {
      const detail = costFromSamples(samples, ledger.config), first = detail.calls[0]
      const names = first.kind === 'model' && first.step != null ? tools.get(keyOf(first.turn, first.step)) ?? [] : []
      const row = { key: id + ':' + key, sessionId: id, turn: first.turn, step: first.step, kind: first.kind, tools: names, atMs: first.atMs,
        cost: detail.cost, apiCost: detail.apiCost, calls: detail.calls.length, unpriced: detail.calls.some(call => !call.priced && (basis === 'total' || (basis === 'plan' ? call.plan : !call.plan))), rows: detail.rows,
        callRefs: detail.calls.map(call => ({ ...call, sessionId: id })) }
      steps.push(row); cost += row.cost; apiCost += row.apiCost
    }
  }
  steps.sort((a, b) => a.atMs - b.atMs)
  const ranked = [...steps].sort(compareCost(basis))
  const shares = ranked.slice(0, 20).map(({ key, sessionId, turn, step, kind, tools, cost, apiCost, unpriced }) => ({ key, sessionId, turn, step, kind, tools, cost, apiCost, unpriced, other: false, count: 1 }))
  if (ranked.length > 20) shares.push({ key: 'other', sessionId: '', turn: null, step: null, kind: 'other', tools: [], other: true, count: ranked.length - 20,
    cost: ranked.slice(20).reduce((n, row) => n + row.cost, 0), apiCost: ranked.slice(20).reduce((n, row) => n + row.apiCost, 0), unpriced: ranked.slice(20).some(row => row.unpriced) })
  const grouped = groupStepCosts(steps, sessionId, basis, titles)
  const operations = groupOperationCosts(grouped.steps, basis)
  const hierarchy = buildCostHierarchy(operations.steps, sessionId, ids.size > 1 ? await readSessionHeaders(ctx) : [], titles, basis)
  return { cost, apiCost, shares, totalSteps: steps.length, totalCalls: steps.reduce((sum, row) => sum + row.calls, 0),
    steps: operations.steps, groups: grouped.groups, operations: operations.operations, operationGroups: operations.operationGroups,
    hierarchy, distribution: stepCostDistribution(steps, basis), tiles: costTiles(grouped.steps, grouped.groups, basis) }
}

export async function getSessionTrajectory(ledger, ctx, query) {
  if (!query || typeof query.sessionId !== 'string' || !query.sessionId || query.sessionId.length > 512) throw new Error('invalid step billing session')
  const offset = query.offset ?? 0, basis = query.basis ?? 'total', order = query.order ?? 'time', filter = query.group ?? '', agent = query.agent ?? ''
  const operation = query.operation ?? '', operationGroup = query.operationGroup ?? '', detail = query.detail ?? 'full', stepKey = query.stepKey ?? '', ownOnly = query.ownOnly ?? false
  if (!['api', 'plan', 'total'].includes(basis)) throw new Error('invalid step billing basis')
  if (!valid(offset) || offset > 1e7) throw new Error('invalid step billing offset')
  if (!['cost', 'time'].includes(order) || typeof filter !== 'string' || filter.length > 1024 || typeof agent !== 'string' || agent.length > 512) throw new Error('invalid step billing order or category')
  if (typeof ownOnly !== 'boolean' || !['full', 'map'].includes(detail) || typeof operation !== 'string' || operation.length > 80 || typeof operationGroup !== 'string' || operationGroup.length > 4096
    || typeof stepKey !== 'string' || stepKey.length > 2048) throw new Error('invalid step billing operation or detail')
  const calculation = { path: ledger.path, days: ledger.days, config: ledger.config, historyReset: ledger.historyReset }
  const cached = await cachedStatistics(ledger, ['trajectory-v6', resolveDshHome(), query.sessionId, basis], {
    source: () => sessionCostSource(calculation, ctx, query.sessionId), build: () => calculateTrajectory(calculation, ctx, query.sessionId, basis), valid: validSnapshot, background: query.background === true, generation: query.generation ?? '',
  })
  const value = cached.value, hierarchy = value.hierarchy
  const included = new Set(agent ? [agent] : [])
  if (agent && !ownOnly && !filter && !operation && !operationGroup) for (const node of hierarchy) {
    let current = node, seen = new Set()
    while (current && !seen.has(current.id)) {
      if (current.id === agent) { included.add(node.id); break }
      seen.add(current.id); current = hierarchy.find(other => other.id === current.parentId)
    }
  }
  const ordered = value.steps.filter(row => {
    if (stepKey && row.key !== stepKey) return false
    if (operation && row.operationKey !== operation || operationGroup && row.operationGroupKey !== operationGroup) return false
    if (agent) {
      if (ownOnly || filter || operation || operationGroup) return row.sessionId === agent && (!filter || row.typeKey === filter)
      return included.has(row.sessionId)
    }
    return !filter || row.groupKey === filter
  })
  if (order === 'cost') ordered.sort(compareCost(basis))
  const rows = ordered.slice(stepKey ? 0 : offset, stepKey ? 1 : offset + (detail === 'map' ? 400 : 100))
  // The complete cached calculation contains repeated price breakdowns. Charts
  // need only category totals; individual rate tables travel with selected steps.
  const compactGroup = group => ({ ...group, parts: [] })
  const metadata = detail === 'map' || stepKey
    ? { shares: [], groups: [], operations: [], operationGroups: [], hierarchy: [], distribution: [] }
    : { shares: value.shares, groups: value.groups.map(compactGroup), operations: value.operations.map(compactGroup), operationGroups: value.operationGroups.map(compactGroup), distribution: value.distribution,
      hierarchy: hierarchy.map(actor => ({ ...actor, groups: [], operations: actor.operations.map(compactGroup) })) }
  // Event references are needed only after selecting one step. Keep their rate
  // tables out of chart/list responses and never include stored message bodies.
  const selectedRows = rows.map(row => stepKey ? row : { ...row, rows: detail === 'map' ? [] : row.rows, callRefs: [] })
  return { cost: value.cost, apiCost: value.apiCost, totalSteps: value.totalSteps, totalCalls: value.totalCalls, ...metadata, tiles: [], offset: stepKey ? 0 : offset, order, matchingSteps: ordered.length, steps: selectedRows,
    refreshing: cached.refreshing, generatedAt: cached.generatedAt, refreshFailed: cached.refreshFailed }
}
