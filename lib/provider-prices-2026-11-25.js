// Published provider-specific rates checked on 2026-11-25. Per million tokens unless marked unpriced.
export const NOVEMBER_PROVIDER_PRICES = {
  "anthropic": {
    "models": {
      "claude-fable-5-2": {
        "input": 8,
        "output": 40,
        "cachedInput": 0.2,
        "cacheWrite": 10,
        "billingMode": "flat",
        "sourceUrl": "https://platform.claude.com/docs/en/models/fable-5-2/whats-new-fable-5-2",
        "checkedAt": "2026-11-25",
        "notes": "Standard; 5-minute cache writes. The separately priced 1-hour write costs $16/MTok."
      },
      "claude-mythos-5-2": {
        "input": 8,
        "output": 40,
        "cachedInput": 0.2,
        "cacheWrite": 10,
        "billingMode": "flat",
        "sourceUrl": "https://platform.claude.com/docs/en/models/fable-5-2/whats-new-fable-5-2",
        "checkedAt": "2026-11-25",
        "notes": "Standard; 5-minute cache writes. The separately priced 1-hour write costs $16/MTok."
      }
    }
  },
  "google": {
    "models": {
      "gemini-4-neon": {
        "input": 3,
        "output": 15,
        "cachedInput": 0.15,
        "billingMode": "flat",
        "sourceUrl": "https://ai.google.dev/gemini-api/docs/pricing#gemini-4-neon",
        "checkedAt": "2026-11-25",
        "notes": "Paid Standard. Implicit cache reads; output includes thinking."
      },
      "gemini-4-hydrogen": {
        "input": 1.5,
        "output": 7.5,
        "cachedInput": 0.075,
        "billingMode": "flat",
        "sourceUrl": "https://ai.google.dev/gemini-api/docs/pricing#gemini-4-hydrogen",
        "checkedAt": "2026-11-25",
        "notes": "Paid Standard. Implicit cache reads; output includes thinking."
      },
      "gemini-4-carbon": {
        "input": 4,
        "output": 20,
        "cachedInput": 0.2,
        "billingMode": "flat",
        "sourceUrl": "https://ai.google.dev/gemini-api/docs/pricing#gemini-4-carbon",
        "checkedAt": "2026-11-25",
        "rateHistory": [
          {
            "before": "2026-12-01T00:00:00Z",
            "cacheMiss": 2,
            "cacheHit": 0.1,
            "output": 10
          }
        ],
        "notes": "Paid Standard. Introductory rates through 2026-11-30; date-only cutover interpreted as UTC."
      },
      "gemini-omni-1.2-flash": {
        "billingMode": "flat",
        "sourceUrl": "https://ai.google.dev/gemini-api/docs/pricing#gemini-omni-1.2-flash",
        "checkedAt": "2026-11-25",
        "unpriced": true,
        "notes": "USD/MTok: input 1.50, text output 9, video output 12. Requires separate text/video output counts."
      },
      "gemini-decision-1": {
        "input": 0.1,
        "output": 0,
        "billingMode": "flat",
        "sourceUrl": "https://ai.google.dev/gemini-api/docs/pricing#gemini-decision",
        "checkedAt": "2026-11-25",
        "notes": "Paid Decisions API, input tokens only. No output tokens or context caching."
      },
      "genie-4": {
        "billingMode": "flat",
        "sourceUrl": "https://ai.google.dev/gemini-api/docs/pricing#genie-4",
        "checkedAt": "2026-11-25",
        "unpriced": true,
        "notes": "USD/MTok: input 1.50, text output 9, video with audio 17.50. Separate output modality counts are required."
      }
    }
  },
  "openai": {
    "models": {
      "gpt-6.2-astra-law": {
        "input": 8,
        "output": 40,
        "cachedInput": 0.4,
        "cacheWrite": 10.0,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-11-25",
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 16,
          "cacheHit": 0.8,
          "output": 60.0,
          "cacheWrite": 20.0
        },
        "notes": "Specialized configuration, published Standard short/long rates. 30-minute cache writes."
      },
      "gpt-6.2-astra-healthcare": {
        "input": 8,
        "output": 40,
        "cachedInput": 0.4,
        "cacheWrite": 10.0,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-11-25",
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 16,
          "cacheHit": 0.8,
          "output": 60.0,
          "cacheWrite": 20.0
        },
        "notes": "Specialized configuration, published Standard short/long rates. 30-minute cache writes."
      },
      "gpt-6.2-sol-healthcare": {
        "input": 2,
        "output": 10,
        "cachedInput": 0.1,
        "cacheWrite": 2.5,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-11-25",
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 4,
          "cacheHit": 0.2,
          "output": 15.0,
          "cacheWrite": 5.0
        },
        "notes": "Specialized configuration, published Standard short/long rates. 30-minute cache writes."
      },
      "gpt-6-cyber": {
        "input": 20,
        "output": 100,
        "cachedInput": 2,
        "cacheWrite": 25,
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/models/gpt-6-cyber",
        "checkedAt": "2026-11-25",
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 40,
          "cacheHit": 4,
          "output": 150
        },
        "notes": "Standard for eligible accounts. Short-context cache writes: $25/MTok for 30m. Long-context cache writes are not offered on the pricing table."
      },
      "gpt-live-1.1": {
        "billingMode": "flat",
        "sourceUrl": "https://developers.openai.com/api/docs/pricing",
        "checkedAt": "2026-11-25",
        "unpriced": true,
        "notes": "Live API charges per minute ($0.05 active, $0.02 standby); aggregate token counts do not contain session durations."
      }
    }
  },
  "alibaba": {
    "models": {
      "qwen4-max": {
        "input": 1.5,
        "output": 4.5,
        "cachedInput": 0.075,
        "cacheWrite": 1.875,
        "billingMode": "flat",
        "sourceUrl": "https://www.alibabacloud.com/help/en/model-studio/qwen4-max",
        "checkedAt": "2026-11-25",
        "cny": {
          "cacheMiss": 10,
          "cacheHit": 0.5,
          "output": 30,
          "cacheWrite": 12.5
        },
        "notes": "Singapore International USD and mainland China CNY. Cache writes use the 5m tier. 1h writes cost $3 or ¥20/MTok."
      },
      "qwen4-max-preview": {
        "billingMode": "flat",
        "sourceUrl": "https://www.alibabacloud.com/help/en/model-studio/qwen4-max-preview",
        "checkedAt": "2026-11-25",
        "unpriced": true,
        "notes": "Token Plan preview through November 25. No pay-as-you-go token rate."
      }
    }
  },
  "z-ai": {
    "models": {
      "glm-5.3-flashx-legal": {
        "input": 0.37,
        "output": 1.25,
        "cachedInput": 0.075,
        "billingMode": "flat",
        "sourceUrl": "https://docs.z.ai/guides/overview/pricing",
        "checkedAt": "2026-11-25",
        "cny": {
          "cacheMiss": 2,
          "cacheHit": 0.57,
          "output": 7
        },
        "notes": "Z.ai international USD; mainland CNY prices: https://docs.bigmodel.cn/cn/guide/start/pricing . Cache storage is a separate hourly unit."
      },
      "glm-5.4": {
        "billingMode": "flat",
        "sourceUrl": "https://zcode.z.ai/en/changelog",
        "checkedAt": "2026-11-25",
        "unpriced": true,
        "notes": "Available in GLM Coding Plan. No public direct API token quote on November 25."
      }
    }
  },
  "tencent": {
    "models": {
      "hy4": {
        "input": 0.834,
        "output": 2.501,
        "cachedInput": 0.042,
        "billingMode": "flat",
        "sourceUrl": "https://www.tencentcloud.com/document/product/1300/78937",
        "checkedAt": "2026-11-25",
        "cny": {
          "cacheMiss": 6,
          "cacheHit": 0.3,
          "output": 18,
          "rateHistory": [
            {
              "before": "2027-01-01T00:00:00+08:00",
              "cacheMiss": 3.0,
              "cacheHit": 0.15,
              "output": 9.0
            }
          ]
        },
        "notes": "Launch discount is 50% of USD and mainland CNY list prices until the dated cutover. Mainland source: https://cloud.tencent.com/document/product/1823/130055",
        "rateHistory": [
          {
            "before": "2027-01-01T00:00:00+08:00",
            "cacheMiss": 0.417,
            "cacheHit": 0.021,
            "output": 1.2505
          }
        ]
      },
      "hy4-flash": {
        "input": 0.07,
        "output": 0.281,
        "cachedInput": 0.003,
        "billingMode": "flat",
        "sourceUrl": "https://www.tencentcloud.com/document/product/1300/78937",
        "checkedAt": "2026-11-25",
        "rateHistory": [
          {
            "before": "2026-11-30T12:00:00+08:00",
            "cacheMiss": 0.035,
            "cacheHit": 0.0015,
            "output": 0.1405
          }
        ],
        "notes": "Launch discount is 50% of USD and mainland CNY list prices until the dated cutover. Mainland source: https://cloud.tencent.com/document/product/1823/130055",
        "cny": {
          "cacheMiss": 0.5,
          "cacheHit": 0.02,
          "output": 2,
          "rateHistory": [
            {
              "before": "2026-11-30T12:00:00+08:00",
              "cacheMiss": 0.25,
              "cacheHit": 0.01,
              "output": 1.0
            }
          ]
        }
      }
    }
  },
  "meta": {
    "models": {
      "muse-ember-1.0": {
        "input": 0.1,
        "output": 0.5,
        "cachedInput": 0.004,
        "billingMode": "flat",
        "sourceUrl": "https://dev.meta.ai/docs/pricing-rate-limits",
        "checkedAt": "2026-11-25",
        "longContext": {
          "aboveInputTokens": 200000,
          "cacheMiss": 0.3,
          "cacheHit": 0.012,
          "output": 1.5
        }
      }
    }
  },
  "upstage": {
    "models": {
      "solar-mini-4-5-preview": {
        "input": 0.01,
        "output": 0.04,
        "cachedInput": 0.001,
        "billingMode": "flat",
        "sourceUrl": "https://console.upstage.ai/ko/docs/models/compare/generative-intelligence",
        "checkedAt": "2026-11-25"
      }
    }
  },
  "thinkingmachines": {
    "models": {
      "thinkingmachines/Inkling-2-Mini": {
        "input": 0.15,
        "output": 0.5,
        "cachedInput": 0.015,
        "billingMode": "flat",
        "sourceUrl": "https://tinker-docs.thinkingmachines.ai/tinker/models/models_and_pricing/",
        "checkedAt": "2026-11-25",
        "notes": "Tinker prefill and sample prices; training and checkpoint charges are separate."
      },
      "thinkingmachines/Inkling-2-Mini:peft:262144": {
        "input": 0.15,
        "output": 0.5,
        "cachedInput": 0.015,
        "billingMode": "flat",
        "sourceUrl": "https://tinker-docs.thinkingmachines.ai/tinker/models/models_and_pricing/",
        "checkedAt": "2026-11-25",
        "notes": "Tinker prefill and sample prices; training and checkpoint charges are separate."
      },
      "thinkingmachines/Inkling-2-Small": {
        "input": 0.3,
        "output": 1.0,
        "cachedInput": 0.03,
        "billingMode": "flat",
        "sourceUrl": "https://tinker-docs.thinkingmachines.ai/tinker/models/models_and_pricing/",
        "checkedAt": "2026-11-25",
        "notes": "Tinker prefill and sample prices; training and checkpoint charges are separate."
      },
      "thinkingmachines/Inkling-2-Small:peft:262144": {
        "input": 0.3,
        "output": 1.0,
        "cachedInput": 0.03,
        "billingMode": "flat",
        "sourceUrl": "https://tinker-docs.thinkingmachines.ai/tinker/models/models_and_pricing/",
        "checkedAt": "2026-11-25",
        "notes": "Tinker prefill and sample prices; training and checkpoint charges are separate."
      }
    }
  },
  "baidu": {
    "models": {
      "ernie-light-dt-1.0": {
        "input": 8,
        "output": 28,
        "cachedInput": 0.8,
        "billingMode": "flat",
        "sourceUrl": "https://cloud.baidu.com/product/qianfan_home/model_3.html",
        "checkedAt": "2026-11-25",
        "currency": "CNY"
      },
      "ernie-5.5-flash-preview": {
        "input": 2,
        "output": 8,
        "cachedInput": 0.2,
        "billingMode": "deepseek-peak",
        "sourceUrl": "https://cloud.baidu.com/product/qianfan_home/model_3.html",
        "checkedAt": "2026-11-25",
        "currency": "CNY",
        "peakSchedule": "daily",
        "peakWindows": [
          {
            "start": 0,
            "end": 14
          }
        ],
        "peak": {
          "cacheMiss": 2,
          "cacheHit": 0.2,
          "output": 8
        },
        "offPeak": {
          "cacheMiss": 1,
          "cacheHit": 0.1,
          "output": 4
        },
        "rateHistory": [
          {
            "before": "2026-12-01T00:00:00+08:00",
            "cacheMiss": 1,
            "cacheHit": 0.1,
            "output": 4,
            "peak": {
              "cacheMiss": 1,
              "cacheHit": 0.1,
              "output": 4
            },
            "offPeak": {
              "cacheMiss": 0.5,
              "cacheHit": 0.05,
              "output": 2
            }
          }
        ],
        "notes": "Native CNY list price. Peak 08:00–22:00 Beijing time daily. Introductory 50% discount ends November 30 at 23:59:59 Beijing time."
      },
      "ernie-wizshot-me": {
        "billingMode": "flat",
        "sourceUrl": "https://cloud.baidu.com/product/qianfan_home/model_3.html",
        "checkedAt": "2026-11-25",
        "unpriced": true,
        "notes": "CNY 0.7 per generated second. The DSH usage event does not include generated video duration."
      }
    }
  },
  "opencode-zen": {
    "models": {
      "tidepool-alpha-free": {
        "input": 0,
        "output": 0,
        "cachedInput": 0,
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/zen/v1/models",
        "checkedAt": "2026-11-25"
      },
      "iceman-free": {
        "input": 0,
        "output": 0,
        "cachedInput": 0,
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/zen/v1/models",
        "checkedAt": "2026-11-25"
      },
      "hy4-flash-free": {
        "input": 0,
        "output": 0,
        "cachedInput": 0,
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/zen/v1/models",
        "checkedAt": "2026-11-25"
      },
      "jev-1.14": {
        "input": 0.042,
        "output": 0,
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/zen/v1/models",
        "checkedAt": "2026-11-25"
      },
      "gemini-decision-1": {
        "input": 0.1,
        "output": 0,
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/zen/v1/models",
        "checkedAt": "2026-11-25"
      },
      "gpt-6-luna-decision": {
        "input": 0.1,
        "output": 0,
        "cachedInput": 0.01,
        "cacheWrite": 0.125,
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/zen/v1/models",
        "checkedAt": "2026-11-25",
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 0.2,
          "cacheHit": 0.02,
          "output": 0,
          "cacheWrite": 0.25
        },
        "notes": "Default cache-write price uses the shortest published TTL. Gateway TTL rates (USD/MTok): 30m = 0.125, 12h = 0.25."
      },
      "kimi-k3.1-pro": {
        "input": 2,
        "output": 10,
        "cachedInput": 0.2,
        "cacheWrite": 2,
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/zen/v1/models",
        "checkedAt": "2026-11-25"
      },
      "claude-fable-5-2": {
        "input": 8,
        "output": 40,
        "cachedInput": 0.2,
        "cacheWrite": 10,
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/zen/v1/models",
        "checkedAt": "2026-11-25"
      },
      "gemini-4-neon": {
        "input": 3,
        "output": 15,
        "cachedInput": 0.15,
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/zen/v1/models",
        "checkedAt": "2026-11-25"
      },
      "gemini-4-carbon": {
        "input": 4,
        "output": 20,
        "cachedInput": 0.2,
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/zen/v1/models",
        "checkedAt": "2026-11-25",
        "rateHistory": [
          {
            "before": "2026-12-01T00:00:00Z",
            "cacheMiss": 2,
            "cacheHit": 0.1,
            "output": 10
          }
        ],
        "notes": "OpenCode applies a 2x date multiplier from 2026-12-01. Date-only cutover interpreted as UTC."
      },
      "gemini-4-hydrogen": {
        "input": 1.5,
        "output": 7.5,
        "cachedInput": 0.075,
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/zen/v1/models",
        "checkedAt": "2026-11-25"
      },
      "muse-ember-1.0": {
        "input": 0.1,
        "output": 0.5,
        "cachedInput": 0.004,
        "cacheWrite": 0,
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/zen/v1/models",
        "checkedAt": "2026-11-25",
        "longContext": {
          "aboveInputTokens": 200000,
          "cacheMiss": 0.3,
          "cacheHit": 0.012,
          "output": 1.5,
          "cacheWrite": 0
        }
      },
      "gpt-6.2-astra": {
        "input": 8,
        "output": 40,
        "cachedInput": 0.4,
        "cacheWrite": 10,
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/zen/v1/models",
        "checkedAt": "2026-11-25",
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 16,
          "cacheHit": 0.8,
          "output": 60,
          "cacheWrite": 20
        },
        "notes": "Default cache-write price uses the shortest published TTL. Gateway TTL rates (USD/MTok): 30m = 10, 12h = 20."
      },
      "gpt-6.2-sol": {
        "input": 2,
        "output": 10,
        "cachedInput": 0.1,
        "cacheWrite": 2.5,
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/zen/v1/models",
        "checkedAt": "2026-11-25",
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 4,
          "cacheHit": 0.2,
          "output": 15,
          "cacheWrite": 5
        },
        "notes": "Default cache-write price uses the shortest published TTL. Gateway TTL rates (USD/MTok): 30m = 2.5, 12h = 5."
      },
      "gemini-omni-1.2-flash": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/zen/v1/models",
        "checkedAt": "2026-11-25",
        "unpriced": true,
        "notes": "This route needs separate output modality counts or duration. A single output token rate would misstate the price."
      },
      "gpt-live-1.1": {
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/zen/v1/models",
        "checkedAt": "2026-11-25",
        "unpriced": true,
        "notes": "This route needs separate output modality counts or duration. A single output token rate would misstate the price."
      }
    }
  },
  "opencode-go": {
    "models": {
      "jev-1.14": {
        "input": 0.042,
        "output": 0,
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/zen/go/v1/models",
        "checkedAt": "2026-11-25"
      },
      "gemini-decision-1": {
        "input": 0.1,
        "output": 0,
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/zen/go/v1/models",
        "checkedAt": "2026-11-25"
      },
      "gpt-6-luna-decision": {
        "input": 0.1,
        "output": 0,
        "cachedInput": 0.01,
        "cacheWrite": 0.125,
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/zen/go/v1/models",
        "checkedAt": "2026-11-25",
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 0.2,
          "cacheHit": 0.02,
          "output": 0,
          "cacheWrite": 0.25
        },
        "notes": "Default cache-write price uses the shortest published TTL. Gateway TTL rates (USD/MTok): 30m = 0.125, 12h = 0.25."
      },
      "hungerg-free": {
        "input": 0,
        "output": 0,
        "cachedInput": 0,
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/zen/go/v1/models",
        "checkedAt": "2026-11-25",
        "notes": "Limited-time free route."
      },
      "hy4-flash-free": {
        "input": 0,
        "output": 0,
        "cachedInput": 0,
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/zen/go/v1/models",
        "checkedAt": "2026-11-25",
        "notes": "Limited-time free route."
      },
      "hy4": {
        "input": 0.834,
        "output": 2.501,
        "cachedInput": 0.042,
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/zen/go/v1/models",
        "checkedAt": "2026-11-25"
      },
      "qwen4-max": {
        "input": 1.5,
        "output": 4.5,
        "cachedInput": 0.075,
        "cacheWrite": 1.875,
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/zen/go/v1/models",
        "checkedAt": "2026-11-25",
        "notes": "Default cache-write price uses the shortest published TTL. Gateway TTL rates (USD/MTok): 5m = 1.875, 1h = 3."
      },
      "longcat-2.5": {
        "input": 0.3,
        "output": 1.2,
        "cachedInput": 0.006,
        "cacheWrite": 0,
        "billingMode": "flat",
        "sourceUrl": "https://opencode.ai/zen/go/v1/models",
        "checkedAt": "2026-11-25"
      }
    }
  },
  "openrouter": {
    "models": {
      "anthropic/claude-fable-5.2": {
        "input": 8.0,
        "output": 40.0,
        "cachedInput": 0.2,
        "cacheWrite": 10.0,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25"
      },
      "anthropic/claude-fable-5.2:batch": {
        "input": 4.0,
        "output": 20.0,
        "cachedInput": 0.1,
        "cacheWrite": 5.0,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25"
      },
      "baidu/ernie-5.5-flash-preview:free": {
        "input": 0.0,
        "output": 0.0,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25"
      },
      "baidu/ernie-light-dt-1.0-intl": {
        "input": 1.13,
        "output": 3.94,
        "cachedInput": 0.113,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25"
      },
      "google/gemini-4-carbon": {
        "input": 2.0,
        "output": 10.0,
        "cachedInput": 0.1,
        "cacheWrite": 0.1875,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25"
      },
      "google/gemini-4-carbon:batch": {
        "input": 1.0,
        "output": 5.0,
        "cachedInput": 0.05,
        "cacheWrite": 0.1875,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25"
      },
      "google/gemini-4-hydrogen": {
        "input": 1.5,
        "output": 7.5,
        "cachedInput": 0.075,
        "cacheWrite": 0.0833333333333333,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25"
      },
      "google/gemini-4-hydrogen:batch": {
        "input": 0.75,
        "output": 3.75,
        "cachedInput": 0.0375,
        "cacheWrite": 0.0833333333333333,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25"
      },
      "google/gemini-4-neon": {
        "input": 3.0,
        "output": 15.0,
        "cachedInput": 0.15,
        "cacheWrite": 0.0833333333333333,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25"
      },
      "google/gemini-4-neon:batch": {
        "input": 1.5,
        "output": 7.5,
        "cachedInput": 0.075,
        "cacheWrite": 0.0833333333333333,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25"
      },
      "google/gemini-omni-1.1-flash": {
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25",
        "unpriced": true,
        "notes": "Mixed text/video output; the OpenRouter base token quote cannot price the combined output count."
      },
      "google/gemini-omni-1.2-flash": {
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25",
        "unpriced": true,
        "notes": "Mixed text/video output; the OpenRouter base token quote cannot price the combined output count."
      },
      "inclusionai/ling-3.2-flash:free": {
        "input": 0.0,
        "output": 0.0,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25"
      },
      "kt/midm-k-3.0-pro": {
        "input": 0.2,
        "output": 0.8,
        "cachedInput": 0.04,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25"
      },
      "liquid/lfm-3-1.7b": {
        "input": 0.08,
        "output": 0.2,
        "cachedInput": 0.02,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25"
      },
      "liquid/lfm-3-1.7b:free": {
        "input": 0.0,
        "output": 0.0,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25"
      },
      "meta/muse-ember": {
        "input": 0.1,
        "output": 0.5,
        "cachedInput": 0.004,
        "cacheWrite": 0.125,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25"
      },
      "mistralai/pixtral-large-2502": {
        "input": 2.0,
        "output": 6.0,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25"
      },
      "motif-technologies/motif-3": {
        "input": 0.3,
        "output": 1.2,
        "cachedInput": 0.06,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25"
      },
      "nex-agi/nex-n2.6": {
        "input": 0.12,
        "output": 0.4,
        "cachedInput": 0.024,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25"
      },
      "openai/gpt-6.2-astra": {
        "input": 8.0,
        "output": 40.0,
        "cachedInput": 0.4,
        "cacheWrite": 10.0,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25",
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 16.0,
          "cacheHit": 0.8,
          "output": 60.0,
          "cacheWrite": 20.0
        }
      },
      "openai/gpt-6.2-astra-pro": {
        "input": 8.0,
        "output": 40.0,
        "cachedInput": 0.4,
        "cacheWrite": 10.0,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25",
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 16.0,
          "cacheHit": 0.8,
          "output": 60.0,
          "cacheWrite": 20.0
        }
      },
      "openai/gpt-6.2-astra-pro:batch": {
        "input": 4.0,
        "output": 20.0,
        "cachedInput": 0.2,
        "cacheWrite": 5.0,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25",
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 8.0,
          "cacheHit": 0.4,
          "output": 30.0,
          "cacheWrite": 10.0
        }
      },
      "openai/gpt-6.2-astra:batch": {
        "input": 4.0,
        "output": 20.0,
        "cachedInput": 0.2,
        "cacheWrite": 5.0,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25",
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 8.0,
          "cacheHit": 0.4,
          "output": 30.0,
          "cacheWrite": 10.0
        }
      },
      "openai/gpt-6.2-sol": {
        "input": 2.0,
        "output": 10.0,
        "cachedInput": 0.1,
        "cacheWrite": 2.5,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25",
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 4.0,
          "cacheHit": 0.2,
          "output": 15.0,
          "cacheWrite": 5.0
        }
      },
      "openai/gpt-6.2-sol-pro": {
        "input": 2.0,
        "output": 10.0,
        "cachedInput": 0.1,
        "cacheWrite": 2.5,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25",
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 4.0,
          "cacheHit": 0.2,
          "output": 15.0,
          "cacheWrite": 5.0
        }
      },
      "openai/gpt-6.2-sol-pro:batch": {
        "input": 1.0,
        "output": 5.0,
        "cachedInput": 0.05,
        "cacheWrite": 1.25,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25",
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 2.0,
          "cacheHit": 0.1,
          "output": 7.5,
          "cacheWrite": 2.5
        }
      },
      "openai/gpt-6.2-sol:batch": {
        "input": 1.0,
        "output": 5.0,
        "cachedInput": 0.05,
        "cacheWrite": 1.25,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25",
        "longContext": {
          "aboveInputTokens": 272000,
          "cacheMiss": 2.0,
          "cacheHit": 0.1,
          "output": 7.5,
          "cacheWrite": 2.5
        }
      },
      "qwen/qwen4-max": {
        "input": 1.425,
        "output": 4.275,
        "cachedInput": 0.07125,
        "cacheWrite": 1.78125,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25"
      },
      "radixark/daisyrose-27b": {
        "input": 0.15,
        "output": 1.875,
        "cachedInput": 0.0375,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25"
      },
      "ricursiveai/ripple-65b-preview": {
        "input": 0.1,
        "output": 0.3,
        "cachedInput": 0.025,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25"
      },
      "tencent/hy4": {
        "input": 0.417,
        "output": 1.2505,
        "cachedInput": 0.021,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25"
      },
      "tencent/hy4-flash": {
        "input": 0.035,
        "output": 0.1405,
        "cachedInput": 0.0015,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25"
      },
      "thinkingmachines/inkling-2-mini": {
        "input": 0.075,
        "output": 0.3,
        "cachedInput": 0.015,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25"
      },
      "thinkingmachines/inkling-2-small": {
        "input": 0.3,
        "output": 1.0,
        "cachedInput": 0.03,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25"
      },
      "upstage/solar-mini-4-5": {
        "input": 0.01,
        "output": 0.04,
        "cachedInput": 0.001,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25"
      },
      "upstage/solar-pro-4-contributor": {
        "input": 0.09,
        "output": 0.36,
        "cachedInput": 0.018,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25"
      },
      "xiaomi/mimo-v2.6-flash-mopd": {
        "input": 0.15,
        "output": 0.42,
        "cachedInput": 0.02,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25"
      },
      "z-ai/glm-5.3-flashx-legal": {
        "input": 0.37,
        "output": 1.25,
        "cachedInput": 0.075,
        "billingMode": "flat",
        "sourceUrl": "https://openrouter.ai/api/v1/models",
        "checkedAt": "2026-11-25"
      }
    }
  },
  "meituan": {
    "models": {
      "LongCat-2.5": {
        "input": 0.3,
        "output": 1.2,
        "cachedInput": 0.006,
        "billingMode": "flat",
        "sourceUrl": "https://longcat.ai/platform/docs/pricing/longcat-2.5",
        "checkedAt": "2026-11-25",
        "cny": {
          "cacheMiss": 2,
          "cacheHit": 0.04,
          "output": 8
        },
        "notes": "Published launch discount. The provider has not announced an end date."
      }
    }
  }
}
