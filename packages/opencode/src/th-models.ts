// Canonical Token Harbor model catalog for the picker + the in-session
// cost/context gauge. `cost` is USD per 1M tokens, matching the platform's
// per-token prices (gateway_models.price_in/out_usd_per_1m, markup 0), so
// the "$ spent" the TUI computes (tokens × cost) lines up with the
// platform's billing. `limit.context` drives the "% used" gauge.
//
// th-orchestra is a META model: it routes each turn to a different
// underlying model, so its DB price is 0 and no single local cost is
// exact. We set a representative blend so the gauge isn't a misleading
// $0.00 — the authoritative per-turn cost is the platform /usage page.
//
// Keep in sync with the gateway. Used by both config.ts (seed) and
// provider.ts (runtime injection over existing configs).
export type ThModel = {
  name: string
  cost: { input: number; output: number }
  limit: { context: number }
}

export const TH_MODELS: Record<string, ThModel> = {
  "th-orchestra": { name: "TH Orchestra", cost: { input: 1.2, output: 4.5 }, limit: { context: 262144 } },
  "qwen3.7-max": { name: "Qwen3.7 Max", cost: { input: 1.6, output: 8.0 }, limit: { context: 262144 } },
  "glm-5.1": { name: "GLM-5.1", cost: { input: 1.4, output: 4.4 }, limit: { context: 131072 } },
  "deepseek-v4-pro": { name: "DeepSeek V4 Pro", cost: { input: 0.435, output: 0.87 }, limit: { context: 131072 } },
  "kimi-k2.5": { name: "Kimi K2.5", cost: { input: 0.95, output: 4.0 }, limit: { context: 262144 } },
  "deepseek-v4-flash": { name: "DeepSeek V4 Flash", cost: { input: 0.14, output: 0.28 }, limit: { context: 1048576 } },
}
