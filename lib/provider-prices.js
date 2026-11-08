import { PROVIDER_PRICE_UPDATES_2026_11_05 } from './provider-prices-2026-11-05.js'
import { PROVIDER_PRICE_UPDATES_2026_10_28 } from './provider-prices-2026-10-28.js'
import { PROVIDER_PRICE_UPDATES } from './provider-prices-2026-10-15.js'
import { STEPFUN_PRICES } from './stepfun-prices.js'

// Verified 2026-10-03: direct vendor API prices and complete OpenCode Zen/Go
// endpoint price tables. USD / 1M tokens; each sourceUrl belongs to its route.
// Never use these gateway rates as another provider's automatic fallback.
export const PROVIDER_PRICES_2026_10_03 = {
  "openai": {
    "models": {
      "gpt-6-sol": {
        "input": 2.0,
        "output": 10.0,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket. Entire request uses long tier only above272000 input tokens.",
        "cachedInput": 0.2,
        "cacheWrite": 2.5,
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 4.0,
          "cacheHit": 0.4,
          "output": 15.0,
          "cacheWrite": 5.0
        }
      },
      "gpt-6.1-sol": {
        "input": 2.0,
        "output": 10.0,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket. Entire request uses long tier only above272000 input tokens.",
        "cachedInput": 0.1,
        "cacheWrite": 2.5,
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 4.0,
          "cacheHit": 0.2,
          "output": 15.0,
          "cacheWrite": 5.0
        }
      },
      "gpt-6-luna": {
        "input": 0.1,
        "output": 0.5,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket. Entire request uses long tier only above272000 input tokens.",
        "cachedInput": 0.01,
        "cacheWrite": 0.125,
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 0.2,
          "cacheHit": 0.02,
          "output": 0.75,
          "cacheWrite": 0.25
        }
      },
      "gpt-6-astra": {
        "input": 10.0,
        "output": 50.0,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket. Entire request uses long tier only above272000 input tokens.",
        "cachedInput": 1.0,
        "cacheWrite": 12.5,
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 20.0,
          "cacheHit": 2.0,
          "output": 75.0,
          "cacheWrite": 25.0
        }
      },
      "gpt-5.6-sol": {
        "input": 4.0,
        "output": 20.0,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket. Entire request uses long tier only above272000 input tokens.",
        "cachedInput": 0.4,
        "cacheWrite": 5.0,
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 8.0,
          "cacheHit": 0.8,
          "output": 30.0,
          "cacheWrite": 10.0
        }
      },
      "gpt-5.6-terra": {
        "input": 2.0,
        "output": 12.0,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket. Entire request uses long tier only above272000 input tokens.",
        "cachedInput": 0.2,
        "cacheWrite": 2.5,
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 4.0,
          "cacheHit": 0.4,
          "output": 18.0,
          "cacheWrite": 5.0
        }
      },
      "gpt-5.6-luna": {
        "input": 0.2,
        "output": 1.2,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket. Entire request uses long tier only above272000 input tokens.",
        "cachedInput": 0.02,
        "cacheWrite": 0.25,
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 0.4,
          "cacheHit": 0.04,
          "output": 1.8,
          "cacheWrite": 0.5
        }
      },
      "gpt-5.5": {
        "input": 5.0,
        "output": 30.0,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket. Entire request uses long tier only above272000 input tokens.",
        "cachedInput": 0.5,
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 10.0,
          "cacheHit": 1.0,
          "output": 45.0
        }
      },
      "gpt-5.5-pro": {
        "input": 30.0,
        "output": 180.0,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Published direct Standard rates: short input30/output180; long input60/output270 USD/M. The pricing table labels short context<272K, but the model detail does not establish the exact equality/context counting rule. Intentionally unpriced pending clarification; no guessed boundary.",
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 60.0,
          "cacheHit": 60.0,
          "output": 270.0
        },
        "unpriced": true
      },
      "gpt-5.4": {
        "input": 2.5,
        "output": 15.0,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket. Entire request uses long tier only above272000 input tokens.",
        "cachedInput": 0.25,
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 5.0,
          "cacheHit": 0.5,
          "output": 22.5
        }
      },
      "gpt-5.4-mini": {
        "input": 0.75,
        "output": 4.5,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket.",
        "cachedInput": 0.075
      },
      "gpt-5.4-nano": {
        "input": 0.2,
        "output": 1.25,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket.",
        "cachedInput": 0.02
      },
      "gpt-5.4-pro": {
        "input": 30.0,
        "output": 180.0,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket. Entire request uses long tier only above272000 input tokens.",
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 60.0,
          "cacheHit": 60.0,
          "output": 270.0
        }
      },
      "gpt-5.2": {
        "input": 1.75,
        "output": 14.0,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket.",
        "cachedInput": 0.175
      },
      "gpt-5.2-pro": {
        "input": 21.0,
        "output": 168.0,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket."
      },
      "gpt-5.1": {
        "input": 1.25,
        "output": 10.0,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket.",
        "cachedInput": 0.125
      },
      "gpt-5": {
        "input": 1.25,
        "output": 10.0,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket.",
        "cachedInput": 0.125
      },
      "gpt-5-mini": {
        "input": 0.25,
        "output": 2.0,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket.",
        "cachedInput": 0.025
      },
      "gpt-5-nano": {
        "input": 0.05,
        "output": 0.4,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket.",
        "cachedInput": 0.005
      },
      "gpt-5-pro": {
        "input": 15.0,
        "output": 120.0,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket."
      },
      "gpt-4.1": {
        "input": 2.0,
        "output": 8.0,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket.",
        "cachedInput": 0.5
      },
      "gpt-4.1-mini": {
        "input": 0.4,
        "output": 1.6,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket.",
        "cachedInput": 0.1
      },
      "gpt-4.1-nano": {
        "input": 0.1,
        "output": 0.4,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket.",
        "cachedInput": 0.025
      },
      "gpt-4o": {
        "input": 2.5,
        "output": 10.0,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket.",
        "cachedInput": 1.25
      },
      "gpt-4o-2024-05-13": {
        "input": 5.0,
        "output": 15.0,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket."
      },
      "gpt-4o-mini": {
        "input": 0.15,
        "output": 0.6,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket.",
        "cachedInput": 0.075
      },
      "o1": {
        "input": 15.0,
        "output": 60.0,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket.",
        "cachedInput": 7.5
      },
      "o1-pro": {
        "input": 150.0,
        "output": 600.0,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket."
      },
      "o3-pro": {
        "input": 20.0,
        "output": 80.0,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket."
      },
      "o3": {
        "input": 2.0,
        "output": 8.0,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket.",
        "cachedInput": 0.5
      },
      "o4-mini": {
        "input": 1.1,
        "output": 4.4,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket.",
        "cachedInput": 0.275
      },
      "o3-mini": {
        "input": 1.1,
        "output": 4.4,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket.",
        "cachedInput": 0.55
      },
      "gpt-4-turbo-2024-04-09": {
        "input": 10.0,
        "output": 30.0,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket."
      },
      "gpt-4-0613": {
        "input": 30.0,
        "output": 60.0,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket."
      },
      "gpt-3.5-turbo": {
        "input": 0.5,
        "output": 1.5,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket."
      },
      "gpt-3.5-turbo-0125": {
        "input": 0.5,
        "output": 1.5,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket."
      },
      "gpt-3.5-turbo-1106": {
        "input": 1.0,
        "output": 2.0,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket."
      },
      "gpt-3.5-turbo-instruct": {
        "input": 1.5,
        "output": 2.0,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket."
      },
      "davinci-002": {
        "input": 2.0,
        "output": 2.0,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket."
      },
      "babbage-002": {
        "input": 0.4,
        "output": 0.4,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official Standard global direct OpenAI API token prices. Other processing tiers, regional/FedRAMP10% uplifts, tools and modality-specific costs excluded. A dash in the source means that cache rate is not independently available, not a free cache bucket."
      },
      "chat-latest": {
        "input": 5.0,
        "cachedInput": 0.5,
        "output": 30.0,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official grouped Standard text-token price for ChatGPT. Extra search/tool fees excluded. No future-billing/restricted Rosalind, embeddings or moderation units inferred."
      },
      "gpt-5.3-codex": {
        "input": 1.75,
        "cachedInput": 0.175,
        "output": 14.0,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official grouped Standard text-token price for Codex. Extra search/tool fees excluded. No future-billing/restricted Rosalind, embeddings or moderation units inferred."
      },
      "gpt-5-search-api": {
        "input": 1.25,
        "cachedInput": 0.125,
        "output": 10.0,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official grouped Standard text-token price for Search. Extra search/tool fees excluded. No future-billing/restricted Rosalind, embeddings or moderation units inferred."
      }
    }
  },
  "anthropic": {
    "models": {
      "claude-fable-5-1": {
        "input": 10.0,
        "cachedInput": 0.25,
        "cacheWrite": 12.5,
        "output": 50.0,
        "billingMode": "flat",
        "sourceUrl": "https://platform.claude.com/docs/en/about-claude/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official direct Claude API Standard global token rates. cacheWrite is5-minute creation;1-hour creation is20USD/M and requires separate TTL usage. Other tiers, regional premiums and tool fees excluded. Full1M context uses standard rates."
      },
      "claude-opus-5-5": {
        "input": 4.0,
        "cachedInput": 0.2,
        "cacheWrite": 5.0,
        "output": 20.0,
        "billingMode": "flat",
        "sourceUrl": "https://platform.claude.com/docs/en/about-claude/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official direct Claude API Standard global token rates. cacheWrite is5-minute creation;1-hour creation is8USD/M and requires separate TTL usage. Other tiers, regional premiums and tool fees excluded. Full1M context uses standard rates."
      },
      "claude-sonnet-5-5": {
        "input": 2.0,
        "cachedInput": 0.2,
        "cacheWrite": 2.5,
        "output": 10.0,
        "billingMode": "flat",
        "sourceUrl": "https://platform.claude.com/docs/en/about-claude/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official direct Claude API Standard global token rates. cacheWrite is5-minute creation;1-hour creation is4USD/M and requires separate TTL usage. Other tiers, regional premiums and tool fees excluded. Full1M context uses standard rates."
      },
      "claude-haiku-4-5": {
        "input": 1.0,
        "cachedInput": 0.1,
        "cacheWrite": 1.25,
        "output": 5.0,
        "billingMode": "flat",
        "sourceUrl": "https://platform.claude.com/docs/en/about-claude/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official direct Claude API Standard global token rates. cacheWrite is5-minute creation;1-hour creation is2USD/M and requires separate TTL usage. Other tiers, regional premiums and tool fees excluded."
      },
      "claude-mythos-5-1": {
        "input": 10.0,
        "cachedInput": 0.25,
        "cacheWrite": 12.5,
        "output": 50.0,
        "billingMode": "flat",
        "sourceUrl": "https://platform.claude.com/docs/en/about-claude/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official direct Claude API Standard global token rates. cacheWrite is5-minute creation;1-hour creation is20USD/M and requires separate TTL usage. Other tiers, regional premiums and tool fees excluded. Invite-only availability does not change published per-token rates. Full1M context uses standard rates."
      },
      "claude-fable-5": {
        "input": 10.0,
        "cachedInput": 1.0,
        "cacheWrite": 12.5,
        "output": 50.0,
        "billingMode": "flat",
        "sourceUrl": "https://platform.claude.com/docs/en/about-claude/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official direct Claude API Standard global token rates. cacheWrite is5-minute creation;1-hour creation is20USD/M and requires separate TTL usage. Other tiers, regional premiums and tool fees excluded. Full1M context uses standard rates."
      },
      "claude-mythos-5": {
        "input": 10.0,
        "cachedInput": 1.0,
        "cacheWrite": 12.5,
        "output": 50.0,
        "billingMode": "flat",
        "sourceUrl": "https://platform.claude.com/docs/en/about-claude/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official direct Claude API Standard global token rates. cacheWrite is5-minute creation;1-hour creation is20USD/M and requires separate TTL usage. Other tiers, regional premiums and tool fees excluded. Invite-only availability does not change published per-token rates. Full1M context uses standard rates."
      },
      "claude-opus-5": {
        "input": 5.0,
        "cachedInput": 0.5,
        "cacheWrite": 6.25,
        "output": 25.0,
        "billingMode": "flat",
        "sourceUrl": "https://platform.claude.com/docs/en/about-claude/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official direct Claude API Standard global token rates. cacheWrite is5-minute creation;1-hour creation is10USD/M and requires separate TTL usage. Other tiers, regional premiums and tool fees excluded. Full1M context uses standard rates."
      },
      "claude-opus-4-8": {
        "input": 5.0,
        "cachedInput": 0.5,
        "cacheWrite": 6.25,
        "output": 25.0,
        "billingMode": "flat",
        "sourceUrl": "https://platform.claude.com/docs/en/about-claude/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official direct Claude API Standard global token rates. cacheWrite is5-minute creation;1-hour creation is10USD/M and requires separate TTL usage. Other tiers, regional premiums and tool fees excluded. Full1M context uses standard rates."
      },
      "claude-opus-4-7": {
        "input": 5.0,
        "cachedInput": 0.5,
        "cacheWrite": 6.25,
        "output": 25.0,
        "billingMode": "flat",
        "sourceUrl": "https://platform.claude.com/docs/en/about-claude/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official direct Claude API Standard global token rates. cacheWrite is5-minute creation;1-hour creation is10USD/M and requires separate TTL usage. Other tiers, regional premiums and tool fees excluded. Full1M context uses standard rates."
      },
      "claude-opus-4-6": {
        "input": 5.0,
        "cachedInput": 0.5,
        "cacheWrite": 6.25,
        "output": 25.0,
        "billingMode": "flat",
        "sourceUrl": "https://platform.claude.com/docs/en/about-claude/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official direct Claude API Standard global token rates. cacheWrite is5-minute creation;1-hour creation is10USD/M and requires separate TTL usage. Other tiers, regional premiums and tool fees excluded. Full1M context uses standard rates."
      },
      "claude-opus-4-5": {
        "input": 5.0,
        "cachedInput": 0.5,
        "cacheWrite": 6.25,
        "output": 25.0,
        "billingMode": "flat",
        "sourceUrl": "https://platform.claude.com/docs/en/about-claude/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official direct Claude API Standard global token rates. cacheWrite is5-minute creation;1-hour creation is10USD/M and requires separate TTL usage. Other tiers, regional premiums and tool fees excluded."
      },
      "claude-sonnet-5": {
        "input": 2.0,
        "cachedInput": 0.2,
        "cacheWrite": 2.5,
        "output": 10.0,
        "billingMode": "flat",
        "sourceUrl": "https://platform.claude.com/docs/en/about-claude/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official direct Claude API Standard global token rates. cacheWrite is5-minute creation;1-hour creation is4USD/M and requires separate TTL usage. Other tiers, regional premiums and tool fees excluded. Full1M context uses standard rates."
      },
      "claude-sonnet-4-6": {
        "input": 3.0,
        "cachedInput": 0.3,
        "cacheWrite": 3.75,
        "output": 15.0,
        "billingMode": "flat",
        "sourceUrl": "https://platform.claude.com/docs/en/about-claude/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official direct Claude API Standard global token rates. cacheWrite is5-minute creation;1-hour creation is6USD/M and requires separate TTL usage. Other tiers, regional premiums and tool fees excluded. Full1M context uses standard rates."
      },
      "claude-sonnet-4-5": {
        "input": 3.0,
        "cachedInput": 0.3,
        "cacheWrite": 3.75,
        "output": 15.0,
        "billingMode": "flat",
        "sourceUrl": "https://platform.claude.com/docs/en/about-claude/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Current direct Claude Sonnet 4.5: maximum 200K context; 1M beta retired 2026-04-30 and over-limit requests fail. Standard rates for valid requests; 5-minute cache writes3.75USD/M, 1-hour writes6USD/M need TTL-specific accounting. Zen publishes a separate route with a long-context tier. Sources: https://platform.claude.com/docs/en/build-with-claude/context-windows and https://platform.claude.com/docs/en/release-notes/overview."
      }
    }
  },
  "google": {
    "models": {
      "gemini-3.8-flash": {
        "input": 0.75,
        "cachedInput": 0.075,
        "output": 3.75,
        "billingMode": "flat",
        "sourceUrl": "https://ai.google.dev/gemini-api/docs/pricing?hl=en",
        "checkedAt": "2026-10-03",
        "notes": "Standard paid direct Gemini Developer API promotional prices through 2026-12-31. Starting 2027-01-01: input1.50/cacheRead0.15/output7.50 USD/M. Cache storage is0.50 USD/M token/hour now,1.00 from2027; excluded from per-request token estimate. Output includes thinking. Zen currently charges the higher1.50/0.15/7.50 route rates. Batch/Flex/Priority/free-tier/grounding excluded."
      },
      "gemini-3.7-flash": {
        "input": 0.75,
        "cachedInput": 0.075,
        "output": 3.75,
        "billingMode": "flat",
        "sourceUrl": "https://ai.google.dev/gemini-api/docs/pricing?hl=en",
        "checkedAt": "2026-10-03",
        "notes": "Standard paid direct Gemini Developer API promotional prices through 2026-12-31. Starting 2027-01-01: input1.50/cacheRead0.15/output7.50 USD/M. Cache storage is0.50 USD/M token/hour now,1.00 from2027; excluded from per-request token estimate. Output includes thinking. Zen currently charges the higher1.50/0.15/7.50 route rates. Batch/Flex/Priority/free-tier/grounding excluded."
      },
      "gemini-3.6-flash": {
        "input": 0.75,
        "cachedInput": 0.075,
        "output": 3.75,
        "billingMode": "flat",
        "sourceUrl": "https://ai.google.dev/gemini-api/docs/pricing?hl=en",
        "checkedAt": "2026-10-03",
        "notes": "Standard paid direct Gemini Developer API promotional prices through 2026-12-31. Starting 2027-01-01: input1.50/cacheRead0.15/output7.50 USD/M. Cache storage is0.50 USD/M token/hour now,1.00 from2027; excluded from per-request token estimate. Output includes thinking. Zen currently charges the higher1.50/0.15/7.50 route rates. Batch/Flex/Priority/free-tier/grounding excluded."
      },
      "gemini-3.1-flash-lite": {
        "input": 0.25,
        "cachedInput": 0.025,
        "output": 1.5,
        "billingMode": "flat",
        "sourceUrl": "https://ai.google.dev/gemini-api/docs/pricing?hl=en",
        "checkedAt": "2026-10-03",
        "notes": "Standard paid text/image/video input. Audio input0.50/cacheRead0.05 USD/M is a different modality; this generic token row cannot price that accurately. Cache storage1USD/M/hour and grounding excluded."
      }
    }
  },
  "xai": {
    "models": {
      "grok-4.7": {
        "input": 2,
        "cachedInput": 0.5,
        "output": 6,
        "billingMode": "flat",
        "sourceUrl": "https://docs.x.ai/developers/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard global direct API. Official pricing table states long context ≥200000 prompt tokens, entire request. aboveInputTokens199999 represents that inclusive cutoff for integer counts; differs from Zen table >200K wording. US regional1.1x and server-tool fees excluded.",
        "longContext": {
          "aboveInputTokens": 199999,
          "cacheMiss": 4,
          "cacheHit": 1,
          "output": 12
        }
      },
      "grok-build-0.1": {
        "input": 1,
        "cachedInput": 0.2,
        "output": 2,
        "billingMode": "flat",
        "sourceUrl": "https://docs.x.ai/developers/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard global direct API. Official pricing table states long context ≥200000 prompt tokens, entire request. aboveInputTokens199999 represents that inclusive cutoff for integer counts; differs from Zen table >200K wording. US regional1.1x and server-tool fees excluded.",
        "longContext": {
          "aboveInputTokens": 199999,
          "cacheMiss": 2,
          "cacheHit": 0.4,
          "output": 4
        }
      },
      "grok-4.6": {
        "input": 2,
        "cachedInput": 0.5,
        "output": 6,
        "billingMode": "flat",
        "sourceUrl": "https://docs.x.ai/developers/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard global direct API. Official pricing table states long context ≥200000 prompt tokens, entire request. aboveInputTokens199999 represents that inclusive cutoff for integer counts; differs from Zen table >200K wording. US regional1.1x and server-tool fees excluded.",
        "longContext": {
          "aboveInputTokens": 199999,
          "cacheMiss": 4,
          "cacheHit": 1,
          "output": 12
        }
      },
      "grok-4.5": {
        "input": 2,
        "cachedInput": 0.3,
        "output": 6,
        "billingMode": "flat",
        "sourceUrl": "https://docs.x.ai/developers/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard global direct API. Official pricing table states long context ≥200000 prompt tokens, entire request. aboveInputTokens199999 represents that inclusive cutoff for integer counts; differs from Zen table >200K wording. US regional1.1x and server-tool fees excluded.",
        "longContext": {
          "aboveInputTokens": 199999,
          "cacheMiss": 4,
          "cacheHit": 0.6,
          "output": 12
        }
      },
      "grok-4.3": {
        "input": 1.25,
        "cachedInput": 0.2,
        "output": 2.5,
        "billingMode": "flat",
        "sourceUrl": "https://docs.x.ai/developers/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard global direct API. Official pricing table states long context ≥200000 prompt tokens, entire request. aboveInputTokens199999 represents that inclusive cutoff for integer counts; differs from Zen table >200K wording. US regional1.1x and server-tool fees excluded.",
        "longContext": {
          "aboveInputTokens": 199999,
          "cacheMiss": 2.5,
          "cacheHit": 0.4,
          "output": 5
        }
      },
      "grok-4.20-multi-agent-0309": {
        "input": 1.25,
        "cachedInput": 0.2,
        "output": 2.5,
        "billingMode": "flat",
        "sourceUrl": "https://docs.x.ai/developers/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard global direct API. Official pricing table states long context ≥200000 prompt tokens, entire request. aboveInputTokens199999 represents that inclusive cutoff for integer counts; differs from Zen table >200K wording. US regional1.1x and server-tool fees excluded.",
        "longContext": {
          "aboveInputTokens": 199999,
          "cacheMiss": 2.5,
          "cacheHit": 0.4,
          "output": 5
        }
      },
      "grok-4.20-0309-reasoning": {
        "input": 1.25,
        "cachedInput": 0.2,
        "output": 2.5,
        "billingMode": "flat",
        "sourceUrl": "https://docs.x.ai/developers/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard global direct API. Official pricing table states long context ≥200000 prompt tokens, entire request. aboveInputTokens199999 represents that inclusive cutoff for integer counts; differs from Zen table >200K wording. US regional1.1x and server-tool fees excluded.",
        "longContext": {
          "aboveInputTokens": 199999,
          "cacheMiss": 2.5,
          "cacheHit": 0.4,
          "output": 5
        }
      },
      "grok-4.20-0309-non-reasoning": {
        "input": 1.25,
        "cachedInput": 0.2,
        "output": 2.5,
        "billingMode": "flat",
        "sourceUrl": "https://docs.x.ai/developers/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard global direct API. Official pricing table states long context ≥200000 prompt tokens, entire request. aboveInputTokens199999 represents that inclusive cutoff for integer counts; differs from Zen table >200K wording. US regional1.1x and server-tool fees excluded.",
        "longContext": {
          "aboveInputTokens": 199999,
          "cacheMiss": 2.5,
          "cacheHit": 0.4,
          "output": 5
        }
      }
    }
  },
  "mistral": {
    "models": {
      "mistral-large-2512": {
        "input": 0.5,
        "cachedInput": 0.05,
        "output": 1.5,
        "billingMode": "flat",
        "sourceUrl": "https://docs.mistral.ai/inference/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct Mistral global token prices. Batch/Priority/regional/tool fees excluded."
      },
      "mistral-large-latest": {
        "input": 0.5,
        "cachedInput": 0.05,
        "output": 1.5,
        "billingMode": "flat",
        "sourceUrl": "https://docs.mistral.ai/inference/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct Mistral global token prices. Batch/Priority/regional/tool fees excluded."
      },
      "mistral-medium-3-5": {
        "input": 1.5,
        "cachedInput": 0.15,
        "output": 7.5,
        "billingMode": "flat",
        "sourceUrl": "https://docs.mistral.ai/inference/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct Mistral global token prices. Batch/Priority/regional/tool fees excluded."
      },
      "mistral-medium-3": {
        "input": 1.5,
        "cachedInput": 0.15,
        "output": 7.5,
        "billingMode": "flat",
        "sourceUrl": "https://docs.mistral.ai/inference/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct Mistral global token prices. Batch/Priority/regional/tool fees excluded."
      },
      "mistral-medium-latest": {
        "input": 1.5,
        "cachedInput": 0.15,
        "output": 7.5,
        "billingMode": "flat",
        "sourceUrl": "https://docs.mistral.ai/inference/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct Mistral global token prices. Batch/Priority/regional/tool fees excluded."
      },
      "mistral-small-2603": {
        "input": 0.15,
        "cachedInput": 0.015,
        "output": 0.6,
        "billingMode": "flat",
        "sourceUrl": "https://docs.mistral.ai/inference/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct Mistral global token prices. Batch/Priority/regional/tool fees excluded."
      },
      "mistral-small-latest": {
        "input": 0.15,
        "cachedInput": 0.015,
        "output": 0.6,
        "billingMode": "flat",
        "sourceUrl": "https://docs.mistral.ai/inference/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct Mistral global token prices. Batch/Priority/regional/tool fees excluded."
      },
      "ministral-14b-2512": {
        "input": 0.2,
        "cachedInput": 0.02,
        "output": 0.2,
        "billingMode": "flat",
        "sourceUrl": "https://docs.mistral.ai/inference/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct Mistral global token prices. Batch/Priority/regional/tool fees excluded."
      },
      "ministral-14b-latest": {
        "input": 0.2,
        "cachedInput": 0.02,
        "output": 0.2,
        "billingMode": "flat",
        "sourceUrl": "https://docs.mistral.ai/inference/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct Mistral global token prices. Batch/Priority/regional/tool fees excluded."
      },
      "ministral-8b-2512": {
        "input": 0.15,
        "cachedInput": 0.015,
        "output": 0.15,
        "billingMode": "flat",
        "sourceUrl": "https://docs.mistral.ai/inference/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct Mistral global token prices. Batch/Priority/regional/tool fees excluded."
      },
      "ministral-8b-latest": {
        "input": 0.15,
        "cachedInput": 0.015,
        "output": 0.15,
        "billingMode": "flat",
        "sourceUrl": "https://docs.mistral.ai/inference/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct Mistral global token prices. Batch/Priority/regional/tool fees excluded."
      },
      "ministral-3b-2512": {
        "input": 0.1,
        "cachedInput": 0.01,
        "output": 0.1,
        "billingMode": "flat",
        "sourceUrl": "https://docs.mistral.ai/inference/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct Mistral global token prices. Batch/Priority/regional/tool fees excluded."
      },
      "ministral-3b-latest": {
        "input": 0.1,
        "cachedInput": 0.01,
        "output": 0.1,
        "billingMode": "flat",
        "sourceUrl": "https://docs.mistral.ai/inference/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct Mistral global token prices. Batch/Priority/regional/tool fees excluded."
      },
      "zai-glm-5-3": {
        "input": 1.4,
        "cachedInput": 0.14,
        "output": 4.4,
        "billingMode": "flat",
        "sourceUrl": "https://docs.mistral.ai/inference/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct Mistral global token prices. Batch/Priority/regional/tool fees excluded. Mistral-hosted GLM cache read0.14 differs from direct ZAI0.26."
      },
      "zai-glm-5": {
        "input": 1.4,
        "cachedInput": 0.14,
        "output": 4.4,
        "billingMode": "flat",
        "sourceUrl": "https://docs.mistral.ai/inference/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct Mistral global token prices. Batch/Priority/regional/tool fees excluded. Mistral-hosted GLM cache read0.14 differs from direct ZAI0.26."
      },
      "zai-glm-latest": {
        "input": 1.4,
        "cachedInput": 0.14,
        "output": 4.4,
        "billingMode": "flat",
        "sourceUrl": "https://docs.mistral.ai/inference/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct Mistral global token prices. Batch/Priority/regional/tool fees excluded. Mistral-hosted GLM cache read0.14 differs from direct ZAI0.26."
      },
      "codestral-2508": {
        "input": 0.3,
        "cachedInput": 0.03,
        "output": 0.9,
        "billingMode": "flat",
        "sourceUrl": "https://docs.mistral.ai/inference/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct Mistral global token prices. Batch/Priority/regional/tool fees excluded."
      },
      "codestral-latest": {
        "input": 0.3,
        "cachedInput": 0.03,
        "output": 0.9,
        "billingMode": "flat",
        "sourceUrl": "https://docs.mistral.ai/inference/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct Mistral global token prices. Batch/Priority/regional/tool fees excluded."
      },
      "codestral-embed-2505": {
        "input": 0.15,
        "cachedInput": 0.015,
        "output": 0,
        "billingMode": "flat",
        "sourceUrl": "https://docs.mistral.ai/inference/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct Mistral global token prices. Batch/Priority/regional/tool fees excluded. Embedding-only endpoint, no generated output token charge; output0 represents not applicable, not free generated completions."
      },
      "codestral-embed": {
        "input": 0.15,
        "cachedInput": 0.015,
        "output": 0,
        "billingMode": "flat",
        "sourceUrl": "https://docs.mistral.ai/inference/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct Mistral global token prices. Batch/Priority/regional/tool fees excluded. Embedding-only endpoint, no generated output token charge; output0 represents not applicable, not free generated completions."
      }
    }
  },
  "z-ai": {
    "models": {
      "glm-5.3-flash": {
        "input": 0.15,
        "output": 0.5,
        "cachedInput": 0.03,
        "billingMode": "flat",
        "sourceUrl": "https://docs.z.ai/guides/overview/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct ZAI USD/token prices; cached input storage is currently limited-time free, not a separately established cache-creation-token rate. Domestic CNY routes, Coding Plans and web-search/tool fees excluded."
      },
      "glm-5.3-flashx": {
        "input": 0.37,
        "output": 1.25,
        "cachedInput": 0.075,
        "billingMode": "flat",
        "sourceUrl": "https://docs.z.ai/guides/overview/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct ZAI USD/token prices; cached input storage is currently limited-time free, not a separately established cache-creation-token rate. Domestic CNY routes, Coding Plans and web-search/tool fees excluded."
      },
      "glm-5.3": {
        "input": 1.4,
        "output": 4.4,
        "cachedInput": 0.26,
        "billingMode": "flat",
        "sourceUrl": "https://docs.z.ai/guides/overview/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct ZAI USD/token prices; cached input storage is currently limited-time free, not a separately established cache-creation-token rate. Domestic CNY routes, Coding Plans and web-search/tool fees excluded."
      },
      "glm-5.2": {
        "input": 1.4,
        "output": 4.4,
        "cachedInput": 0.26,
        "billingMode": "flat",
        "sourceUrl": "https://docs.z.ai/guides/overview/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct ZAI USD/token prices; cached input storage is currently limited-time free, not a separately established cache-creation-token rate. Domestic CNY routes, Coding Plans and web-search/tool fees excluded."
      },
      "glm-5.1": {
        "input": 1.4,
        "output": 4.4,
        "cachedInput": 0.26,
        "billingMode": "flat",
        "sourceUrl": "https://docs.z.ai/guides/overview/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct ZAI USD/token prices; cached input storage is currently limited-time free, not a separately established cache-creation-token rate. Domestic CNY routes, Coding Plans and web-search/tool fees excluded."
      },
      "glm-5": {
        "input": 1.0,
        "output": 3.2,
        "cachedInput": 0.2,
        "billingMode": "flat",
        "sourceUrl": "https://docs.z.ai/guides/overview/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct ZAI USD/token prices; cached input storage is currently limited-time free, not a separately established cache-creation-token rate. Domestic CNY routes, Coding Plans and web-search/tool fees excluded."
      },
      "glm-4.7": {
        "input": 0.6,
        "output": 2.2,
        "cachedInput": 0.11,
        "billingMode": "flat",
        "sourceUrl": "https://docs.z.ai/guides/overview/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct ZAI USD/token prices; cached input storage is currently limited-time free, not a separately established cache-creation-token rate. Domestic CNY routes, Coding Plans and web-search/tool fees excluded."
      },
      "glm-4.7-flashx": {
        "input": 0.07,
        "output": 0.4,
        "cachedInput": 0.01,
        "billingMode": "flat",
        "sourceUrl": "https://docs.z.ai/guides/overview/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct ZAI USD/token prices; cached input storage is currently limited-time free, not a separately established cache-creation-token rate. Domestic CNY routes, Coding Plans and web-search/tool fees excluded."
      },
      "glm-4.6": {
        "input": 0.6,
        "output": 2.2,
        "cachedInput": 0.11,
        "billingMode": "flat",
        "sourceUrl": "https://docs.z.ai/guides/overview/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct ZAI USD/token prices; cached input storage is currently limited-time free, not a separately established cache-creation-token rate. Domestic CNY routes, Coding Plans and web-search/tool fees excluded."
      },
      "glm-4.5": {
        "input": 0.6,
        "output": 2.2,
        "cachedInput": 0.11,
        "billingMode": "flat",
        "sourceUrl": "https://docs.z.ai/guides/overview/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct ZAI USD/token prices; cached input storage is currently limited-time free, not a separately established cache-creation-token rate. Domestic CNY routes, Coding Plans and web-search/tool fees excluded."
      },
      "glm-4.5-x": {
        "input": 2.2,
        "output": 8.9,
        "cachedInput": 0.45,
        "billingMode": "flat",
        "sourceUrl": "https://docs.z.ai/guides/overview/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct ZAI USD/token prices; cached input storage is currently limited-time free, not a separately established cache-creation-token rate. Domestic CNY routes, Coding Plans and web-search/tool fees excluded."
      },
      "glm-4.5-air": {
        "input": 0.2,
        "output": 1.1,
        "cachedInput": 0.03,
        "billingMode": "flat",
        "sourceUrl": "https://docs.z.ai/guides/overview/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct ZAI USD/token prices; cached input storage is currently limited-time free, not a separately established cache-creation-token rate. Domestic CNY routes, Coding Plans and web-search/tool fees excluded."
      },
      "glm-4.5-airx": {
        "input": 1.1,
        "output": 4.5,
        "cachedInput": 0.22,
        "billingMode": "flat",
        "sourceUrl": "https://docs.z.ai/guides/overview/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct ZAI USD/token prices; cached input storage is currently limited-time free, not a separately established cache-creation-token rate. Domestic CNY routes, Coding Plans and web-search/tool fees excluded."
      },
      "glm-4-32b-0414-128k": {
        "input": 0.1,
        "output": 0.1,
        "billingMode": "flat",
        "sourceUrl": "https://docs.z.ai/guides/overview/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct ZAI USD/token prices; cached input storage is currently limited-time free, not a separately established cache-creation-token rate. Domestic CNY routes, Coding Plans and web-search/tool fees excluded."
      },
      "glm-4.7-flash": {
        "input": 0,
        "output": 0,
        "cachedInput": 0,
        "billingMode": "flat",
        "sourceUrl": "https://docs.z.ai/guides/overview/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct ZAI USD/token prices; cached input storage is currently limited-time free, not a separately established cache-creation-token rate. Domestic CNY routes, Coding Plans and web-search/tool fees excluded."
      },
      "glm-4.5-flash": {
        "input": 0,
        "output": 0,
        "cachedInput": 0,
        "billingMode": "flat",
        "sourceUrl": "https://docs.z.ai/guides/overview/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct ZAI USD/token prices; cached input storage is currently limited-time free, not a separately established cache-creation-token rate. Domestic CNY routes, Coding Plans and web-search/tool fees excluded."
      },
      "glm-4.6v": {
        "input": 0.3,
        "output": 0.9,
        "cachedInput": 0.05,
        "billingMode": "flat",
        "sourceUrl": "https://docs.z.ai/guides/overview/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct ZAI USD/token prices; cached input storage is currently limited-time free, not a separately established cache-creation-token rate. Domestic CNY routes, Coding Plans and web-search/tool fees excluded."
      },
      "glm-4.5v": {
        "input": 0.6,
        "output": 1.8,
        "cachedInput": 0.11,
        "billingMode": "flat",
        "sourceUrl": "https://docs.z.ai/guides/overview/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct ZAI USD/token prices; cached input storage is currently limited-time free, not a separately established cache-creation-token rate. Domestic CNY routes, Coding Plans and web-search/tool fees excluded."
      },
      "glm-4.6v-flash": {
        "input": 0,
        "output": 0,
        "cachedInput": 0,
        "billingMode": "flat",
        "sourceUrl": "https://docs.z.ai/guides/overview/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Standard direct ZAI USD/token prices; cached input storage is currently limited-time free, not a separately established cache-creation-token rate. Domestic CNY routes, Coding Plans and web-search/tool fees excluded."
      },
      "glm-ocr": {
        "input": 0.03,
        "output": 0.03,
        "billingMode": "flat",
        "sourceUrl": "https://docs.z.ai/guides/overview/pricing",
        "checkedAt": "2026-10-03",
        "notes": "Official direct token pricing row. Separate Layout Parsing API can charge per page; this token entry cannot price page billing."
      }
    }
  },
  "opencode-zen": {
    "models": {
      "big-pickle": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 0,
        "output": 0,
        "cachedInput": 0
      },
      "space-bunny-free": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 0,
        "output": 0,
        "cachedInput": 0
      },
      "longcat-2.5-preview-free": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 0,
        "output": 0,
        "cachedInput": 0
      },
      "mimo-v2.6-flash-free": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 0,
        "output": 0,
        "cachedInput": 0
      },
      "mimo-v2.5-free": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 0,
        "output": 0,
        "cachedInput": 0
      },
      "ling-3.1-flash-free": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 0,
        "output": 0,
        "cachedInput": 0
      },
      "ling-3.0-flash-fin-free": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 0,
        "output": 0,
        "cachedInput": 0
      },
      "nemotron-3-ultra-free": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 0,
        "output": 0,
        "cachedInput": 0
      },
      "nemotron-3.5-lightning-free": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 0,
        "output": 0,
        "cachedInput": 0
      },
      "muse-spark-1.3-contributor-free": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 0,
        "output": 0,
        "cachedInput": 0
      },
      "jev-1.13-free": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 0,
        "output": 0
      },
      "jev-1.13": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 0.042,
        "output": 0
      },
      "minimax-m3": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 0.3,
        "output": 1.2,
        "cachedInput": 0.06
      },
      "minimax-m2.7": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 0.3,
        "output": 1.2,
        "cachedInput": 0.06
      },
      "minimax-m2.5": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 0.3,
        "output": 1.2,
        "cachedInput": 0.06
      },
      "glm-5.3-flash": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 0.15,
        "output": 0.5,
        "cachedInput": 0.03
      },
      "glm-5.3": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 1.4,
        "output": 4.4,
        "cachedInput": 0.26
      },
      "glm-5.2": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 1.4,
        "output": 4.4,
        "cachedInput": 0.26
      },
      "glm-5.1": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 1.4,
        "output": 4.4,
        "cachedInput": 0.26
      },
      "glm-5": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 1.0,
        "output": 3.2,
        "cachedInput": 0.2
      },
      "kimi-k2.7-code": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 0.95,
        "output": 4.0,
        "cachedInput": 0.19
      },
      "kimi-k3": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 3.0,
        "output": 15.0,
        "cachedInput": 0.3
      },
      "kimi-k2.6": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 0.95,
        "output": 4.0,
        "cachedInput": 0.16
      },
      "kimi-k2.5": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 0.6,
        "output": 3.0,
        "cachedInput": 0.1
      },
      "qwen3.8-max": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 2.0,
        "output": 6.0,
        "cachedInput": 0.25,
        "cacheWrite": 2.5
      },
      "qwen3.8-flash": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 0.15,
        "output": 0.47,
        "cachedInput": 0.016,
        "cacheWrite": 0.2
      },
      "qwen3.7-max": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 2.5,
        "output": 7.5,
        "cachedInput": 0.5,
        "cacheWrite": 3.125
      },
      "qwen3.7-plus": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 0.4,
        "output": 1.6,
        "cachedInput": 0.04,
        "cacheWrite": 0.5
      },
      "qwen3.6-plus": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 0.5,
        "output": 3.0,
        "cachedInput": 0.05,
        "cacheWrite": 0.625
      },
      "qwen3.5-plus": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 0.2,
        "output": 1.2,
        "cachedInput": 0.02,
        "cacheWrite": 0.25
      },
      "deepseek-v4.1-flash": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 0.3,
        "output": 1.2,
        "cachedInput": 0.006
      },
      "deepseek-v4-pro": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 1.74,
        "output": 3.48,
        "cachedInput": 0.145
      },
      "deepseek-v4-flash": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 0.14,
        "output": 0.28,
        "cachedInput": 0.028
      },
      "deepseek-v4-flash-vision-exp": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 0.14,
        "output": 0.28,
        "cachedInput": 0.028
      },
      "claude-fable-5-1": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 10.0,
        "output": 50.0,
        "cachedInput": 0.25,
        "cacheWrite": 12.5
      },
      "claude-fable-5": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 10.0,
        "output": 50.0,
        "cachedInput": 1.0,
        "cacheWrite": 12.5
      },
      "claude-opus-5-5": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 4.0,
        "output": 20.0,
        "cachedInput": 0.2,
        "cacheWrite": 5.0
      },
      "claude-opus-5": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 5.0,
        "output": 25.0,
        "cachedInput": 0.5,
        "cacheWrite": 6.25
      },
      "claude-opus-4-8": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 5.0,
        "output": 25.0,
        "cachedInput": 0.5,
        "cacheWrite": 6.25
      },
      "claude-opus-4-7": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 5.0,
        "output": 25.0,
        "cachedInput": 0.5,
        "cacheWrite": 6.25
      },
      "claude-opus-4-6": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 5.0,
        "output": 25.0,
        "cachedInput": 0.5,
        "cacheWrite": 6.25
      },
      "claude-opus-4-5": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 5.0,
        "output": 25.0,
        "cachedInput": 0.5,
        "cacheWrite": 6.25
      },
      "claude-sonnet-5": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 2.0,
        "output": 10.0,
        "cachedInput": 0.2,
        "cacheWrite": 2.5
      },
      "claude-sonnet-4-6": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 3.0,
        "output": 15.0,
        "cachedInput": 0.3,
        "cacheWrite": 3.75
      },
      "claude-sonnet-4-5": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 3.0,
        "output": 15.0,
        "cachedInput": 0.3,
        "cacheWrite": 3.75,
        "longContext": {
          "aboveInputTokens": 200000,
          "cacheMiss": 6.0,
          "output": 22.5,
          "cacheHit": 0.6,
          "cacheWrite": 7.5
        }
      },
      "claude-haiku-4-5": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 1.0,
        "output": 5.0,
        "cachedInput": 0.1,
        "cacheWrite": 1.25
      },
      "gemini-3.8-flash": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 1.5,
        "output": 7.5,
        "cachedInput": 0.15
      },
      "gemini-3.7-flash": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 1.5,
        "output": 7.5,
        "cachedInput": 0.15
      },
      "gemini-3.6-flash": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 1.5,
        "output": 7.5,
        "cachedInput": 0.15
      },
      "gemini-3.5-flash": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 1.5,
        "output": 9.0,
        "cachedInput": 0.15
      },
      "gemini-3.5-flash-lite": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 0.3,
        "output": 2.5,
        "cachedInput": 0.03
      },
      "gemini-3.1-pro": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 2.0,
        "output": 12.0,
        "cachedInput": 0.2,
        "longContext": {
          "aboveInputTokens": 200000,
          "cacheMiss": 4.0,
          "output": 18.0,
          "cacheHit": 0.4
        }
      },
      "gemini-3-flash": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 0.5,
        "output": 3.0,
        "cachedInput": 0.05
      },
      "grok-4.7": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 2.0,
        "output": 6.0,
        "cachedInput": 0.5,
        "longContext": {
          "aboveInputTokens": 200000,
          "cacheMiss": 4.0,
          "output": 12.0,
          "cacheHit": 1.0
        }
      },
      "grok-4.6": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 2.0,
        "output": 6.0,
        "cachedInput": 0.5,
        "longContext": {
          "aboveInputTokens": 200000,
          "cacheMiss": 4.0,
          "output": 12.0,
          "cacheHit": 1.0
        }
      },
      "grok-4.5": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 2.0,
        "output": 6.0,
        "cachedInput": 0.3,
        "longContext": {
          "aboveInputTokens": 200000,
          "cacheMiss": 4.0,
          "output": 12.0,
          "cacheHit": 0.6
        }
      },
      "grok-build-0.1": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 1.0,
        "output": 2.0,
        "cachedInput": 0.2
      },
      "muse-spark-1.3": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 1.25,
        "output": 4.25,
        "cachedInput": 0.15
      },
      "muse-spark-1.2": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 1.25,
        "output": 4.25,
        "cachedInput": 0.15
      },
      "gpt-6-astra": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 10.0,
        "output": 50.0,
        "cachedInput": 1.0,
        "cacheWrite": 12.5,
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 20.0,
          "output": 75.0,
          "cacheHit": 2.0,
          "cacheWrite": 25.0
        }
      },
      "gpt-6-sol": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 2.0,
        "output": 10.0,
        "cachedInput": 0.2,
        "cacheWrite": 2.5,
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 4.0,
          "output": 15.0,
          "cacheHit": 0.4,
          "cacheWrite": 5.0
        }
      },
      "gpt-6.1-sol": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 2.0,
        "output": 10.0,
        "cachedInput": 0.1,
        "cacheWrite": 2.5,
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 4.0,
          "output": 15.0,
          "cacheHit": 0.2,
          "cacheWrite": 5.0
        }
      },
      "gpt-6-luna": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 0.1,
        "output": 0.5,
        "cachedInput": 0.01,
        "cacheWrite": 0.125,
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 0.2,
          "output": 0.75,
          "cacheHit": 0.02,
          "cacheWrite": 0.25
        }
      },
      "gpt-5.6-sol": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 4.0,
        "output": 20.0,
        "cachedInput": 0.4,
        "cacheWrite": 5.0,
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 8.0,
          "output": 30.0,
          "cacheHit": 0.8,
          "cacheWrite": 10.0
        }
      },
      "gpt-5.6-terra": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 2.0,
        "output": 12.0,
        "cachedInput": 0.2,
        "cacheWrite": 2.5,
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 4.0,
          "output": 18.0,
          "cacheHit": 0.4,
          "cacheWrite": 5.0
        }
      },
      "gpt-5.6-luna": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 0.2,
        "output": 1.2,
        "cachedInput": 0.02,
        "cacheWrite": 0.25,
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 0.4,
          "output": 1.8,
          "cacheHit": 0.04,
          "cacheWrite": 0.5
        }
      },
      "gpt-5.5": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 5.0,
        "output": 30.0,
        "cachedInput": 0.5,
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 10.0,
          "output": 45.0,
          "cacheHit": 1.0
        }
      },
      "gpt-5.5-pro": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 30.0,
        "output": 180.0,
        "cachedInput": 30.0
      },
      "gpt-5.4": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 2.5,
        "output": 15.0,
        "cachedInput": 0.25,
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 5.0,
          "output": 22.5,
          "cacheHit": 0.5
        }
      },
      "gpt-5.4-pro": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 30.0,
        "output": 180.0,
        "cachedInput": 30.0
      },
      "gpt-5.4-mini": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 0.75,
        "output": 4.5,
        "cachedInput": 0.075
      },
      "gpt-5.4-nano": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 0.2,
        "output": 1.25,
        "cachedInput": 0.02
      },
      "gpt-5.3-codex-spark": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 1.75,
        "output": 14.0,
        "cachedInput": 0.175
      },
      "gpt-5.3-codex": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 1.75,
        "output": 14.0,
        "cachedInput": 0.175
      },
      "gpt-5.2": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 1.75,
        "output": 14.0,
        "cachedInput": 0.175
      },
      "gpt-5.2-codex": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 1.75,
        "output": 14.0,
        "cachedInput": 0.175
      },
      "gpt-5.1": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 1.07,
        "output": 8.5,
        "cachedInput": 0.107
      },
      "gpt-5.1-codex": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 1.07,
        "output": 8.5,
        "cachedInput": 0.107
      },
      "gpt-5.1-codex-max": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 1.25,
        "output": 10.0,
        "cachedInput": 0.125
      },
      "gpt-5.1-codex-mini": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 0.25,
        "output": 2.0,
        "cachedInput": 0.025
      },
      "gpt-5": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 1.07,
        "output": 8.5,
        "cachedInput": 0.107
      },
      "gpt-5-codex": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 1.07,
        "output": 8.5,
        "cachedInput": 0.107
      },
      "gpt-5-nano": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/zen",
        "checkedAt": "2026-10-03",
        "input": 0.05,
        "output": 0.4,
        "cachedInput": 0.005
      }
    }
  },
  "opencode-go": {
    "models": {
      "glm-5.3-flash": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/go",
        "checkedAt": "2026-10-03",
        "input": 0.15,
        "output": 0.5,
        "cachedInput": 0.03
      },
      "glm-5.3": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/go",
        "checkedAt": "2026-10-03",
        "input": 1.4,
        "output": 4.4,
        "cachedInput": 0.26
      },
      "glm-5.2": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/go",
        "checkedAt": "2026-10-03",
        "input": 1.4,
        "output": 4.4,
        "cachedInput": 0.26
      },
      "kimi-k3": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/go",
        "checkedAt": "2026-10-03",
        "input": 3.0,
        "output": 15.0,
        "cachedInput": 0.3
      },
      "kimi-k2.7-code": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/go",
        "checkedAt": "2026-10-03",
        "input": 0.95,
        "output": 4.0,
        "cachedInput": 0.19
      },
      "kimi-k2.6": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/go",
        "checkedAt": "2026-10-03",
        "input": 0.95,
        "output": 4.0,
        "cachedInput": 0.16
      },
      "longcat-2.0": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/go",
        "checkedAt": "2026-10-03",
        "input": 0.3,
        "output": 1.2,
        "cachedInput": 0.006
      },
      "longcat-2.5-preview-free": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/go",
        "checkedAt": "2026-10-03",
        "input": 0,
        "output": 0,
        "cachedInput": 0
      },
      "mimo-v2.6-flash": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/go",
        "checkedAt": "2026-10-03",
        "input": 0.14,
        "output": 0.28,
        "cachedInput": 0.0028
      },
      "mimo-v2.6-pro": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/go",
        "checkedAt": "2026-10-03",
        "input": 0.435,
        "output": 0.87,
        "cachedInput": 0.003625
      },
      "mimo-v2.5": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/go",
        "checkedAt": "2026-10-03",
        "input": 0.14,
        "output": 0.28,
        "cachedInput": 0.0028
      },
      "mimo-v2.5-pro": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/go",
        "checkedAt": "2026-10-03",
        "input": 0.435,
        "output": 0.87,
        "cachedInput": 0.003625
      },
      "minimax-m3": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/go",
        "checkedAt": "2026-10-03",
        "input": 0.3,
        "output": 1.2,
        "cachedInput": 0.06
      },
      "minimax-m2.7": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/go",
        "checkedAt": "2026-10-03",
        "input": 0.3,
        "output": 1.2,
        "cachedInput": 0.06,
        "cacheWrite": 0.375
      },
      "muse-spark-1.3-contributor": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/go",
        "checkedAt": "2026-10-03",
        "input": 0.1,
        "output": 0.2,
        "cachedInput": 0.002
      },
      "muse-spark-1.2-contributor": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/go",
        "checkedAt": "2026-10-03",
        "input": 0.1,
        "output": 0.2,
        "cachedInput": 0.002
      },
      "qwen3.8-max": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/go",
        "checkedAt": "2026-10-03",
        "input": 2.0,
        "output": 6.0,
        "cachedInput": 0.25,
        "cacheWrite": 2.5
      },
      "qwen3.8-flash": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/go",
        "checkedAt": "2026-10-03",
        "input": 0.15,
        "output": 0.47,
        "cachedInput": 0.016,
        "cacheWrite": 0.2
      },
      "qwen3.7-plus": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/go",
        "checkedAt": "2026-10-03",
        "input": 0.4,
        "output": 1.6,
        "cachedInput": 0.04,
        "cacheWrite": 0.5,
        "longContext": {
          "aboveInputTokens": 256000,
          "cacheMiss": 1.2,
          "output": 4.8,
          "cacheHit": 0.12,
          "cacheWrite": 1.5
        }
      },
      "deepseek-v4.1-flash": {
        "billingMode": "utc-peak",
        "sourceUrl": "https://opencode.ai/docs/go",
        "checkedAt": "2026-10-03",
        "offPeak": {
          "cacheMiss": 0.15,
          "output": 0.6,
          "cacheHit": 0.003
        },
        "input": 0.15,
        "output": 0.6,
        "cachedInput": 0.003,
        "notes": "Go published reference-token prices; Peak 01:00–04:00 and 06:00–10:00 UTC Monday–Friday; weekends Off-Peak. Separate from direct DeepSeek and flat Zen prices. Historical effective dates and holiday treatment not verified.",
        "peak": {
          "cacheMiss": 0.3,
          "output": 1.2,
          "cacheHit": 0.006
        }
      },
      "deepseek-v4-pro": {
        "billingMode": "utc-peak",
        "sourceUrl": "https://opencode.ai/docs/go",
        "checkedAt": "2026-10-03",
        "offPeak": {
          "cacheMiss": 0.66,
          "output": 1.98,
          "cacheHit": 0.022
        },
        "input": 0.66,
        "output": 1.98,
        "cachedInput": 0.022,
        "notes": "Go published reference-token prices; Peak 01:00–04:00 and 06:00–10:00 UTC Monday–Friday; weekends Off-Peak. Separate from direct DeepSeek and flat Zen prices. Historical effective dates and holiday treatment not verified.",
        "peak": {
          "cacheMiss": 1.32,
          "output": 3.96,
          "cacheHit": 0.044
        }
      },
      "deepseek-v4-flash": {
        "billingMode": "utc-peak",
        "sourceUrl": "https://opencode.ai/docs/go",
        "checkedAt": "2026-10-03",
        "offPeak": {
          "cacheMiss": 0.15,
          "output": 0.6,
          "cacheHit": 0.003
        },
        "input": 0.15,
        "output": 0.6,
        "cachedInput": 0.003,
        "notes": "Go published reference-token prices; Peak 01:00–04:00 and 06:00–10:00 UTC Monday–Friday; weekends Off-Peak. Separate from direct DeepSeek and flat Zen prices. Historical effective dates and holiday treatment not verified.",
        "peak": {
          "cacheMiss": 0.3,
          "output": 1.2,
          "cacheHit": 0.006
        }
      },
      "deepseek-v4-flash-vision-exp": {
        "billingMode": "utc-peak",
        "sourceUrl": "https://opencode.ai/docs/go",
        "checkedAt": "2026-10-03",
        "offPeak": {
          "cacheMiss": 0.15,
          "output": 0.6,
          "cacheHit": 0.003
        },
        "input": 0.15,
        "output": 0.6,
        "cachedInput": 0.003,
        "notes": "Go published reference-token prices; Peak 01:00–04:00 and 06:00–10:00 UTC Monday–Friday; weekends Off-Peak. Separate from direct DeepSeek and flat Zen prices. Historical effective dates and holiday treatment not verified.",
        "peak": {
          "cacheMiss": 0.3,
          "output": 1.2,
          "cacheHit": 0.006
        }
      },
      "hy4-preview": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/go",
        "checkedAt": "2026-10-03",
        "input": 0.834,
        "output": 2.501,
        "cachedInput": 0.042
      },
      "hy3": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/go",
        "checkedAt": "2026-10-03",
        "input": 0.14,
        "output": 0.58,
        "cachedInput": 0.035
      },
      "space-bunny-free": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/go",
        "checkedAt": "2026-10-03",
        "input": 0,
        "output": 0,
        "cachedInput": 0
      },
      "grok-4.7": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/go",
        "checkedAt": "2026-10-03",
        "input": 2.0,
        "output": 6.0,
        "cachedInput": 0.5,
        "longContext": {
          "aboveInputTokens": 200000,
          "cacheMiss": 4.0,
          "output": 12.0,
          "cacheHit": 1.0
        }
      },
      "grok-4.6": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/go",
        "checkedAt": "2026-10-03",
        "input": 2.0,
        "output": 6.0,
        "cachedInput": 0.5,
        "longContext": {
          "aboveInputTokens": 200000,
          "cacheMiss": 4.0,
          "output": 12.0,
          "cacheHit": 1.0
        }
      },
      "gpt-6-luna": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/go",
        "checkedAt": "2026-10-03",
        "input": 0.1,
        "output": 0.5,
        "cachedInput": 0.01,
        "cacheWrite": 0.125,
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 0.2,
          "output": 0.75,
          "cacheHit": 0.02,
          "cacheWrite": 0.25
        }
      },
      "gpt-5.6-luna": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/docs/go",
        "checkedAt": "2026-10-03",
        "input": 0.2,
        "output": 1.2,
        "cachedInput": 0.02,
        "cacheWrite": 0.25,
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 0.4,
          "output": 1.8,
          "cacheHit": 0.04,
          "cacheWrite": 0.5
        }
      }
    }
  }
}

