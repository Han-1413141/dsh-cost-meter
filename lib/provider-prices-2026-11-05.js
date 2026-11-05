/**
 * 2026-11-05 catalog additions: Mistral-hosted third-party models.
 *
 * Mistral resells Z.ai and DeepSeek models on its own endpoint at its own
 * rates, so these IDs belong to the `mistral` table rather than to `z-ai` or
 * `deepseek`. USD per 1M tokens.
 */
export const PROVIDER_PRICE_UPDATES_2026_11_05 = {
  "mistral": {
    "models": {
      "zai-glm-5-3-flash": {
        "input": 0.15,
        "output": 0.5,
        "cachedInput": 0.03,
        "billingMode": "flat",
        "sourceUrl": "https://docs.mistral.ai/models/zai-glm-5-3-flash",
        "checkedAt": "2026-11-05",
        "notes": "Mistral-hosted Z.ai GLM 5.3 Flash at Mistral's published token prices. Batch/Priority/regional/tool fees excluded."
      },
      "deepseek-v4-1-flash-1017": {
        "input": 0.3,
        "output": 1.2,
        "cachedInput": 0.007,
        "billingMode": "flat",
        "sourceUrl": "https://docs.mistral.ai/models/deepseek-v4-flash-1017",
        "checkedAt": "2026-11-05",
        "notes": "Mistral-hosted DeepSeek V4.1 Flash 1017 at Mistral's published token prices, which are double DeepSeek's own off-peak Flash rate. Batch/Priority/regional/tool fees excluded."
      }
    }
  }
}
