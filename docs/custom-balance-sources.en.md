# Custom balance: examples, random ports and security

A custom provider balance entry can query any HTTP endpoint (LiteLLM, NewApi, WorkBuddy, …). This page collects configuration examples, how credentials are stored, and the random-port and LAN setups.

**Where**: Settings → Cost → Quota → Custom provider balance.

## Request body and extract rules

**POST with a JSON body:** in **Settings → Cost → Quota**, expand a custom balance entry, select **POST**, then fill in **Request body (JSON)**. For example, if the endpoint expects an account and returns `{"data":{"balance":12.5}}`:

```json
{"account_id":"example-account","include_credit":true}
```

Set **Extract rules (JSON)** to `{"remaining":"data.balance"}`. Valid JSON is saved per entry and sent exactly as entered, including nested values and large integer IDs. Invalid JSON shows an error and keeps the last valid configuration; clearing the editor removes the body. GET/HEAD send no body while retaining it for a later switch back to POST. `Content-Type: application/json` is added automatically unless you supply a Content-Type header (any capitalization).

Existing `request.body` objects and raw strings remain supported. The body is ordinary saved configuration; `{{VAR}}` credential substitution applies only to request headers. For header authentication, use a reference such as `{"Authorization":"Bearer {{MY_API_KEY}}"}` and the credential input below it.

**Display currency conversion:** open **Settings → Cost → Quota**, expand a custom balance entry, and enable **Convert USD balance to display currency**. It defaults to off for each entry. Keep **Source currency** set to the endpoint's actual currency. With a USD balance of 54.3792, a CNY display rate of 7.2 and two decimal places, the balance displays as **¥391.53**. Spend and API/manual limits convert together in the sidebar, settings and tooltips; progress percentages and stored balances do not change. Enter a manual limit in the source currency. The setting persists as `convertToDisplayCurrency: true` inside that `customBalances[]` entry (legacy `customBalance` is also supported).

The global exchange rate converts **USD to the display currency**. CNY/EUR source balances and Credits keep their original units; the switch is disabled for them. Alibaba Cloud balances use the currency returned by its API. No exchange-rate lookup or extra balance request is made when toggling this setting. Turning it off restores the original currency immediately.

