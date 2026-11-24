import { describe, expect, it } from 'vitest';
import { chooseApi, chooseProvider, CLI_NAMES, CLI_PROVIDERS, isCliProvider, modelAfterSwitch, modelOptions, validateChoice, type ProviderChoiceView } from './provider-settings';

const choice = (overrides: Partial<ProviderChoiceView>): ProviderChoiceView => ({
  llm_provider: 'anthropic',
  llm_model: 'claude-sonnet-5-5',
  judgment_service: 'typesafe',
  judgment_model: 'jev-1.14.0',
  judgment_address: '',
  match_threshold: 70,
  ...overrides,
});

describe('validateChoice', () => {
  it('accepts the default choice', () => {
    expect(validateChoice(choice({}))).toBeNull();
  });

  it('refuses a model left empty, naming the provider', () => {
    expect(validateChoice(choice({ llm_provider: 'openai', llm_model: '  ' }))).toBe('llm-model-missing');
  });

  it('refuses Laya without the address where it runs', () => {
    expect(validateChoice(choice({ judgment_service: 'laya', judgment_model: 'm' }))).toBe('laya-address-missing');
  });

  it('accepts Laya once its address is given', () => {
    expect(
      validateChoice(choice({ judgment_service: 'laya', judgment_model: 'm', judgment_address: 'http://127.0.0.1:9000/v1/systemone' })),
    ).toBeNull();
  });
});

describe('validateChoice threshold', () => {
  it('accepts a whole percentage from 1 to 100', () => {
    expect(validateChoice(choice({ match_threshold: 1 }))).toBeNull();
    expect(validateChoice(choice({ match_threshold: 100 }))).toBeNull();
  });

  it('refuses a percentage outside that range, or not whole', () => {
    expect(validateChoice(choice({ match_threshold: 0 }))).toBe('threshold-out-of-range');
    expect(validateChoice(choice({ match_threshold: 101 }))).toBe('threshold-out-of-range');
    expect(validateChoice(choice({ match_threshold: 70.5 }))).toBe('threshold-out-of-range');
  });
});

describe('modelOptions', () => {
  it('lists the models the provider offers, sorted', () => {
    expect(modelOptions(['b-model', 'a-model'], 'a-model')).toEqual(['a-model', 'b-model']);
  });

  it('keeps the current model in the list even when the provider no longer offers it', () => {
    expect(modelOptions(['a-model'], 'old-model')).toEqual(['a-model', 'old-model']);
  });

  it('is empty when there is nothing to choose from and nothing chosen', () => {
    expect(modelOptions([], '')).toEqual([]);
  });
});


describe('the programs of a subscription', () => {
  it('knows the four programs and nothing else', () => {
    expect(CLI_PROVIDERS.map((name) => isCliProvider(name))).toEqual([true, true, true, true]);
    expect(isCliProvider('anthropic')).toBe(false);
    expect(isCliProvider('cli-vim')).toBe(false);
    expect(CLI_NAMES['cli-claude']).toEqual({ name: 'Claude Code', program: 'claude' });
  });

  it('a program uses its own model, and leaving one asks the user to choose', () => {
    expect(modelAfterSwitch('cli-codex', 'gpt-x')).toBe('default');
    expect(modelAfterSwitch('openai', 'default')).toBe('');
    expect(modelAfterSwitch('openai', 'gpt-x')).toBe('gpt-x');
  });
});

describe('choosing the AI service once', () => {
  const base: ProviderChoiceView = { llm_provider: 'anthropic', llm_model: 'claude-sonnet-5-5', judgment_service: 'typesafe', judgment_model: 'jev-1.14.0', judgment_address: '', match_threshold: 70 };

  it('a subscription program also judges, so no other key is needed, and the choice can be saved', () => {
    const next = chooseProvider(base, 'cli-claude');
    expect(next).toMatchObject({ llm_provider: 'cli-claude', llm_model: 'default', judgment_service: 'provider' });
    expect(validateChoice(next)).toBeNull();
  });

  it('a judge the person runs themselves is left alone', () => {
    expect(chooseProvider({ ...base, judgment_service: 'ollama' }, 'cli-codex').judgment_service).toBe('ollama');
  });

  it('going back to an API provider puts the hosted judge back, with a model to start from', () => {
    const cli = chooseProvider(base, 'cli-gemini');
    expect(chooseApi(cli)).toMatchObject({ llm_provider: 'anthropic', llm_model: 'claude-sonnet-5-5', judgment_service: 'typesafe' });
    expect(chooseApi(base)).toEqual(base);
  });

  it('the input is not changed', () => {
    const copy = { ...base };
    chooseProvider(base, 'cli-claude');
    expect(base).toEqual(copy);
  });
});
