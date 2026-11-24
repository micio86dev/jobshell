<script setup lang="ts">
// Where a lead from a place the agent may not read is handed over: a pasted post or a public link.
import { ref } from 'vue';

import { t } from '../i18n/store';

const props = defineProps<{ busy: boolean; message: string; failed: boolean }>();
const emit = defineEmits<{ submit: [request: { text: string | null; url: string | null }] }>();

const text = ref('');
const url = ref('');

const send = (): void => {
  emit('submit', { text: text.value.trim() === '' ? null : text.value, url: url.value.trim() === '' ? null : url.value.trim() });
};
</script>

<template>
  <details class="import">
    <summary>{{ t('leads.import.title') }}</summary>
    <p class="hint">{{ t('leads.import.hint') }}</p>
    <label>{{ t('leads.import.text') }}<textarea v-model="text" rows="5" /></label>
    <label>{{ t('leads.import.url') }}<input v-model="url" type="url" placeholder="https://" /></label>
    <button type="button" :disabled="props.busy || (text.trim() === '' && url.trim() === '')" @click="send">{{ t('leads.import.submit') }}</button>
    <p v-if="props.message !== ''" :class="props.failed ? 'bad' : 'ok'">{{ props.message }}</p>
  </details>
</template>

<style scoped>
.import { margin: 0.8rem 0; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 0.5rem 0.9rem; }
summary { cursor: pointer; font-size: 0.9rem; }
.hint { font-size: 0.78rem; color: var(--fg-muted); }
label { display: block; font-size: 0.82rem; margin: 0.5rem 0; }
textarea, input { display: block; width: 100%; box-sizing: border-box; font: inherit; margin-top: 0.2rem; background: var(--bg); color: var(--fg); border: 1px solid var(--border); border-radius: 6px; padding: 0.4rem; }
button { font: inherit; font-size: 0.85rem; padding: 0.3rem 0.8rem; border-radius: 6px; border: 1px solid var(--cta); background: var(--cta); color: var(--cta-fg); cursor: pointer; }
button:disabled { opacity: 0.5; }
.ok { color: var(--accent); font-size: 0.85rem; }
.bad { color: oklch(0.7 0.15 30); font-size: 0.85rem; }
</style>
