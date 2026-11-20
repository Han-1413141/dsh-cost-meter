# Qoder CN Plan Quota Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show Qoder CN subscription credits as a new coding-plan provider in dsh-cost-meter, read from the installed dsh-connect-qoder connector.

**Architecture:** Credential-less provider `qoder` mirroring the WorkBuddy connector integration: a new `lib/qoder-connect.js` fetches the connector's local `/plugins/dsh-connect-qoder/usage?region=cn` route, an adapter branch in `queryCodingPlan` maps it to `balance`/`cycleReset` windows, and the client gets a plan row + i18n + alias entries. Host code is hand-written `lib/*.js`; client bundles are generated from `src/` by `node scripts/build.mjs`.

**Tech Stack:** Plain ESM JavaScript (no TypeScript), node:test-free assert scripts run by `node test/verify.mjs`, esbuild client build.

**Spec:** docs/superpowers/specs/2026-11-20-qoder-plan-design.md

## Global Constraints

- CN region only — never query `region=global` (user decision m00220).
- Never copy identity fields (`accountId`, `accountName`) into windows/messages/results; billing fields only.
- Soft errors carry `error.soft = true` and codes `qoderConnectNotInstalled` / `qoderConnectUnavailable` / `qoderConnectSignedOut` / `qoderConnectCreditsFailed`; bilingual zh/en messages in both `lib/index.js` tmsg dicts.
- Never hand-edit generated `lib/client.js` / `lib/client.plan-settings.js`; edit `src/` and run `node scripts/build.mjs`.
- Version bump patch-only 1.9.77 → 1.9.78 aligned in `package.json`, `install.ps1`, `README.md`, `README.zh-CN.md`, plus `CHANGELOG.md` and `docs/UPDATE-HISTORY.md`.
- No secrets in repo files or test fixtures; synthetic values only.
- Files end with exactly one trailing newline.

## Review Focus

1. Connector not installed (404 or SPA HTML shell on the route) → soft `qoderConnectNotInstalled`, not a crash or a red hard error.
2. Connector signed out / region disabled → soft `qoderConnectSignedOut` with actionable text, not stale credits shown as live.
3. Signed in but malformed credits (`total` missing/NaN/negative, packages malformed) → soft `qoderConnectCreditsFailed`; a malformed package must not poison a valid total.
4. Identity leakage: accountName/accountId from the usage payload must never appear in serialized results (fixture asserts, WorkBuddy pattern).
5. Host without loopback webServer (`customBalanceHostOrigin` → null) → soft not-installed, no fetch to a non-loopback origin.

---

### Task 1: Connector fetch + parser (`lib/qoder-connect.js`)

**Files:**
- Create: `lib/qoder-connect.js`
- Test: `test/qoder-connect.mjs`
- Modify: `test/verify.mjs` (add `import './qoder-connect.mjs'` next to the workbuddy imports)

**Interfaces:**
- Consumes: `fetchWithRetry`, `readJsonBounded` from `lib/net.js` (same options as lib/workbuddy.js:168: `{method:'GET', redirect:'error', headers:{accept:'application/json'}, signal}`, `{timeoutMs:35000, attempts:1, fetchImpl}`).
- Produces:
  - `export const QODER_USAGE_PATH = '/plugins/dsh-connect-qoder/usage?region=cn'`
  - `export const QODER_ERROR_CODES = ['qoderConnectNotInstalled','qoderConnectUnavailable','qoderConnectSignedOut','qoderConnectCreditsFailed']`
  - `export function parseQoderUsage(status) -> { total:number, packages:[{name:string,remain:number,size:number}], planExpiresAtMs:number|undefined } | null` — null when `status.status !== 'signed-in'` handled by caller; here null means credits invalid. Copies billing fields only; packages filtered to rows with string packageName and finite non-negative remain/size, capped at 20 rows; invalid packages dropped, not fatal.
  - `export async function fetchQoderConnectUsage(hostOrigin, { signal, fetchImpl } = {}) -> { total, packages, planExpiresAtMs?, endpoint } | null` — null when `hostOrigin` falsy or route 404/HTML (caller maps null → notInstalled); throws coded errors (`Object.assign(new Error(code), { code })` pattern from lib/workbuddy.js:153 `workbuddyError`) for the other three cases.

