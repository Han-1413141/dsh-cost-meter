# Features and screenshots

[简体中文](features.md) · [Home](../README.md)

Screenshots use sample data. Select an image for full resolution.

## Conversations and calls

Composer, header and turn cost entries have independent switches. Open a conversation’s details to view categories, treemaps, agent ownership or a step heatmap, then inspect each call’s rates, tokens, inputs and tool results.

[Statistics and call details](billing-statistics.md#english) · [Context costs](context-costs-design.md)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/conversation-dark.png">
  <img src="images/conversation-light.png" alt="Conversation costs, plan quotas and account balance" width="1280">
</picture>

| Conversation distribution | Parent/subagent ownership |
| --- | --- |
| [![Conversation distribution](images/treemap.png)](images/treemap.png) | [![Parent/subagent ownership](images/agents.png)](images/agents.png) |

| Step heatmap | Call rates and tokens |
| --- | --- |
| [![Step heatmap](images/step-costs.png)](images/step-costs.png) | [![Call rates and tokens](images/call-details.png)](images/call-details.png) |

## Statistics, budgets and exports

Filter costs by date, provider and model. Inspect API charges, Plan equivalents, cache hit rates, token composition and model rankings. Budgets cover today, the current month, all time or custom dates and warn at configured thresholds. Export cost records for one or all retained conversations as CSV summaries, per-call CSV or JSON.

[Statistics and exports](billing-statistics.md#english) · [Billing rules](billing.en.md)

| Overview and budgets | Trends and rankings |
| --- | --- |
| [![Overview and budgets](images/overview.png)](images/overview.png) | [![Trends and rankings](images/statistics.png)](images/statistics.png) |

| Cache and model statistics | Conversation export |
| --- | --- |
| [![Cache and model statistics](images/efficiency.png)](images/efficiency.png) | [![Conversation export](images/export.png)](images/export.png) |

## Subscription quotas and balances

Plan cards display usage windows, percentages and reset times. Enabled cards retain their status and retry action when credentials are missing or queries fail. Sources include Codex / ChatGPT subscriptions, OpenCode Go, Coding Plan providers and WorkBuddy credits. CLIProxyAPI shows per-account quotas; custom balances support HTTP endpoints, credential references, response extraction and dashboard links.

[Providers and credentials](model-and-plan-adaptation.en.md) · [Balance credentials](balance-credentials.md) · [Custom balances](custom-balance-sources.en.md) · [Gateway setup](cliproxyapi-quota.md)

| Plan quota windows | Codex / ChatGPT sources |
| --- | --- |
| [![Plan quota windows](images/quotas.png)](images/quotas.png) | [![Codex / ChatGPT sources](images/codex-quota.png)](images/codex-quota.png) |

| Gateway account quotas | Custom balance configuration |
| --- | --- |
| [![Gateway account quotas](images/gateway.png)](images/gateway.png) | [![Custom balance configuration](images/custom-balance.png)](images/custom-balance.png) |

## Model prices and pricing alerts

The catalog groups models by provider, with automatic matching, manual mappings and custom rates. Base, peak and off-peak tiers have separate rates and multipliers; channels can set their own hours and holidays. Schedule bars show the current tier and countdown, with optional popup and system notifications before a price change. DeepSeek synchronization and OpenRouter catalog updates retain their respective price sources.

[Custom prices](custom-model-prices.md) · [Channel schedules](provider-peak-schedules.md) · [Pricing alerts](peak-alert.en.md) · [OpenRouter catalog](openrouter-prices.md)

| Model matching and prices | Peak rules and alerts |
| --- | --- |
| [![Model matching and prices](images/model-pricing.png)](images/model-pricing.png) | [![Peak rules and alerts](images/peak-pricing.png)](images/peak-pricing.png) |

## Historical usage and storage

The usage page includes token heatmaps, daily history, model statistics and estimated tokens and equivalent costs per 1% of quota and for the full quota window. Import pre-installation conversations, configure retention and preview cleanup. JSONL and better-session SQLite backends are supported, together with read-only usage snapshots from external tools. Editing prices preserves historical amounts; explicit repricing requires confirmation and creates a backup.

[Plan statistics](token-plan-stats.md#english) · [Retention](pricing-history-storage.md) · [Repricing](model-history-repricing.md) · [SQLite sessions](better-session.md) · [External usage](external-usage.md)

| Token heatmap and history | Plan usage estimates |
| --- | --- |
| [![Token heatmap and history](images/usage.png)](images/usage.png) | [![Plan usage estimates](images/plan-statistics.png)](images/plan-statistics.png) |

## Local-model API-equivalent costs

The optional Local savings card filters provider IDs by prefix and shows daily, weekly, monthly and retained-history amounts at a selected reference API rate. Expand it for per-model tokens and costs; choose the reference model and tier in Display settings. [Configuration](local-savings.md#english)

## Display, themes and mobile

The display page offers clickable previews for the sidebar, composer, turn costs, quota strip and corner panel. Sidebar components support drag ordering. Choose standard, merged, compact or simple layouts; control individual amount displays, currency, exchange rate and language. Light, dark and narrow mobile layouts are supported.

[Display settings](display-settings.md) · [Sidebar layouts](sidebar-simple.md) · [Exchange rates](exchange-rates.md)

| Interactive display settings | Dark overview |
| --- | --- |
| [![Interactive display settings](images/display.png)](images/display.png) | [![Dark overview](images/overview-dark.png)](images/overview-dark.png) |

| English interface |
| --- |
| [![English interface](images/overview-en.png)](images/overview-en.png) |

<p align="center">
  <img src="images/mobile-overview.png" width="260" alt="Mobile overview">
  <img src="images/mobile-details.png" width="260" alt="Mobile cost details">
</p>
