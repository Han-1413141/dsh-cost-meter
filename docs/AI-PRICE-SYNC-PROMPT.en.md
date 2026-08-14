# AI Price Sync Prompt

Hand the prompt below to any AI with web/tool capability (e.g. a DeepSeek Harness session, Claude, GPT, etc.),
and it will autonomously **read the official pricing and sync per-model, time-of-day prices**,
producing price data that dsh-cost-meter can consume directly. You can review its output before applying.

---

## Prompt you can copy straight into an AI

```text
You are the price-sync assistant for the dsh-cost-meter plugin of DeepSeek Harness. Complete the following task:

1. Open the official DeepSeek pricing page: https://api-docs.deepseek.com/quick_start/pricing
   (if the page is unavailable, try https://api-docs.deepseek.com/zh-cn/quick_start/pricing or the official announcements page).
2. Extract the following information from the page:
   - For every model, the three base prices (USD / 1M tokens): cache hit, cache miss, output;
   - If the page provides a peak/off-peak pricing table: each model's off-peak and peak prices,
     plus the effective time (exact UTC date and time) and the peak-hour windows (UTC hour ranges,
     e.g. 01:00-04:00, 06:00-10:00);
   - Every model id listed on the page (e.g. deepseek-v4-flash, deepseek-v4-pro).
3. Output a price table per the JSON Schema below (output ONLY the JSON code block, nothing else):

{
  "models": {
    "<model-id>": {
      "cacheHit": 0.0028,
      "cacheMiss": 0.14,
      "output": 0.28,
      "offPeak": { "cacheHit": 0.007, "cacheMiss": 0.22, "output": 0.66 },
      "peak": { "cacheHit": 0.014, "cacheMiss": 0.44, "output": 1.32 }
    }
  },
  "default": { "cacheHit": 0.0028, "cacheMiss": 0.14, "output": 0.28 },
  "effectiveAt": "2026-08-16T16:00:00Z",
  "peakWindows": [{ "start": 1, "end": 4 }, { "start": 6, "end": 10 }]
}

Rules:
- Prices are in USD / 1M tokens; keep every decimal digit the page shows;
- Cache writes have no separate price — bill them at the cache-hit price; do not invent new fields;
- If the page has no peak/off-peak pricing: omit the offPeak / peak / effectiveAt / peakWindows fields;
- "default" is the fallback price for unmatched models (use the base price of the cheapest tier on the page);
- Do not include models the page does not list; do not fabricate numbers; mark uncertain numbers as null and explain why;
- If prices are segmented by effective time (e.g. "changes effective from a certain date"), additionally output
  {"schedule": [{"effectiveAt": "...", "models": {...}}]} and explain the old/new differences.

Finally provide:
a) the extraction basis (the key table fragments verbatim from the page);
b) a diff against the built-in dsh-cost-meter price table
   (deepseek-v4-flash: 0.0028/0.14/0.28, deepseek-v4-pro: 0.003625/0.435/0.87,
   peak/off-peak effective from 2026-08-16T16:00Z);
c) a "manual review checklist": where each number sits on the page.
```

---

## How to apply (pick one)

1. **Settings page (recommended, manual)**: open Settings → Cost → Price table and edit the numbers one by one per the AI's output;
   changes are **saved automatically**.
2. **RPC (automation)**: call `costMeter/updateConfig` on the host gateway with a patch like:
   ```json
   {"patch": {"prices": {"models": {"deepseek-v4-flash": {"cacheHit": 0.0028, "cacheMiss": 0.14, "output": 0.28, "offPeak": {...}, "peak": {...}}}}, "peakEffectiveAt": "2026-08-16T16:00:00Z", "peakWindows": [{"start": 1, "end": 4}, {"start": 6, "end": 10}], "priceSource": "manual", "fetchedAt": "<ISO timestamp>"}}
   ```
3. **Edit the file directly (advanced)**: edit `config.prices` / `config.peakEffectiveAt` / `config.peakWindows`
   in `$DSH_HOME/storages/cost-meter/ledger.json`; before restarting `dsh web`, make sure the JSON is valid and every number is non-negative.

## Billing semantics (must follow)

- cost = cache-missed input × cacheMiss + output × output + (cache read + cache write) × cacheHit.
- Peak/off-peak pricing is **gated by effective time**: before `effectiveAt` the base price always applies; after that, peak windows use `peak` and everything else uses `offPeak`.
- Base / off-peak / peak are **three independent sets of numbers**; write exactly the tiers the page provides — never treat the base price as the off-peak price.
- Do not delete custom model entries from the ledger; keep historical models the official page no longer lists (e.g. deepseek-chat) with a legacy marker instead.

## Verification checklist (after applying)

- [ ] All three price tiers match the page for every model (digit-by-digit);
- [ ] `effectiveAt` matches the page's "take effect at … UTC";
- [ ] Peak-hour windows match the page's "Peak hours are …";
- [ ] Before the effective time, the Settings page tier status shows "not effective yet … billing at base price";
- [ ] After the effective time, the peak/off-peak status is correct.