- [x] **Step 1: Write failing tests** — `test/qoder-connect.mjs`, local `node:http` server on `127.0.0.1:0` with mutable `status`/`httpStatus`/`html` vars and `requestLog` (copy test/workbuddy-connect.mjs skeleton). Fixture payload uses synthetic identity `accountName:'DO_NOT_COPY', accountId:'DO_NOT_COPY'` and `credits:{total:1984, packages:[{packageName:'base',remain:1384,size:6000},{packageName:'addon',remain:600,size:1700}], planExpiresAtMs:1797264000000}`. Assertions:
  - signed-in → result.total 1984, packages length 2, planExpiresAtMs preserved, `JSON.stringify(result).includes('DO_NOT_COPY') === false`, exactly one request with path `/plugins/dsh-connect-qoder/usage?region=cn`, method GET, no authorization header.
  - `httpStatus=404` → returns null; `html=true` (content-type text/html) → returns null.
  - `httpStatus=500` → throws code `qoderConnectUnavailable`.
  - `status.status='signed-out'` and separately `status.enabled=false` → throws `qoderConnectSignedOut`.
  - `credits.total='abc'` / missing credits → throws `qoderConnectCreditsFailed`; valid total + one malformed package row → succeeds with that row dropped.
  - `fetchQoderConnectUsage(null)` → null, zero requests.
  - `parseQoderUsage` direct: negative total → null; packages capped at 20.
  - Register the file in test/verify.mjs imports.
- [x] **Step 2: Run `node test/qoder-connect.mjs`** — expected FAIL (module not found).
- [x] **Step 3: Implement `lib/qoder-connect.js`** — single-route GET (no fallback loop, CN only); 404 → `response.body?.cancel?.()` then return null; HTML content-type → null; `!ok` → unavailable; parse envelope with `readJsonBounded`; signed-out/enabled-false → signedOut; `parseQoderUsage` null → creditsFailed; return `{...parsed, endpoint: new URL(QODER_USAGE_PATH, hostOrigin).href}`. `signal?.throwIfAborted()` after awaits (workbuddy pattern). JSDoc on every export.
- [x] **Step 4: Run `node test/qoder-connect.mjs`** — expected PASS.
- [x] **Step 5: Commit** — `git add lib/qoder-connect.js test/qoder-connect.mjs test/verify.mjs && git commit -m "feat: add Qoder CN connector usage fetch and parser"`

### Task 2: Provider registration + adapter branch

**Files:**
- Modify: `lib/coding-plans.js` (registry ~:49-146; `queryCodingPlan` workbuddy branch ends :1556 — insert qoder branch right after, before the string-key check :1557)
- Modify: `lib/index.js` (tmsg zh dict ~:202-209, en dict ~:312-319; `resolveCodingPlanKey` :1032; `describePlanKey` :1655)
- Modify: `lib/plan-provider-aliases.js` (add `qoder: ['qoder','qoder-cn']` to PLAN_PROVIDER_ALIASES; FORWARDING_PROVIDER_IDS untouched)
- Test: `test/qoder-plan-quota.mjs` (register in test/verify.mjs)

**Interfaces:**
- Consumes: Task 1 exports; existing `textWindowOf`, `normalizeResetAt`, `formatWorkBuddyBalance` (reuse for thousands separators — it is a pure number formatter) from lib/coding-plans.js; `customBalanceHostOrigin` from lib/custom-balance.js.
- Produces: provider id `'qoder'` in `CODING_PLAN_PROVIDERS` = `{ label:'Qoder 积分', credentialEnvs:[], keyHint:'无需凭据;自动读取 dsh-connect-qoder 连接插件(CN)' }`; `queryCodingPlan('qoder', {hostOrigin}, locale, t, {signal})` → `{ windows:{ balance:{resetsAt:'',text}, cycleReset?:{resetsAt,text:''} }, message?, endpoint }`.

