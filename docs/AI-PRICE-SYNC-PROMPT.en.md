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
   - For every model, the off-peak and peak prices (USD / 1M tokens): cache hit, cache miss, output;
     off-peak rates are half of the peak rates;
   - The peak-hour windows (UTC hour ranges, e.g. 01:00-04:00, 06:00-10:00);
   - Every model id listed on the page (e.g. deepseek-v4-flash, deepseek-v4-pro).
   - Note: the official scheme is now pure two-tier (off-peak/peak), so the page may no longer list a
     base price or an effective time; in that case set cacheHit/cacheMiss/output to the off-peak
     numbers and set effectiveAt to the current time (takes effect immediately).
3. Output a price table per the JSON Schema below (output ONLY the JSON code block, nothing else):

{
  "models": {
    "<model-id>": {
      "cacheHit": 0.007,
      "cacheMiss": 0.22,
      "output": 0.66,
      "offPeak": { "cacheHit": 0.007, "cacheMiss": 0.22, "output": 0.66 },
      "peak": { "cacheHit": 0.014, "cacheMiss": 0.44, "output": 1.32 }
    }
  },
  "default": { "cacheHit": 0.007, "cacheMiss": 0.22, "output": 0.66 },
  "effectiveAt": "<current ISO time>",
  "peakWindows": [{ "start": 1, "end": 4 }, { "start": 6, "end": 10 }]
}

Rules:
- Prices are in USD / 1M tokens; keep every decimal digit the page shows;
- Cache writes have no separate price — bill them at the cache-hit price; do not invent new fields;
- The official scheme is now pure two-tier: put the off-peak numbers into cacheHit/cacheMiss/output
  (do not invent a third tier); if the page still lists a base price, copy it and explain;
- "default" is the fallback price for unmatched models (use the off-peak price of the cheapest tier on the page);
- Do not include models the page does not list; do not fabricate numbers; mark uncertain numbers as null and explain why;
- If prices are segmented by effective time (e.g. "changes effective from a certain date"), additionally output
  {"schedule": [{"effectiveAt": "...", "models": {...}}]} and explain the old/new differences.

Finally provide:
a) the extraction basis (the key table fragments verbatim from the page);
b) a diff against the built-in dsh-cost-meter price table
   (deepseek-v4-flash: 0.007/0.22/0.66, deepseek-v4-pro: 0.022/0.66/1.98,
   peaks 0.014/0.44/1.32 and 0.044/1.32/3.96 respectively);
c) a "manual review checklist": where each number sits on the page.
```

---

## How to apply (pick one)

1. **Settings page (recommended, manual)**: open Settings → Cost → Price table and edit the numbers one by one per the AI's output;
   changes are **saved automatically**.
2. **RPC (automation)**: call `costMeter/updateConfig` on the host gateway with a patch like:
   ```json
   {"patch": {"prices": {"models": {"deepseek-v4-flash": {"cacheHit": 0.007, "cacheMiss": 0.22, "output": 0.66, "offPeak": {...}, "peak": {...}}}}, "peakEffectiveAt": "<current ISO time>", "peakWindows": [{"start": 1, "end": 4}, {"start": 6, "end": 10}], "priceSource": "manual", "fetchedAt": "<ISO timestamp>"}}
   ```
3. **Edit the file directly (advanced)**: edit `config.prices` / `config.peakEffectiveAt` / `config.peakWindows`
   in `$DSH_HOME/storages/cost-meter/ledger.json`; before restarting `dsh web`, make sure the JSON is valid and every number is non-negative.

## Billing semantics (must follow)

- cost = cache-missed input × cacheMiss + output × output + (cache read + cache write) × cacheHit.
- The official scheme is now **pure two-tier**: peak windows use `peak` and everything else uses `offPeak`; the base price equals the off-peak price (when the page has no base price, use off-peak).
- Off-peak / peak are **two independent sets of numbers**; write exactly the tiers the page provides — do not invent a third tier.
- Do not delete custom model entries from the ledger; keep historical models the official page no longer lists (e.g. deepseek-chat) with a legacy marker instead.

## Verification checklist (after applying)

- [ ] Both price tiers match the page for every model (digit-by-digit);
- [ ] Peak-hour windows match the page's "Peak hours are …";
- [ ] When the page has no effective time, `effectiveAt` is the current time and the Settings page shows the peak/off-peak status directly (no more "not effective yet");
- [ ] The peak/off-peak status is correct.
