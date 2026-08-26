#!/usr/bin/env node
/**
 * dsh-cost-meter 发版流水线(零依赖,Node 18+)。
 *
 * 用法:
 *   node scripts/release.mjs --dry          干跑:只做检查与预览,不改任何东西
 *   node scripts/release.mjs                正式发版:检查 → 打 tag → 推送 → gh release create
 *   node scripts/release.mjs --regen-notes  仅(重)生成 docs/release-notes/v<版本>.md,
 *                                           并在 UPDATE-HISTORY 缺小节时自动补一版(不发布)
 *
 * 检查项:
 *   1. 版本号五处对齐:package.json / install.ps1(3 处)/ README.md / README.en.md(徽章 + 安装行 ×2);
 *   2. CHANGELOG.md 有 `## [版本] - 日期` 小节;
 *   3. docs/UPDATE-HISTORY.md 有 `## v版本(日期)` 小节(缺则 --regen-notes 可自动补);
 *   4. 工作树干净、在 master、与 origin/master 同步(正式发版时)。
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const run = (file, args, opts = {}) => execFileSync(file, args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })
const sh = (file, args, opts = {}) => { try { return run(file, args, opts).trim() } catch (e) { return null } }

const args = new Set(process.argv.slice(2))
const DRY = args.has('--dry')
const REGEN = args.has('--regen-notes')
if (DRY && REGEN) { console.error('× --dry 与 --regen-notes 不要同时使用'); process.exit(1) }

const log = s => console.log(s)
let failures = 0
const fail = msg => { failures++; console.error('× ' + msg) }

// ── 0. 版本号 ────────────────────────────────────────────────────────────
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
const V = pkg.version
const TAG = 'v' + V
if (!/^v\d+\.\d+\.\d+$/.test(TAG)) fail(`package.json 版本号「${V}」不是规范的 x.y.z,拒绝发版`)
log(`▶ 版本:${V}(tag ${TAG})  模式:${DRY ? 'DRY 干跑' : REGEN ? '仅生成发布素材' : '正式发版'}\n`)

// ── 1. 五处版本对齐 ──────────────────────────────────────────────────────
const read = f => readFileSync(join(repoRoot, f), 'utf8')
const align = [
  ['install.ps1', 3, [TAG, `${TAG}/install.ps1`, `'${TAG}'`]],
  ['README.md', 3, [`version-${V}`, `${TAG}/install.ps1`, `#${TAG}`]],
  ['README.en.md', 3, [`version-${V}`, `${TAG}/install.ps1`, `#${TAG}`]],
]
for (const [file, min, needles] of align) {
  const text = read(file)
  for (const needle of needles) {
    const n = text.split(needle).length - 1
  if (n === 0) fail(`${file} 缺少版本引用「${needle}」`)
}
}
// install.ps1 中旧版本残留(出现 v1.x.y 但不是当前 TAG)最常见,单独点名:
for (const [file] of align) {
  const stale = [...read(file).matchAll(/v\d+\.\d+\.\d+/g)].map(m => m[0]).filter(v => v !== TAG)
  if (stale.length) fail(`${file} 残留旧版本号:${[...new Set(stale)].join(', ')}(CHANGELOG/UPDATE-HISTORY 除外,此三文件不应有)`)
}
log(failures ? '' : '✓ 五处版本引用对齐(install.ps1 / README.md / README.en.md)')

// ── 2. CHANGELOG 小节 ────────────────────────────────────────────────────
const changelog = read('CHANGELOG.md')
const seg = changelog.split(/^## /m).find(p => p.startsWith(`[${V}] `))
if (!seg) fail(`CHANGELOG.md 缺少「## [${V}] - 日期」小节`)
const [head, ...body] = (seg ?? '').split('\n')
const date = (head ?? '').match(/- (\d{4}-\d{2}-\d{2})/)?.[1] ?? ''
const changes = body.join('\n').trim()
if (seg && !changes) fail(`CHANGELOG.md 的 [${V}] 小节是空的`)
if (seg) log(`✓ CHANGELOG [${V}] - ${date}(${changes.split('\n').filter(l => l.startsWith('- ')).length} 条)`)

// ── 3. UPDATE-HISTORY 小节(缺失时 --regen-notes 自动补)────────────────
const histPath = join(repoRoot, 'docs/UPDATE-HISTORY.md')
let history = readFileSync(histPath, 'utf8')
const hasHistory = history.includes(`## v${V}(`)
if (!hasHistory) {
  if (REGEN) {
    const titleM = changes.match(/\*\*(.+?)\*\*/)
    const title = titleM ? titleM[1].replace(/[(（].*?[)）]/g, '').trim() : '更新'
    const bullets = changes
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('- '))
      .map(l => '- ' + l.slice(2))
      .join('\n')
    const section = `## v${V}(${date})—— ${title}\n\n${bullets}\n\n`
    const firstH2 = history.search(/^## /m)
    history = firstH2 === -1 ? history + '\n' + section : history.slice(0, firstH2) + section + history.slice(firstH2)
    writeFileSync(histPath, history)
    log(`✓ 已在 docs/UPDATE-HISTORY.md 顶部补写 v${V} 小节(发版前请人工润色)`)
  } else {
    fail(`docs/UPDATE-HISTORY.md 缺少「## v${V}(${date})」小节(可用 --regen-notes 自动补写后润色)`)
  }
} else {
  log(`✓ UPDATE-HISTORY 含 v${V} 小节`)
}

