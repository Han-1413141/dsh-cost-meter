#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'
import { lstat } from 'node:fs/promises'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { listSessionLogFiles } from './session-log-files.js'
import { repairSessionLog } from './session-log-repair.js'

async function main() {
  const { values } = parseArgs({ options: {
    write: { type: 'boolean', default: false },
    'sessions-root': { type: 'string' }, 'host-modules': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  } })
  if (values.help) {
    console.log('dsh-cost-meter-repair-sessions [--sessions-root <目录>] [--write] [--host-modules <node_modules>]\n默认只检查。退出所有 DSH 后加 --write 修复；每份受影响日志先保留原样备份。\n写入需要同次 npx 安装 @deepseek-ai/dsh，或用 --host-modules 指向现有宿主的 node_modules。')
    return
  }
  const root = resolve(values['sessions-root'] ?? join(resolveDshHome(), 'sessions'))
  if (!(await lstat(root)).isDirectory()) throw new Error('会话根目录不存在或不是目录')
  let acquireLease
  if (values.write) {
    const require = createRequire(values['host-modules'] ? join(resolve(values['host-modules']), '__cost_meter_repair__.cjs') : import.meta.url)
    let Host
    try { Host = (await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session-persistence-jsonl')).href)).default }
    catch { throw new Error('未找到可用宿主：请在 npx 命令中同时指定 --package=@deepseek-ai/dsh@0.1.5-rc.2，或传 --host-modules') }
    if (typeof Host?.prototype?.acquireLease !== 'function') throw new Error('该宿主没有兼容的会话锁接口，未写入任何日志')
    acquireLease = (directory, id) => Host.prototype.acquireLease.call(null, id, undefined, directory)
  }
  const totals = { scanned: 0, affected: 0, events: 0, repaired: 0, failed: 0 }
  console.log(`${values.write ? '修复' : '只读检查'}：${root}`)
  for (const path of listSessionLogFiles(root, null, true)) {
    totals.scanned++
    try {
      const result = await repairSessionLog(path, { write: values.write, acquireLease })
      if (!result.changedEvents) continue
      totals.affected++; totals.events += result.changedEvents
      if (result.written) totals.repaired++
      console.log(JSON.stringify({ path, events: result.changedEvents, written: result.written, backup: result.backup }))
    } catch (error) {
      totals.failed++
      console.error(JSON.stringify({ path, error: error.message }))
    }
  }
  console.log(JSON.stringify(totals))
  if (totals.failed) process.exitCode = 1
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
