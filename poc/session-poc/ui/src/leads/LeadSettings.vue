<script setup lang="ts">
// The limits of the client search, editable without touching a file. The agent validates every value.
import { invoke } from '@tauri-apps/api/core';
import { onMounted, ref } from 'vue';
import { z } from 'zod';

import { t } from '../i18n/store';

const strategy = z.object({
  threshold: z.number(),
  min_confidence: z.number(),
  classify_budget: z.number(),
  enrich_budget: z.number(),
  usd_cap: z.number(),
  target_markets: z.array(z.string()),
  exclude_companies: z.array(z.string()),
});

const threshold = ref(60);
const minConfidence = ref(0.4);
const classify = ref(150);
const enrich = ref(25);
const cap = ref(5);
const markets = ref('');
const exclude = ref('');
const message = ref('');
const failed = ref(false);
const HOURS = [0, 6, 12, 24, 48] as const;
const scheduleSchema = z.object({ every_hours: z.number(), last_attempt: z.number().nullable() });
const everyHours = ref<number>(0);
const lastAttempt = ref<number | null>(null);
const scheduleMessage = ref('');

const split = (value: string): string[] => value.split(',').map((part) => part.trim()).filter((part) => part !== '');

const show = (text: string): void => {
  const parsed = strategy.safeParse(JSON.parse(text));
  if (!parsed.success) return;
  threshold.value = parsed.data.threshold;
  minConfidence.value = parsed.data.min_confidence;
  classify.value = parsed.data.classify_budget;
  enrich.value = parsed.data.enrich_budget;
  cap.value = parsed.data.usd_cap;
  markets.value = parsed.data.target_markets.join(', ');
  exclude.value = parsed.data.exclude_companies.join(', ');
};

const save = async (): Promise<void> => {
  message.value = '';
  try {
    const answer = await invoke<string>('lead_strategy_set', {
      change: JSON.stringify({
        threshold: threshold.value,
        min_confidence: minConfidence.value,
        classify_budget: classify.value,
        enrich_budget: enrich.value,
        usd_cap: cap.value,
        target_markets: split(markets.value.toUpperCase()),
        exclude_companies: split(exclude.value),
      }),
    });
    show(answer);
    failed.value = false;
    message.value = t('settings.leads.saved');
  } catch (error) {
    failed.value = true;
    message.value = t('settings.leads.failed', { reason: String(error) });
  }
};

const saveSchedule = async (): Promise<void> => {
  scheduleMessage.value = '';
  try {
    const parsed = scheduleSchema.parse(await invoke<unknown>('lead_schedule_set', { everyHours: everyHours.value }));
    everyHours.value = parsed.every_hours;
    scheduleMessage.value = t('settings.leads.saved');
  } catch (error) {
    scheduleMessage.value = t('settings.leads.failed', { reason: String(error) });
  }
};

onMounted(async () => {
  try {
    const parsed = scheduleSchema.parse(await invoke<unknown>('lead_schedule_get'));
    everyHours.value = parsed.every_hours;
    lastAttempt.value = parsed.last_attempt;
  } catch {
    // Off stays on screen: a schedule that cannot be read is not shown as running.
  }
  try {
    show(await invoke<string>('lead_strategy_get'));
  } catch {
    // The defaults stay on screen: a strategy that cannot be read is not an error for the page.
  }
});
</script>

<template>
  <section class="settings">
    <h2>{{ t('settings.leads.title') }}</h2>
    <p class="hint">{{ t('settings.leads.hint') }}</p>
    <label>{{ t('settings.leads.threshold') }}<input v-model.number="threshold" type="number" min="0" max="100" step="1" /></label>
    <label>{{ t('settings.leads.minConfidence') }}<input v-model.number="minConfidence" type="number" min="0" max="1" step="0.05" /></label>
    <label>{{ t('settings.leads.classify') }}<input v-model.number="classify" type="number" min="0" max="1000" step="10" /></label>
    <label>{{ t('settings.leads.enrich') }}<input v-model.number="enrich" type="number" min="0" max="100" step="1" /></label>
    <label>{{ t('settings.leads.cap') }}<input v-model.number="cap" type="number" min="0" max="1000" step="0.5" /></label>
    <label>{{ t('settings.leads.markets') }}<input v-model="markets" type="text" /></label>
    <label>{{ t('settings.leads.exclude') }}<input v-model="exclude" type="text" /></label>
    <button type="button" @click="save">{{ t('settings.leads.save') }}</button>
    <p v-if="message !== ''" :class="failed ? 'bad' : 'ok'">{{ message }}</p>

    <h3>{{ t('settings.leads.schedule') }}</h3>
    <p class="hint">{{ t('settings.leads.scheduleHint') }}</p>
    <label>
      <select v-model.number="everyHours" @change="saveSchedule">
        <option v-for="hours in HOURS" :key="hours" :value="hours">
          {{ hours === 0 ? t('settings.leads.off') : t('settings.leads.every', { hours }) }}
        </option>
      </select>
    </label>
    <p v-if="lastAttempt !== null" class="hint">{{ new Date(lastAttempt * 1000).toLocaleString() }}</p>
    <p v-if="scheduleMessage !== ''" class="ok">{{ scheduleMessage }}</p>
  </section>
</template>

<style scoped>
h2 { font-size: 0.95rem; margin: 1.6rem 0 0.4rem; }
.hint { font-size: 0.78rem; color: var(--fg-muted); }
label { display: block; font-size: 0.85rem; margin: 0.5rem 0; max-width: 28rem; }
h3 { font-size: 0.88rem; margin: 1.3rem 0 0.2rem; }
select { display: block; width: 100%; box-sizing: border-box; font: inherit; margin-top: 0.2rem; background: var(--bg); color: var(--fg); border: 1px solid var(--border); border-radius: 6px; padding: 0.35rem 0.5rem; }
input { display: block; width: 100%; box-sizing: border-box; font: inherit; margin-top: 0.2rem; background: var(--bg); color: var(--fg); border: 1px solid var(--border); border-radius: 6px; padding: 0.35rem 0.5rem; }
button { font: inherit; font-size: 0.85rem; padding: 0.3rem 0.9rem; border-radius: 6px; border: 1px solid var(--cta); background: var(--cta); color: var(--cta-fg); cursor: pointer; margin-top: 0.4rem; }
.ok { color: var(--accent); font-size: 0.85rem; }
.bad { color: oklch(0.7 0.15 30); font-size: 0.85rem; }
</style>
