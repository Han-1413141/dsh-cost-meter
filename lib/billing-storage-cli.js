#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { resolve, join } from 'node:path'
import { homedir } from 'node:os'
import { manageBillionStorage } from './billion-context-storage.js'
import { recordManualSearchFees } from './native-search-manual.js'

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    ledger: { type: 'string' }, 'older-than': { type: 'string', default: '7d' },
    streams: { type: 'boolean' }, groups: { type: 'boolean' }, 'dry-run': { type: 'boolean' },
    apply: { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h' },
    count: { type: 'string' }, at: { type: 'string' }, id: { type: 'string' }, session: { type: 'string' }, source: { type: 'string' },
  } })
  if (values.help || !positionals.length) {
    console.log('dsh-cost-meter record-search --ledger <ledger.json> --count 3 --at <ISO timestamp with timezone> --id <correction-id> [--session <session-id>] [--source server-tool|search-api] [--apply]\n补记已确认成功且漏记的官方搜索请求费；默认预览，--apply 写入。同一 id 重试不会重复收费，不估算 Token。')
    console.log('dsh-cost-meter clean [--ledger <ledger.json>] [--streams] [--groups] [--older-than 7d|30d|all] [--dry-run | --apply]\n默认预览；--apply 才执行。合并压缩已完成的旧计费流，清理过期请求回执，保留账本、调用记录和历史费用明细。\nPreview by default. --apply compacts completed streams and removes expired receipts; ledger, calls and historical cost details are preserved.')
  } else {
    if (positionals.length !== 1 || !['clean', 'record-search'].includes(positionals[0])) throw Error('Expected command: clean or record-search')
    const retentionDays = { '7d': 7, '30d': 30, all: 0 }[values['older-than']]
    if (retentionDays === undefined) throw Error('--older-than must be 7d, 30d or all')
    if (values.apply && values['dry-run']) throw Error('--dry-run and --apply cannot be combined')
    const both = !values.streams && !values.groups
    const ledger = values.ledger ? resolve(values.ledger) : join(resolve(process.env.DSH_HOME || join(homedir(), '.dsh')), 'storages', 'cost-meter', 'ledger.json')
    console.log(JSON.stringify(positionals[0] === 'record-search'
      ? recordManualSearchFees(ledger, values)
      : await manageBillionStorage(ledger, { retentionDays, apply: values.apply,
        streams: both || values.streams === true, groups: both || values.groups === true }), null, 2))
  }
} catch (error) { console.error(error.message); process.exitCode = 1 }