**DeepSeek CNY billing:** USD prices × the display exchange rate and the official CNY table can give different amounts. Settings → Cost → Prices now explains this and provides a CNY selection button. See [currency selection, sync and settlement timing](billing-currency.md#english).

For Qianwen / Alibaba Cloud fund accounts, use **Add Qianwen / Alibaba Cloud balance** to query available funds with a RAM AccessKey signature. The card uses the currency returned by the API. See the [setup, permissions and balance definition](qianwen-balance.md#english).

Qwen Token Plan can use the [official CLI subscription quota](qwen-cli-quota.md#english). Install the CLI on the DSH host and run `qianwen auth login` as the same OS user. Local estimates remain the default; CLI mode shows current account credits without changing the local ledger.

Local Qwen Token Plan credits include Plan calls assigned to Qwen. Existing subscription aliases such as `qwen` and `qwen-tokenplan` remain supported; custom providers can select Qwen under Model statistics → Billing class, or use an explicit vendor name and plan marker for auto detection. Explicit API calls are excluded. The pay-as-you-go `qianwen` provider is not assigned merely because its model ID is identical. Models outside the credits table need all three rates configured.

Xiaomi MiMo Token Plan quotas are queried with the **MiMo console cookie**, not an API key: log in at `platform.xiaomimimo.com`, press F12 → Network → find the `balanceAlertConfig` request and paste the full `cookie` request header into the MiMo card in Settings → Cost → Quotas (it must include `serviceToken` and `userId`; the DSH credential store keeps it as `MIMO_COOKIE`). The card shows the plan/compensation credit windows with the period-end reset (Beijing time) plus a balance row. Copy a fresh console cookie when the card reports an expired login. Token Plan inference keys (`tp-*` / `ttp-*`) are not accepted by this console adapter. Local plan statistics use the calendar month; compensation and balance are displayed without estimates because local calls cannot be attributed to those pools.

Each CLIProxyAPI source has a **Gemini quota only** option for its Antigravity groups. It defaults to off. Intentional filtering to no visible quota shows an empty list; malformed quota data still reports an error.

The `extract` rules accept four forms: a numeric constant, a dot path string, `add`/`subtract` over multiple paths, and `divide` scaling by a `by` divisor. **`divide` fits NewApi and other endpoints that meter balance in integer quota** (1 USD = 500000 quota — the same conversion cc-switch uses).

- **`unit: "CREDITS"`**: displays non-monetary credits using the configured decimal precision and a Credits suffix. Dollar spend is not converted to credits or shown as today's credit usage. Credit bars use the endpoint's credit cap; the global monetary budget does not apply.
- **Plain HTTP is allowed for loopback endpoints**: `http://` is accepted when the host is `127.0.0.1` / `localhost` / `[::1]` (the traffic never leaves the machine), which covers local read-only routes that listen on loopback only and serve no TLS (e.g. `dsh-workbuddy-connect`'s `/plugins/dsh-workbuddy-connect/status`). **Every non-loopback host still requires https**; plaintext is refused.

## Credentials and security

- **Variable naming**: `{{VAR_NAME}}` follows the `<ROUTE>_API_KEY` convention — `<ROUTE>` is the Provider ID from the DSH Models page (Settings → Models), uppercased with non-alphanumeric characters replaced by underscores, e.g. `openai`→`{{OPENAI_API_KEY}}`, `anthropic`→`{{ANTHROPIC_API_KEY}}`, `abc23-d`→`{{ABC23_D_API_KEY}}`. Sharing a name with the Models page means the balance query and model calls **share the same key** (both resolve from the DSH credential store). This note is also shown above the “Headers (JSON)” input in Settings.
- **Credential input fields**: after expanding an entry, the “Credential input” section renders one write-only field per `{{VAR}}` placeholder found in the headers — the key goes straight into the DSH credential store (never written to disk, never echoed back, never stored in `ledger.json`); no need to hand-edit environment variables or credential files.
- **Automatic plaintext migration**: older versions let a literal `Bearer sk-…` in the headers leak into `ledger.json` in plaintext. The plugin imports such keys into the DSH credential store at startup and replaces the header value with a `{{CUSTOM_BALANCE_KEY_…}}` placeholder (derived from the entry's host + header name, stable across restarts) — nothing breaks. From now on `ledger.json` and the config shipped to the browser **never contain plaintext keys**: suspected secret headers (Authorization / X-Api-Key / Bearer / sk- prefixes / long opaque strings) are blanked, while placeholders and ordinary headers pass through.
- **Credential allowlist `allowedHosts`**: when headers carry credentials (placeholders or plaintext), the outbound host must be on this list or the request is refused — protection against leaked keys when importing someone else's config. Without a list, requests proceed with a one-time logged warning. The entry panel provides an “Allowed hosts” input (comma-separated).
- **Mixed credential templates**: a header containing both a static secret and dynamic placeholders cannot be migrated as one nested credential. It is reported as pending and excluded from persisted/client config. Store the static part separately and use credential references throughout. Pure forms such as `Bearer {{VAR}}` and `{{USER}}:{{PASS}}` remain supported.

## WorkBuddy credits example (local plugin route)

The dedicated **WorkBuddy credits** quota card now supports dsh-xdpool. Select **Credit source → dsh-xdpool** when using multiple connectors; current, all and selected accounts work across CN/global pools. See the [integration notes](update-notes-1.9.38.md#english).

With `dsh-workbuddy-connect` installed, its web status route already returns the aggregated credit total — no credential needs to be copied:

```json
{
  "enabled": true,
  "display": "sidebar",
  "refreshMinutes": 15,
  "label": "WorkBuddy 积分",
  "labelEn": "WorkBuddy Credits",
  "unit": "CREDITS",
  "request": { "url": "http://127.0.0.1:3080/plugins/dsh-workbuddy-connect/status", "method": "GET", "headers": {} },
  "extract": { "remaining": "credits.total" }
}
```

Adjust the port and response fields to the local service. This example requires the other plugin to expose that route. Cost-meter refuses redirects and continues to enforce configured credential host allowlists.

For NewApi `GET /api/usage/token` (response `{ "code": 200, "data": { "total_granted": ..., "total_used": ..., "total_available": ..., "unlimited_quota": false } }`):

```json
{
  "enabled": true,
  "display": "both",
  "refreshMinutes": 15,
  "label": "NewApi",
  "labelEn": "NewApi",
  "unit": "USD",
  "request": {
    "url": "https://your-newapi-host/api/usage/token",
    "method": "GET",
    "headers": { "Authorization": "Bearer {{NEWAPI_API_KEY}}" }
  },
  "extract": {
    "remaining": { "op": "divide", "path": "data.total_available", "by": 500000 },
    "maxBudget": { "op": "divide", "path": "data.total_granted", "by": 500000 },
    "spend": { "op": "divide", "path": "data.total_used", "by": 500000 },
    "unit": "USD"
  }
}
```

- `{{NEWAPI_API_KEY}}` resolves from the DSH credential vault or an environment variable (**placeholders work in headers only** — the URL must be a literal address);
- Unlimited-quota tokens (`unlimited_quota: true`) have no `total_available`, so `remaining` cannot be extracted and the query reports “remaining is missing or not numeric” — use a limited-quota token or a middle-layer endpoint that converts the units;
- Entry point: Settings → Cost (Quota tab) → “Custom provider balance” → expand config; or write `config.customBalance` in `storages/cost-meter/ledger.json`.

## Random ports, LAN and WorkBuddy2API

Root-relative URLs such as `/plugins/dsh-workbuddy-connect/status` follow the running DSH web server's actual port. Independent WorkBuddy2API deployments use an absolute URL. Non-loopback HTTP requires both `allowInsecureHttp: true` and an exact `host:port` in `allowedHosts`; this explicitly permits plaintext transport. Redirects remain blocked.

The **+ WorkBuddy2API credits** preset reads `GET /api/credits/expiry?package_limit=1` with an admin `X-Admin-Token` stored as `WORKBUDDY2API_ADMIN_TOKEN` in DSH credentials. Set the real server address and matching allowlist, update expired admin tokens, then enable the card. The displayed `summary.available_remaining` is the active account pool's available credits, not currency, a single model API key's allowance, or the incomplete expiry snapshot total. No model request or upstream credit-refresh task is triggered. Authentication was tested with synthetic responses, not a live account.

## 简体中文

见 [custom-balance-sources.md](custom-balance-sources.md)。