// Release 标题取自 UPDATE-HISTORY 的「## v<V>(日期)—— 标题」行
const vEsc = V.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const histTitle = history.match(new RegExp(`^## v${vEsc}\\([^)]*\\)—— (.+)$`, 'm'))?.[1]
const releaseTitle = `v${V}${histTitle ? ' — ' + histTitle : ''}`

// ── 4. git 状态 ──────────────────────────────────────────────────────────
const branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
const dirty = sh('git', ['status', '--porcelain'])
const sb = sh('git', ['status', '-sb']) ?? ''
const synced = !/\[ahead \d+/.test(sb) && !/\[behind \d+/.test(sb)
if (branch !== 'master') fail(`当前分支是 ${branch},应在 master`)
if (dirty) fail(`工作树不干净:\n${dirty}`)
if (!synced) fail('本地与 origin/master 不同步(先 git push)')
if (failures) { console.error(`\n共 ${failures} 项 git 检查未过,终止。`); process.exit(1) }
log('✓ git:master 分支、工作树干净、与远端同步')

// ── 5. 发布素材:docs/release-notes/v<V>.md(缺则由 CHANGELOG 生成,git 检查后再落盘,
//        否则刚生成的文件会弄脏工作树导致首次发版必败)──────────────────────
const notesDir = join(repoRoot, 'docs', 'release-notes')
const notesPath = join(notesDir, `${TAG}.md`)
const upgrade = `\n## 升级\n\n已安装用户在任意终端重跑一行即可(重跑即为更新):\n\n\`\`\`powershell\nirm https://raw.githubusercontent.com/Han-1413141/dsh-cost-meter/${TAG}/install.ps1 | iex\n\`\`\`\n\n升级后**重启 dsh web** 使插件服务端代码生效,浏览器端刷新页面即可。\n`
if (existsSync(notesPath)) {
  log(`✓ 使用现成的 ${'docs/release-notes/' + TAG + '.md'} 作为 Release 文案`)
} else if (REGEN || !DRY) {
  writeFileSync(notesPath, `## v${V} 更新\n\n${changes}\n${upgrade}`)
  log(`✓ 已生成 docs/release-notes/${TAG}.md(可人工润色后重跑)`)
} else {
  log(`(dry)将生成 docs/release-notes/${TAG}.md`)
}

if (REGEN) { log('\n--regen-notes 完成(素材已写盘,未发布)。'); process.exit(0) }

// ── 6. tag 与 Release ────────────────────────────────────────────────────
const tagExists = sh('git', ['rev-parse', '-q', '--verify', TAG]) !== null
if (DRY) {
  log(`\n【DRY】将执行:\n  git tag ${TAG}${tagExists ? '(已存在,跳过)' : ''}\n  git push origin ${TAG}\n  gh release create ${TAG} --title "${releaseTitle}" --notes-file docs/release-notes/${TAG}.md`)
  log(`【DRY】tag 现状:${tagExists ? '已存在' : '不存在'};Release 现状:${sh('gh', ['release', 'view', TAG, '--json', 'tagName']) ? '已存在' : '不存在'}`)
  process.exit(0)
}
if (!tagExists) {
  run('git', ['tag', TAG], { stdio: 'inherit' })
  run('git', ['push', 'origin', TAG], { stdio: 'inherit' })
  log(`✓ 已打并推送 ${TAG}`)
} else {
  log(`• ${TAG} 已存在,跳过打 tag`)
}
const releaseExists = sh('gh', ['release', 'view', TAG, '--json', 'tagName']) !== null
if (!releaseExists) {
  run('gh', ['release', 'create', TAG, '--title', releaseTitle, '--notes-file', `docs/release-notes/${TAG}.md`], { stdio: 'inherit' })
} else {
  run('gh', ['release', 'edit', TAG, '--notes-file', `docs/release-notes/${TAG}.md`], { stdio: 'inherit' })
  log(`• Release ${TAG} 已存在,已用本地文案覆盖更新`)
}
const verifyRaw = sh('gh', ['release', 'view', TAG, '--json', 'tagName,isDraft,publishedAt'])
if (!verifyRaw) { console.error('× 无法读取 release 校验信息(gh 未安装或网络失败?)'); process.exit(1) }
const verify = JSON.parse(verifyRaw)
if (verify.tagName !== TAG || verify.isDraft) { console.error('× Release 校验失败:' + JSON.stringify(verify)); process.exit(1) }
log(`\n✅ 发版完成:${TAG} @ ${verify.publishedAt}(isDraft=${verify.isDraft})`)