- [x] **Step 1: Write failing tests** — `test/qoder-plan-quota.mjs` reusing the local-server fixture:
  - `queryCodingPlan('qoder', {hostOrigin}, 'en', (_,code)=>code)` → `windows.balance.text === '1,984'`; `windows.cycleReset.resetsAt === new Date(1797264000000).toISOString()`; result.message contains `base 1,384/6,000` and `addon 600/1,700`; no DO_NOT_COPY anywhere.
  - no planExpiresAtMs → no cycleReset key. Empty packages → message '' or absent.
  - 404 → throws with `.soft === true` and message code `qoderConnectNotInstalled`; signed-out → soft `qoderConnectSignedOut`; `queryCodingPlan('qoder', null, ...)` → soft notInstalled (null key object → hostOrigin undefined).
  - zh locale soft error message is the Chinese tmsg string (call with real `tmsg`-shaped dict via lib/index.js export if available; otherwise assert code passthrough like workbuddy tests).
  - `planProviderIdOf('qoder-cn', {}, 'qmodel_latest')` from lib/plan-billing.js → `{id:'qoder', provider:'qoder-cn'}`; `'qoder-global'` → null plan attribution (stays forwarding-only).
- [x] **Step 2: Run `node test/qoder-plan-quota.mjs`** — expected FAIL (unknown provider).
- [x] **Step 3: Implement** —
  - registry entry (alphabetical position irrelevant; append before closing brace, keep CODING_PLAN_PROVIDER_IDS derivation intact);
  - adapter branch: `if (provider === 'qoder')` → call `fetchQoderConnectUsage(options.hostOrigin, {signal})`; null → throw soft notInstalled; catch coded errors from QODER_ERROR_CODES → wrap `new Error(t(locale, code, {provider: meta.label}))` with `.soft=true` (mirror :1534-1541); windows.balance = `textWindowOf(formatWorkBuddyBalance(usage.total))`; cycleReset when `planExpiresAtMs > 0` via `normalizeResetAt`; message = packages.map(p => `${p.name} ${fmt(p.remain)}/${fmt(p.size)}`).join(' · ') when non-empty; return `{windows, ...(message?{message}:{}), endpoint: usage.endpoint}`.
  - lib/index.js: four bilingual tmsg entries (zh: 未安装/无法读取/未登录/积分无效 with actionable hints pointing at the dsh-connect-qoder plugin card; en equivalents); `resolveCodingPlanKey`: `if (provider === 'qoder') return { hostOrigin: customBalanceHostOrigin(ctx) }`; `describePlanKey`: `if (id === 'qoder') return config.codingPlans?.qoder?.enabled === true ? { keyConfigured: true, keySource: 'connector' } : fallback` (placed next to the workbuddy special case, before the `refs.length === 0` fallback).
  - alias entry in lib/plan-provider-aliases.js with a comment noting qoder-global intentionally excluded (CN-only).
- [x] **Step 4: Run `node test/qoder-plan-quota.mjs && node test/verify.mjs`** — expected PASS (full suite catches registry-shape assumptions in existing tests, e.g. plan-provider-matching.mjs).
- [x] **Step 5: Commit** — `git commit -am "feat: register Qoder CN coding-plan provider with connector adapter"` (stage the four files explicitly).

### Task 3: Client — plan row, i18n, aliases, settings note

