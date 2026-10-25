# Architecture, development and limitations

File layout, data channels, local debugging and the regression suite, plus known limitations.

## Architecture

![Architecture & data flow](docs/diagram-architecture.en.svg)

```
dsh-cost-meter
├── cordis.patch.yml        # bundle patch: inserts the cost-meter row into the web profile
├── install.ps1             # one-click install/update script (irm … | iex)
├── .github/workflows/      # CI: install-smoke for the one-click install path
├── package.json            # dsh.bundle patch declaration + dsh.client browser declaration
└── lib/
    ├── index.js            # host plugin: llm/stream billing wrapper, costUsage session
    │                       #   projection, costMeter service (hand-written typertRemote
    │                       #   binding), balance lookup
    ├── pricing.js          # official price table, official page HTML parsing, peak/off-peak math
    ├── store.js            # ledger persistence & config management ($DSH_HOME/storages/cost-meter)
    ├── typert.host.js      # ./typert export: Typert manifest (auto-registered by typert-loader)
    └── client.js           # ./client export: browser single-file bundle (badges/box/settings)
```

Data channels:

- **Per-conversation cost**: the host registers the `costUsage` session projection (pure token buckets, split per model); the browser reads it via `useProjection('costUsage')` and prices it with the current price table;
- **Global ledger / budget / balance / config**: `costMeter/getState | updateConfig | fetchPrices | refreshBalance | resetHistory` over the Typert gateway RPC (`remote.costMeter.*`);
- **Balance**: calls the official `GET {baseURL}/user/balance`, reusing the same API key as model requests (credential service / env var), with an in-process cache expiring per `refreshMinutes`.

The plugin never imports cordis/dsh Service/Context runtime classes (only Node builtins, zod, and pure functions from dsh-home-paths and dsh-credentials), so it shares one runtime instance with the host with no duplicated dependency risk.

## Development & verification

```sh
corepack pnpm install                                   # dependencies
node --check lib/index.js && node --check lib/pricing.js \
  && node --check lib/store.js && node --check lib/typert.host.js \
  && node --check lib/client.js                         # syntax checks
node test/verify.mjs                                    # pure-module verification (parsing/billing/ledger/config)
node test/mock-balance.mjs                              # (optional) local balance API mock: 3101
dsh --profile web --dump-config                         # composition-tree check
dsh --profile web --port 3099                           # real startup (watch logs and the UI)
```

## Known limitations

For loading placeholders followed by “No matching sessions” after opening Cost,
see [non-destructive sidebar search recovery](session-sidebar-recovery.md).
Check and clear the host search before changing stored data.

- Official-page parsing depends on the current page structure; after a redesign, “Sync prices from official docs” fails — edit the price table manually as a fallback;
- The session badge's fallback estimate (used when ledger data is unavailable) prices all of a session's calls at the tier of the *current* moment, including plan-type sessions: a session spanning peak and off-peak hours gets its off-peak portion overestimated during peak hours; exact figures come from the ledger (which bills each call at its own initiation moment);
- Price sync overwrites the same-named models listed on the official page; custom model entries are unaffected;
- Balance lookup needs network access to api.deepseek.com and a valid API key; **the API key is only ever sent to the official domain** (if baseURL points at a non-official host, balance queries refuse to run — model requests are unaffected);
- The OpenCode Go quota endpoint is the official opencode.ai endpoint (community-documented); if its response shape changes, the Settings page shows an error and the display can be turned off in Display settings;
- The per-1% quota / full-window figures in Token Plan stats are estimates: vendors only report percentages with ones-digit quantization (a displayed 1% may really be 0.5%–1.5%), so the plugin derives them from end-to-end deltas over continuous sample segments to suppress quantization noise (segments spanning <5 percentage points are tagged "low reading precision"; samples older than 7 days fall back to live ratio; window edges align to whole hours). Server percentages cover ALL usage of the account — consumption of the same key on other machines/CLIs is not in the local ledger, so low estimates are expected; treat them as cross-plan comparisons only;
- Plan/API classification is inferred from channel and config; mixed subscription/PAYG usage of one vendor (e.g. Kimi) can be overridden per provider:model in settings.
- A restart of `dsh web` is required after installing/updating the plugin.

## 简体中文

见 [architecture.md](architecture.md)。
