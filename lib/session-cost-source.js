/** Lightweight cache invalidation; conversation bodies are never read here. */
import { stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { listSessionLogs } from './backfill.js'
import { sessionCostScopes, readSessionHeaders } from './session-tree.js'
import { dsBotUsagePaths } from './ds-bot-history.js'
import { listNativeSearchHistory } from './native-search-history.js'
import { billionSourcePaths } from './billion-context-history.js'
import { probeSessionStorage, readSessionRevisions } from './session-storage-compat.js'
import { responseModelOfEvent } from './pricing.js'

export async function sessionCostSource(ledger, ctx, sessionId) {
  const { scopes, roster, dsIds } = await sessionCostScopes(ledger, ctx, [sessionId])
  const ids = scopes.get(sessionId), home = resolveDshHome()
  const paths = listSessionLogs(join(home, 'sessions'), ids)
  const fileInfo = async path => { try { const info = await stat(path); return [path, info.size, info.mtimeMs] } catch { return [path, null] } }
  const live = [...ids].map(id => {
    const session = ctx?.get?.('sessions')?.get?.(id), records = session?.snapshotEvents?.()
    return [id, session?.header?.title, session?.header?.createdAt, session?.header?.isSeeded,
      session?.inheritedEventCount ?? session?.header?.seedLength, Array.isArray(records) ? records.flatMap(row => {
      const data = row.data ?? {}
      if (row.type === 'session/end-seed' && data.inherited === true) return [[row.type, row.seq]]
      if (!['turn/start', 'turn/end', 'step/start', 'request/header', 'assistant/message', 'compaction/summary', 'tool/call', 'tool/code-dispatch-start', 'tool/ptc-dispatch-start', 'cost-meter/native-search-usage'].includes(row.type) && !(row.type === 'assistant/chunk' && data.chunk?.type === 'usage')) return []
      return [[row.type, row.seq, row.time, data.turn, data.step, data.name, data.callId, data.subCallId, data.usage, data.chunk?.usage, data.provider, data.model, data.message?.source?.provider, data.message?.source?.model, responseModelOfEvent(row), data.requestId, data.startedAtMs, data.header?.config?.provider, data.header?.config?.model]]
    }) : null]
  })
  const native = ledger.path ? listNativeSearchHistory(ledger.path, new Set(), ids) : []
  const headers = ids.size > 1 ? (await readSessionHeaders(ctx)).filter(row => ids.has(row.id)) : []
  const proxy = [...ids].flatMap(id => billionSourcePaths(ledger.path, id))
  const recorded = Object.entries(ledger.days ?? {}).map(([date, day]) => [date, (day.sessions ?? []).filter(row => ids.has(row.id))]).filter(([, rows]) => rows.length)
  // RDB(会话 SQLite)后端没有 JSONL 文件:非 live 会话的 revision 是唯一的本地变更指纹。
  // JSONL 模式不追加该项,保持既有指纹与统计缓存逐字节一致。
  const storage = probeSessionStorage(ctx)
  let revisions = []
  if (storage.mode === 'rdb') {
    const liveIds = new Set(live.filter(row => Array.isArray(row.at(-1))).map(row => row[0]))
    revisions = [...(await readSessionRevisions(ctx, [...ids].filter(id => !liveIds.has(id)), { fresh: true }))]
      .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
  }
  const files = await Promise.all([...paths, ...native, ...proxy, ...(dsIds.size ? dsBotUsagePaths(roster) : [])].map(fileInfo))
  const payload = storage.mode === 'rdb' ? [live, headers, recorded, revisions, files] : [live, headers, recorded, files]
  if (dsIds.size) payload.push(ledger.historyReset?.at ?? 0)
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}