**Files:**
- Modify: `src/client/03-settings-panels-main.js:1197-1213` (CODING_PLAN_ROWS: add `{ id:'qoder', labelKey:'qoderT' }` after workbuddy)
- Modify: `src/client/01-open-styles-i18n.js` (zh ~:794 add `qoderT:'Qoder 积分', qoderH:'自动读取 dsh-connect-qoder 连接插件的 CN 订阅积分,无需填写凭据。'`; en ~:1301 add `qoderT:'Qoder credits', qoderH:'Reads CN subscription credits from the dsh-connect-qoder connector; no credential needed.'`)
- Modify: `src/client/02-validators-helpers-sidebar.js` (:1369 PLAN_PROVIDER_IDS_LOCAL add `'qoder'`; :1349 PLAN_PROVIDER_ALIASES_LOCAL add `qoder:['qoder','qoder-cn']`; :3258 titleValue condition add `|| id === 'qoder'`)
- Modify: `src/plan-settings/index.js` (:228 credential-field condition add `&& planId !== 'qoder'`; :307 area add a qoder branch rendering `el('p',{className:'cm-note'}, t('qoderH'))` like workbuddy's note but without account UI)
- Modify: `lib/subscription-catalog.js` (add `qoder` entry: checkedAt '2026-11-20', sourceUrl connector README GitHub URL, tiers ['CN'], models ['qmodel_latest','qmodel_latest_preview'], zh/en describing 100 credits/day check-in, 30-day pack validity, plan-level expiry display)
- Test: extend `test/qoder-plan-quota.mjs` or existing client-side checks if a src-level test harness exists (check test/coding-plan-placeholder.mjs pattern); otherwise assert via built bundle grep in Step 4.

**Interfaces:**
- Consumes: provider id `'qoder'`, windows shape from Task 2; existing `codingPlanWindowLabel` balance branch (no new window names introduced — cycleReset already renders as text row).
- Produces: labelKey `qoderT`, note key `qoderH` used by both settings chunk and i18n dicts.

- [x] **Step 1: Make the src edits above.**
- [x] **Step 2: Run `node scripts/build.mjs`** — expected: bundles regenerate without size-cap errors (fragments ≤262144 bytes).
- [x] **Step 3: Verify generated output** — `grep -c "qoderT" lib/client.js lib/client.plan-settings.js` both ≥1; `grep -c "region=cn" lib/qoder-connect.js` = 1 and no `region=global` in lib/qoder-connect.js.
- [x] **Step 4: Run `node test/verify.mjs`** — expected PASS (catalog/placeholder tests may enumerate providers; fix any fixture that hardcodes the provider count, updating the test to describe the new behavior).
- [x] **Step 5: Commit** — `git add src lib/client.js lib/client.plan-settings.js lib/subscription-catalog.js test && git commit -m "feat: Qoder plan card, settings note and subscription catalog entry"`

### Task 4: Docs, version bump, live verification, push

**Files:**
- Modify: `docs/model-and-plan-adaptation.md` + `docs/model-and-plan-adaptation.en.md` (add Qoder CN row: connector prerequisite, no credential, credits+expiry semantics, CN-only)
- Modify: `README.md`, `README.zh-CN.md` (vendor count 16→17 and Qoder mention in feature list; version references)
- Modify: `package.json`, `install.ps1` (1.9.77 → 1.9.78)
- Modify: `CHANGELOG.md`, `docs/UPDATE-HISTORY.md` (1.9.78 entry: Qoder CN plan quota via dsh-connect-qoder connector)
- Create: this plan's checkbox updates.

- [x] **Step 1: Docs + version edits** (bilingual parity; one trailing newline).
- [x] **Step 2: Run `node test/verify.mjs && node scripts/build.mjs`** — expected PASS; confirm no version-string test mismatch.
- [x] **Step 3: Live verification** — install fork into a scratch copy or point the running profile at the fork per user choice; minimally: `node -e` probe calling `fetchQoderConnectUsage('http://192.168.2.1:3080')` prints total 1984-ish and packages; then enable `codingPlans.qoder` in the profile config and confirm the sidebar card shows `余额: 1,984` (values will differ live).
- [x] **Step 4: Commit** — `git commit -am "docs: Qoder CN plan adaptation; release 1.9.78"`
- [x] **Step 5: Push** — `git push -u origin qoder-plan` to raininfall/dsh-cost-meter.
