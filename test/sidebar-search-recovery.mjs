// #232: real host search callbacks with deterministic hooks and synthetic data.
// This verifies search recovery, not native password-manager autofill behavior.
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Ledger, sanitizeConfig, zeroDay } from '../lib/store.js'

assert.ok(process.env.DSH_TEST_NODE_MODULES, 'set DSH_TEST_NODE_MODULES to the reported/current installed host dependencies')
const req = createRequire(join(resolve(process.env.DSH_TEST_NODE_MODULES), '__sidebar_recovery.cjs'))
const hostPackage = req.resolve('@deepseek-ai/dsh-client-ui-workspace/package.json')
const hostVersion = JSON.parse(readFileSync(hostPackage, 'utf8')).version
const source = readFileSync(join(dirname(hostPackage), 'lib/client.js'), 'utf8')
assert.ok(source.includes('exports.apply = apply;'), 'host bundle exposes the expected module factory')

const timers = new Map()
let timerId = 0, factory, current
const sameDeps = (a, b) => a?.length === b?.length && a.every((value, index) => Object.is(value, b[index]))
const React = {
  Component: class {}, Fragment: 'fragment',
  useState(initial) {
    const index = current.index++, runner = current
    runner.hooks[index] ??= { value: typeof initial === 'function' ? initial() : initial }
    return [runner.hooks[index].value, next => {
      const previous = runner.hooks[index].value
      runner.hooks[index].value = typeof next === 'function' ? next(previous) : next
      if (!Object.is(previous, runner.hooks[index].value)) runner.dirty = true
    }]
  },
  useRef(value) { return current.hooks[current.index++] ??= { current: value } },
  useMemo(fn, deps) {
    const index = current.index++, previous = current.hooks[index]
    if (!previous || !sameDeps(previous.deps, deps)) current.hooks[index] = { value: fn(), deps }
    return current.hooks[index].value
  },
  useEffect(fn, deps) {
    const index = current.index++, previous = current.hooks[index]
    if (!previous || !sameDeps(previous.deps, deps)) current.effects.push(() => {
      previous?.cleanup?.()
      current.hooks[index] = { deps, cleanup: fn() }
    })
  },
}
const jsx = (type, props, key) => ({ type, props: props ?? {}, key })
const primitives = new Proxy({}, { get: (_target, name) => name })
vm.runInNewContext(source.replace('exports.apply = apply;', 'exports.recoveryTest = { WorkspaceBrowser, SearchResults, createWorkspaceViewStore }; exports.apply = apply;'), {
  console, AbortController, Node: class {},
  document: { querySelector: () => ({}), addEventListener() {}, removeEventListener() {} },
  window: {
    __ModuleLoader__: { load: value => { factory = value.factory } },
    setTimeout(fn, delay) { timers.set(++timerId, { fn, delay }); return timerId },
    clearTimeout: id => timers.delete(id),
  },
})
const ui = factory(name => name === 'react' ? React
  : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx }
    : name === '@deepseek-ai/cordis' ? { Service: class {} }
      : name === '@deepseek-ai/dsh-client-store' ? { defineStore: spec => spec }
        : primitives).recoveryTest

function runner(component, props) {
  return {
    component, props, hooks: [], effects: [], dirty: true, index: 0, tree: null,
    render() {
      let cycles = 0
      do {
        assert.ok(++cycles < 30, 'hook effects converge')
        this.index = 0; this.effects = []; this.dirty = false; current = this
        this.tree = this.component(this.props)
        for (const effect of this.effects) { current = this; effect() }
      } while (this.dirty)
      return this.tree
    },
    dispose() { for (const hook of this.hooks) hook?.cleanup?.() },
  }
}
const nodes = node => Array.isArray(node) ? node.flatMap(nodes)
  : node && typeof node === 'object' && node.props ? [node, ...nodes(node.props.children)] : []
const text = node => Array.isArray(node) ? node.map(text).join('')
  : node && typeof node === 'object' && node.props ? text(node.props.children) : node == null ? '' : String(node)
