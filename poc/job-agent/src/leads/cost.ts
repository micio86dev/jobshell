/**
 * What a run costs, measured, never guessed.
 *
 * Tokens and searches are counted from what the providers report. A dollar figure is given only
 * for a model whose price is known here; for any other it is null and says so, because a made-up
 * price is worse than none. Jev's price per token is not published to this app: its tokens are
 * counted and no dollar figure is invented for them.
 */

/** US dollars per million tokens, from the Anthropic model overview (read 2026-11-24). */
export const MODEL_PRICES: Readonly<Record<string, { input: number; output: number }>> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-fable-5-2': { input: 8, output: 40 },
};

/** Anthropic web search: US$10 per 1,000 searches, on top of tokens (documentation, read 2026-11-24). */
export const SEARCH_USD = 0.01;

export type CostSummary = {
  jev_input_tokens: number;
  llm_input_tokens: number;
  llm_output_tokens: number;
  web_searches: number;
  /** Null when the model's price is not known, or when nothing billable ran. */
  llm_usd: number | null;
  search_usd: number;
  /** The sum of the dollar figures that are known. */
  usd_known: number;
  /** True when some of the spend has no known price (Jev, or an unlisted model). */
  includes_unpriced: boolean;
};

export class CostMeter {
  private jevInput = 0;
  private llmInput = 0;
  private llmOutput = 0;
  private searches = 0;
  private unpricedModel = false;
  private usd = 0;
  private readonly model: string;

  constructor(model: string) {
    this.model = model;
  }

  jev(tokens: number): void {
    this.jevInput += tokens;
  }

  llm(usage: { input_tokens: number; output_tokens: number }, searches = 0): void {
    this.llmInput += usage.input_tokens;
    this.llmOutput += usage.output_tokens;
    this.searches += searches;
    const price = MODEL_PRICES[this.model];
    if (price === undefined) this.unpricedModel = true;
    else this.usd += (usage.input_tokens * price.input + usage.output_tokens * price.output) / 1_000_000;
  }

  /** The dollars spent so far that have a known price, for a budget check between steps. */
  spent(): number {
    return this.usd + this.searches * SEARCH_USD;
  }

  summary(): CostSummary {
    const llmUsd = this.llmInput + this.llmOutput === 0 ? null : this.unpricedModel ? null : this.usd;
    return {
      jev_input_tokens: this.jevInput,
      llm_input_tokens: this.llmInput,
      llm_output_tokens: this.llmOutput,
      web_searches: this.searches,
      llm_usd: llmUsd === null ? null : Math.round(llmUsd * 10000) / 10000,
      search_usd: Math.round(this.searches * SEARCH_USD * 10000) / 10000,
      usd_known: Math.round(this.spent() * 10000) / 10000,
      includes_unpriced: this.jevInput > 0 || this.unpricedModel,
    };
  }
}
