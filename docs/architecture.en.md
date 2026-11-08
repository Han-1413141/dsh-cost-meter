# Architecture and development

[简体中文](architecture.md) · [Contributing](../CONTRIBUTING.md)

## File layout

| Path | Responsibility |
|---|---|
| `lib/bootstrap.js`, `lib/index.js` | Plugin entry, host service, usage collection and queries |
| `lib/pricing.js`, `lib/provider-prices*.js` | Model matching, currencies, multipliers, pricing tiers and catalogs |
| `lib/store.js`, `lib/ledger-writer-worker.js` | Configuration, ledger persistence and write jobs |
| `lib/backfill.js`, session storage adapters | Historical imports and JSONL / SQLite reads |
| `src/client/` | Main browser interface source |
| `src/statistics/`, `src/pricing/`, `src/display/`, etc. | On-demand statistics, pricing and display pages |
| `lib/client*.js` | Built browser modules |
| `lib/typert.host.js` | `costMeter` RPC manifest |
| `test/`, `.github/workflows/` | Module, browser, installation and compatibility checks |

## Data flow

Host-reported usage enters the billing service and is recorded by provider, model and the price rules applicable at call time. Conversation entries read host usage and ledger amounts; call details use saved price versions. API costs and Plan equivalents remain separate, and subagents retain their own ownership.

The browser uses Typert RPC to read state, update configuration, query quotas and open details. Statistics, pricing and other pages load separately from the main interface. The build checks each client file against the host size limit.

Official balances prioritize dedicated balance credentials. Signed-in host accounts can use the host wallet service; other configurations resolve model credentials. Plan and custom-balance queries read their enabled sources. See [credential sources and priority](balance-credentials.md).

## Local development

```sh
corepack pnpm install --frozen-lockfile
npm run build
node test/verify.mjs
```

From the repository’s parent directory, link the plugin to a development profile:

```sh
dsh plugin --profile web add link:./dsh-cost-meter
dsh web
```

Rebuild after editing `src/`. Restart DSH for host changes; refresh the page for browser module changes. Browser and published-package tests document their environment variables in the test files and `.github/workflows/install-smoke.yml`.

## Data and interface requirements

- Historical reconstruction needs retained session logs; existing totals preserve older records whose details were removed.
- Plan APIs report account-wide usage, while the local ledger counts received calls. Percentage conversion follows the [plan estimation method](token-plan-stats.md#english).
- Price or quota API changes produce a visible query error while retaining existing rates or results.
- Mixed subscription and metered use can be classified by channel or model.
- See [installation troubleshooting](install-troubleshooting.md) and [session sidebar recovery](session-sidebar-recovery.md) for related errors.
