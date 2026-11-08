# Billing rules and storage

[简体中文](billing.md) · [Home](../README.md)

## Cost sources

The plugin calculates costs from host-reported usage and configured rates. Input, cached input, cache writes, output and reasoning tokens use their respective rates. Separate search or web-fetch request charges are recorded separately.

- **API cost** covers metered channels and contributes to the default budget and totals.
- **Plan equivalent** values subscription calls at model rates and is recorded separately.
- **Balances and quotas** come from account or plan endpoints; locally estimated plan usage is labeled in the card.

Choose Automatic, Plan or API at channel or model level; model overrides take priority. “Include Plan totals” adds Plan equivalents to displayed sums. Subagent costs retain their own session ownership and can be included in parent views. External tools can provide [read-only usage snapshots](external-usage.md).

See [statistics and call scope](billing-statistics.md#english), [Search / Fetch charges](web-request-fees.md#english) and [Billion Context billing](billion-context-billing.md).

## Rates, multipliers and pricing windows

Rates are configured per million tokens in their stated currency. Base, peak and off-peak fields have individual multipliers; the effective rate is rate × multiplier. A uniform multiplier applies to all fields in the same tier.

Peak-enabled models select the tier at request start. Default peak windows are 01:00–04:00 and 06:00–10:00 UTC; weekends and configured holidays use off-peak rates. Channel settings can override hours, calendar rules and holidays; model settings take priority. Historical calls use recorded price versions and their applicable schedules.

See [custom rates](custom-model-prices.md), [channel schedules](provider-peak-schedules.md) and [alerts](peak-alert.en.md). Budget thresholds display warnings while calls remain available.

## Currency, synchronization and history

The ledger stores USD costs and the CNY/EUR amounts recorded at call time. Historical statistics use those saved amounts; updating today’s exchange rate does not reprice past calls. See [daily exchange rates and historical amounts](exchange-rates.md). DeepSeek maintains separate official USD and CNY rates. For a CNY account, select CNY under Cost → Prices before synchronizing. See [currency and settlement](billing-currency.md#english).

DeepSeek prices are parsed from official pages; OpenRouter uses its public catalog. Parsing failures retain existing rates. Synchronization is rejected when a currency change would use an incomplete official table. Custom models and channel rules follow the [synchronization rules](official-price-sync-safety.md#english).

Rate, multiplier and mapping changes apply to subsequent calls. [Explicit historical repricing](model-history-repricing.md) requires confirmation and retains a backup, original amounts and price versions; records with incomplete logs are skipped.

## Storage and credentials

- The ledger lives at `$DSH_HOME/storages/cost-meter/ledger.json`, using atomic writes and batched saves. See [retention and cleanup](pricing-history-storage.md).
- Credentials are stored through DSH credentials, excluded from ledger files and browser state, and never echoed back by the input fields. See [credential sources](balance-credentials.md).
- Configuration saves automatically. Balance and quota requests follow each source’s enable switch and refresh interval.
- Tokens and equivalent costs per 1% of quota and for the full quota window are estimated from quota readings and local usage. Usage from other tools on the same account affects the ratio. See [estimation details](token-plan-stats.md#english).

## Price references

[Models and plans](model-and-plan-adaptation.en.md) · [OpenRouter pricing](openrouter-pricing.md) · [Price research prompt](AI-PRICE-SYNC-PROMPT.en.md)