// Keep the previous snapshot as the migration baseline, including intentionally unmounted IDs.
export const VERIFIED_PROVIDER_PRICES = Object.fromEntries(
  [...new Set([...Object.keys(PROVIDER_PRICES_2026_10_03), ...Object.keys(PROVIDER_PRICE_UPDATES)])]
    .map(provider => [provider, { models: { ...PROVIDER_PRICES_2026_10_03[provider]?.models, ...PROVIDER_PRICE_UPDATES[provider]?.models } }]),
)
VERIFIED_PROVIDER_PRICES.stepfun = STEPFUN_PRICES

export const PROVIDER_PRICES_BEFORE_2026_10_28 = structuredClone(VERIFIED_PROVIDER_PRICES)
for (const [provider, table] of Object.entries(PROVIDER_PRICE_UPDATES_2026_10_28)) {
  VERIFIED_PROVIDER_PRICES[provider] = { models: { ...VERIFIED_PROVIDER_PRICES[provider]?.models, ...table.models } }
}

export const PROVIDER_PRICES_BEFORE_2026_11_05 = structuredClone(VERIFIED_PROVIDER_PRICES)
for (const [provider, table] of Object.entries(PROVIDER_PRICE_UPDATES_2026_11_05)) {
  VERIFIED_PROVIDER_PRICES[provider] = { models: { ...VERIFIED_PROVIDER_PRICES[provider]?.models, ...table.models } }
}
