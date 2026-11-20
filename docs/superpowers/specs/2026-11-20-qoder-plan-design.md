# Qoder CN plan quota — design

Date: 2026-11-20 · Branch: `qoder-plan` · Fork: raininfall/dsh-cost-meter (upstream Han-1413141/dsh-cost-meter v1.9.77, MIT)

## Intent

Show the user's Qoder CN subscription credits in dsh-cost-meter alongside the existing coding-plan vendors, reading them from the already-installed `@dmh2002/dsh-connect-qoder` connector. No new credentials, no PAT UI.

## Approaches considered

- **A (chosen, user m00201): connector-peer adapter.** New credential-less provider `qoder` that GETs the connector's existing local route `/plugins/dsh-connect-qoder/usage?region=cn`, exactly like the WorkBuddy connector integration. Zero connector changes; connector owns PAT→jobToken auth and upstream caching.
- B: read connector pool state files directly — rejected: private format, misses live credits, duplicates auth logic.
- C: external_usage.json writer in the connector — rejected: requires changing someone else's plugin; cost-meter side alone can't deliver it.

User constraint (m00220): **CN region only, no global fallback.**

## Data source (probed live)

`GET {hostOrigin}/plugins/dsh-connect-qoder/usage?region=cn` → JSON:
`{status:"signed-in", enabled:true, accountId, accountName, credits:{total, packages:[{packageName,remain,size}], planExpiresAtMs}, creditsAtMs, models:[...], ...}`.
Only billing fields are copied; identity fields (accountName, accountId) never enter windows or messages.

## Behavior

- Provider id `qoder`, label `Qoder 积分` / `Qoder credits`, `credentialEnvs: []`.
- Windows: `balance` text window = formatted total (thousands separators, number only — same as WorkBuddy; label comes from the window name). `cycleReset` window `{resetsAt: ISO(planExpiresAtMs), text: ''}` when present (same shape WorkBuddy uses for expiry).
- Package breakdown (`base 1,384/6,000 · addon 600/1,700`) goes into the result `message` (shown in the hover detail), not the balance text — keeps the sidebar title row short. (Builder call, refines the earlier "balance text with breakdown" sketch; WorkBuddy precedent wins.)
- Soft errors (bilingual, `error.soft = true`): `qoderConnectNotInstalled` (404 / SPA HTML shell / no hostOrigin), `qoderConnectUnavailable` (non-ok HTTP / network), `qoderConnectSignedOut` (`status !== 'signed-in'` or `enabled === false`), `qoderConnectCreditsFailed` (signed in but invalid `credits.total`).
- Host key resolution returns `{hostOrigin: customBalanceHostOrigin(ctx)}` (loopback-only, existing helper). `describePlanKey`: enabled → `{keyConfigured:true, keySource:'connector'}`; disabled → fallback. No credential probe needed — the connector is the credential.
- Plan billing attribution: add `PLAN_PROVIDER_ALIASES.qoder = ['qoder','qoder-cn']` (host + client mirror). `qoder-global` stays forwarding-only (CN-only decision). FORWARDING_PROVIDER_IDS and pricing routes stay untouched — alias lookup runs first in `planProviderIdOf`.
- Settings page: no credential field for `qoder`; a note (`qoderH`) explains it reads the dsh-connect-qoder connector. Refresh-interval field stays (remote query, unlike scnet).
- Subscription catalog entry `qoder`: check-in 100 credits/day, 30-day validity, expiry = account plan expiry not pack expiry; source = connector README.
- Client: `CODING_PLAN_ROWS` entry `{id:'qoder', labelKey:'qoderT'}`; balance-on-title-row treatment extended to `qoder`; i18n `qoderT`/`qoderH` zh+en; `PLAN_PROVIDER_IDS_LOCAL` + alias mirror.

## Non-goals

No global region, no PAT entry UI, no check-in triggering, no connector changes, no per-model multiplier display, no account switching.

## Constraints

- Repo AGENTS.md: patch-only version bump 1.9.77 → 1.9.78, aligned in package.json / install.ps1 / README.md / README.zh-CN.md + CHANGELOG.md + docs/UPDATE-HISTORY.md; no secrets in repo; bilingual server messages.
- Host code is hand-written `lib/*.js`; client is generated from `src/client/*` + `src/plan-settings/*` via `node scripts/build.mjs` — never edit `lib/client*.js` by hand.
- Tests: `node test/verify.mjs`; new test file must be added to its import list. Local-http-server fixture pattern from test/workbuddy-connect.mjs.

## Verification

`pnpm test` green (incl. new qoder tests), `node scripts/build.mjs` regenerates client bundles, live probe against the running host shows the Qoder card with real credits.