const hash = value => createHash('sha256').update(value).digest('hex')
const work = mkdtempSync(join(tmpdir(), 'cm-sidebar-recovery-'))
let ledger, browser, remounted
try {
  const ids = Array.from({ length: 18 }, (_, index) => `session-${index}`)
  const byId = Object.fromEntries(ids.map((id, index) => [id, {
    id, displayTitle: `Conversation ${index}`, title: `Conversation ${index}`,
    cwd: `C:/synthetic/workspace-${index}`, createdAt: 1000 + index, updatedAt: 2000 + index,
    parentId: null, retainedBy: {}, running: false, blank: false,
  }]))
  const list = { phase: 'ready', state: 'ready', ids, byId }
  const workspaces = {
    phase: 'ready', state: 'ready', pinnedSessionIds: [], archivedSessionIds: [],
    items: ids.map((id, index) => ({ workspaceId: `ws-${index}`, title: `Workspace ${index}`,
      root: `C:/synthetic/workspace-${index}`, cwd: `C:/synthetic/workspace-${index}`, sessionIds: [id] })),
  }
  const view = { groupBy: 'workspace', orderBy: 'updated', archivedFilter: 'default',
    groupExpansion: { 'ws-3': true }, sessionOrderByAccount: {} }
  // Store original message content independently of browser projection state.
  // These are source-event fixtures, not real user's session logs.
  const messages = ids.map((id, index) => {
    const path = join(work, `${id}.events.json`)
    writeFileSync(path, JSON.stringify([{ type: 'user/message', sessionId: id,
      data: { role: 'user', content: [{ type: 'text', text: `Preserved original synthetic message ${index}` }] } }]))
    return path
  })
  const workspacePath = join(work, 'workspace.json')
  writeFileSync(workspacePath, JSON.stringify(workspaces))

  // The ledger stores daily/session aggregates, not one row per API call.
  // 35 days × 18 session aggregates represent the reported 78,000 calls.
  const ledgerPath = join(work, 'ledger.json'), days = {}, bucketKeys = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'calls', 'cost', 'apiCost']
  let remaining = 78_000
  for (let dateIndex = 0; dateIndex < 35; dateIndex++) {
    const date = new Date(Date.UTC(2026, 7, 31 + dateIndex)).toISOString().slice(0, 10)
    const day = zeroDay(date), model = 'deepseek:deepseek-v4-flash'
    const dayCalls = Math.floor(remaining / (35 - dateIndex)); remaining -= dayCalls
    let sessionCalls = dayCalls
    for (let index = 0; index < ids.length; index++) {
      const calls = Math.floor(sessionCalls / (ids.length - index)); sessionCalls -= calls
      const buckets = { input: calls * 100, output: calls * 20, cacheRead: calls * 10,
        cacheWrite: 0, reasoning: 0, calls, cost: calls / 1024, apiCost: calls / 1024 }
      day.sessions.push({ id: ids[index], title: byId[ids[index]].title, at: Date.parse(`${date}T12:00:00Z`),
        ...buckets, byProviderModel: { [model]: { ...buckets } } })
      for (const key of bucketKeys) day[key] += buckets[key]
    }
    day.byProviderModel[model] = Object.fromEntries(bucketKeys.map(key => [key, day[key]]))
    days[date] = day
  }
  const initial = new Ledger(sanitizeConfig({ historyDays: 90 }), days, ledgerPath)
  writeFileSync(ledgerPath, JSON.stringify(initial.snapshot()))
  initial.close()
  ledger = Ledger.load(ledgerPath)
  assert.equal(ledger.pendingWrite, false, 'valid synthetic ledger loads without repair writes')
  assert.equal(ledger.sumDays().calls, 78_000, 'real Ledger reads all reported-volume calls')
  const ledgerBefore = JSON.stringify(ledger.snapshot())
  const preservedFiles = [...messages, workspacePath, ledgerPath]
  const fileHashes = preservedFiles.map(path => hash(readFileSync(path)))
  const dataHash = () => hash(JSON.stringify({ list, workspaces, view }))
  const before = dataHash()
  const assertPreserved = label => {
    assert.equal(dataHash(), before, `${label}: session/workspace/view snapshots unchanged`)
    assert.deepEqual(preservedFiles.map(path => hash(readFileSync(path))), fileHashes, `${label}: original message, workspace and ledger file bytes unchanged`)
    ledger.refresh()
    assert.equal(JSON.stringify(ledger.snapshot()), ledgerBefore, `${label}: real Ledger counters and records unchanged`)
    assert.equal(ledger.sumDays().calls, 78_000, `${label}: all original calls retained`)
  }

  const pending = [], noop = () => {}, hook = snapshot => select => select(snapshot)
  const props = {
    wide: true, usePanelInfo: hook({ activePanelId: null }), expandSidebar: noop,
    useSessions: hook(list), useSessionStatus: hook(new Map()), useWorkspaces: hook(workspaces), useStore: hook(view),
    actions: new Proxy({}, { get: () => noop }), startSession: noop, open: noop, requestSessionRename: noop,
    notifyArchivedNotOpenable: noop, renameWorkspace: noop, deleteWorkspace: noop, insertWorkspaceBefore: noop,
    unarchiveSession: noop, createWorkspace: noop,
    searchSessions: (query, signal) => new Promise((resolve, reject) => pending.push({ query, signal, resolve, reject })),
    searchResultLimit: 100, useDirectoryFlow: hook(false), useHostInfo: hook({ home: 'C:/synthetic' }),
    useShortcuts: hook([]), useWorkspaceShortcuts: hook({ searchRequest: 0, addRequested: false, forkError: null }),
    requestSearch: noop, requestAddWorkspace: noop, closeAddWorkspace: noop, setDirectoryBusy: noop,
    dismissForkError: noop, renderSlot: () => null, t: key => key,
  }
  browser = runner(ui.WorkspaceBrowser, props); browser.render()
  const input = () => nodes(browser.tree).find(node => node.type === 'input' && node.props.placeholder === 'search.placeholder')
  const search = () => nodes(browser.tree).find(node => node.type === ui.SearchResults)
  const tree = () => nodes(browser.tree).find(node => typeof node.type === 'function' && node.type.name === 'SessionTree')
  const resultTree = () => runner(ui.SearchResults, search().props).render()
  const fireTimers = () => { const scheduled = [...timers.values()]; timers.clear(); for (const timer of scheduled) timer.fn() }
  const change = value => { input().props.onChange({ target: { value } }); browser.render() }
  const clear = () => { input().props.onKeyDown({ key: 'Escape' }); browser.render() }

  assert.equal(input().props.tabIndex, -1, 'hidden search input stays mounted')
  assert.equal(input().props.value, '', 'initial local query is empty')
  assert.equal(tree().props.workspaces.length, 18, 'initial tree has every workspace')
  change('synthetic-no-match-username')
  assert.equal(input().props.tabIndex, -1, 'background input change leaves search chrome collapsed')
  assert.ok(search() && !tree(), 'hidden nonempty query selects SearchResults')
  assert.ok(nodes(resultTree()).some(node => node.props.role === 'status' && node.props['aria-label'] === 'search.pending'), 'same two-row pending skeleton as the report')
  assert.deepEqual([...timers.values()].map(timer => timer.delay), [250], 'host content search is debounced')
  fireTimers()
  assert.equal(pending[0].query, 'synthetic-no-match-username')
  pending[0].resolve({ items: [], hasMore: false }); await Promise.resolve(); browser.render()
  assert.ok(text(resultTree()).includes('search.noMatches'), 'successful empty result renders No matching sessions')
  assertPreserved('hidden query')
  clear()
  assert.ok(!search() && tree().props.workspaces.length === 18, 'Escape restores every original workspace')
  assertPreserved('first recovery')

  change('slow-no-match'); fireTimers(); const late = pending.at(-1)
  clear()
  assert.equal(late.signal.aborted, true, 'clear aborts the in-flight search')
  late.resolve({ items: [], hasMore: false }); await Promise.resolve(); browser.render()
  assert.ok(!search() && tree().props.workspaces.length === 18, 'late search result cannot re-hide recovered workspaces')
  assertPreserved('late result recovery')

  change('network-failure-no-match'); fireTimers(); pending.at(-1).reject(new Error('synthetic network failure'))
  await Promise.resolve(); await Promise.resolve(); browser.render()
  assert.ok(text(resultTree()).includes('search.noMatches'), 'transport failure currently uses the same empty-search text')
  clear()
  assert.equal(tree().props.workspaces.length, 18, 'failed search recovers the complete tree')
  assertPreserved('failed search recovery')

  // A legitimate visible search survives an unrelated settings/render update.
  nodes(browser.tree).find(node => node.type === 'div' && node.props.onClick && node.props.children?.some?.(child => child?.type === 'input')).props.onClick()
  browser.render(); change('Conversation 3')
  const query = input().props.value
  assert.equal(input().props.tabIndex, 0, 'intentional search is visibly expanded')
  browser.props = { ...browser.props }; browser.render()
  assert.equal(input().props.value, query, 'unrelated render does not clear intentional search')
  assert.ok(search(), 'visible search remains the selected list after unrelated render')
  clear(); assertPreserved('intentional search')

  change('reload-no-match'); browser.dispose()
  remounted = runner(ui.WorkspaceBrowser, props); remounted.render()
  assert.equal(nodes(remounted.tree).find(node => node.type === 'input' && node.props.placeholder === 'search.placeholder').props.value, '', 'remount resets only the local query')
  assertPreserved('remount')
  const persistence = ui.createWorkspaceViewStore()
  assert.equal(persistence.persist, 'dsh.workspace.view.v5')
  assert.equal('query' in persistence.init(), false, 'query is not part of persisted workspace view')
  console.log(`[ok] #232: DSH ${hostVersion} real host callbacks recover 18 synthetic workspaces, preserve original messages and 78,000-call ledger; aborted/failed/late searches and intentional visible search covered (VM hooks, not native autofill)`)
} finally {
  browser?.dispose(); remounted?.dispose(); ledger?.close()
  rmSync(work, { recursive: true, force: true })
}
