<script setup lang="ts">
// The AI service, chosen once at the start. The same choice lives in Settings, where it can be changed.
import { computed, onMounted, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';

import { t } from '../i18n/store';
import { chooseApi, chooseProvider, CLI_NAMES, CLI_PROVIDERS, isCliProvider, validateChoice, type ProviderChoiceView } from '../settings/provider-settings';

const choice = ref<ProviderChoiceView | null>(null);
const found = ref<Record<string, boolean> | null>(null);
const message = ref('');
const failed = ref(false);

onMounted(async () => {
  try {
    choice.value = await invoke<ProviderChoiceView>('agent_get_settings');
  } catch {
    choice.value = null;
  }
  try {
    found.value = await invoke<Record<string, boolean>>('agent_cli_status');
  } catch {
    found.value = null;
  }
});

const selected = computed(() => (choice.value === null ? '' : isCliProvider(choice.value.llm_provider) ? choice.value.llm_provider : 'api'));

const pick = async (value: string): Promise<void> => {
  if (choice.value === null) return;
  const next = value === 'api' ? chooseApi(choice.value) : chooseProvider(choice.value, value);
  if (validateChoice(next) !== null) return;
  try {
    await invoke('agent_save_settings', { settings: next });
    choice.value = next;
    failed.value = false;
    message.value = t('ai.saved');
  } catch (error) {
    failed.value = true;
    message.value = t('ai.failed', { reason: String(error) });
  }
};

const status = (provider: (typeof CLI_PROVIDERS)[number]): string => {
  if (found.value === null) return '';
  const entry = CLI_NAMES[provider];
  return found.value[entry.program] === true ? t('settings.cli.found', { name: entry.name }) : t('settings.cli.missing', { name: entry.name });
};
</script>

<template>
  <fieldset v-if="choice !== null" class="ai-choice">
    <legend>{{ t('ai.title') }}</legend>
    <p>{{ t('ai.intro') }}</p>
    <label v-for="provider in CLI_PROVIDERS" :key="provider" class="ai-option">
      <input type="radio" name="ai-service" :value="provider" :checked="selected === provider" @change="pick(provider)" />
      <span>{{ CLI_NAMES[provider].name }}</span>
      <small>{{ status(provider) }}</small>
    </label>
    <label class="ai-option">
      <input type="radio" name="ai-service" value="api" :checked="selected === 'api'" @change="pick('api')" />
      <span>{{ t('ai.api') }}</span>
      <small v-if="selected === 'api'">{{ t('ai.apiHint') }}</small>
    </label>
    <p v-if="isCliProvider(choice.llm_provider)" class="notice">{{ t('settings.cli.hint') }}</p>
    <p v-if="message !== ''" class="notice" :class="{ error: failed }" role="status">{{ message }}</p>
  </fieldset>
</template>

<style scoped>
.ai-choice { margin-bottom: 1rem; }
.ai-option { display: flex; gap: 0.5rem; align-items: baseline; padding: 0.15rem 0; }
.ai-option small { opacity: 0.7; }
</style>
