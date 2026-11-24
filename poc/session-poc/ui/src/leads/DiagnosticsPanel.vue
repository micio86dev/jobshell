<script setup lang="ts">
// Why each run gave what it gave. The page for the user who sees fewer leads than expected: it names the
// source that failed, the filter that removed the most, the judgment that was unavailable, and the cost.
import { invoke } from '@tauri-apps/api/core';
import { onMounted, ref, watch } from 'vue';

import { t } from '../i18n/store';
import { costLine, parseLeads, parseRuns, type Lead, type RunRow } from './leads-model';

const props = defineProps<{ refresh: number }>();

const runs = ref<RunRow[]>([]);
const rejected = ref<Lead[]>([]);
const loaded = ref(false);
const problem = ref('');

const load = async (): Promise<void> => {
  problem.value = '';
  try {
    const parsed = parseRuns(await invoke<unknown>('lead_runs', { limit: 10 }));
    if (parsed.ok) runs.value = parsed.runs;
    else problem.value = parsed.error;
    const list = parseLeads(await invoke<unknown>('lead_list', { view: 'rejected' }));
    if (list.ok) rejected.value = list.leads;
  } catch (error) {
    problem.value = String(error);
  }
  loaded.value = true;
};

const entries = (record: Record<string, number>): Array<[string, number]> => Object.entries(record).sort((a, b) => b[1] - a[1]);

onMounted(load);
watch(() => props.refresh, load);
</script>

<template>
  <section class="diag">
    <h2>{{ t('diag.title') }}</h2>
    <p v-if="problem !== ''" class="problem">{{ problem }}</p>
    <p v-if="loaded && runs.length === 0" class="empty">{{ t('diag.none') }}</p>

    <article v-for="(run, index) in runs" :key="run.id" class="run" :open="index === 0">
      <h3>{{ run.started_at.slice(0, 16).replace('T', ' ') }}<span v-if="run.metrics.dry_run" class="meta"> · {{ t('diag.dry') }}</span></h3>
      <h4>{{ t('diag.why') }}</h4>
      <ul>
        <li v-for="line in run.metrics.explanation" :key="line">{{ line }}</li>
      </ul>
      <h4>{{ t('diag.sources') }}</h4>
      <ul class="small">
        <li v-for="source in run.metrics.sources" :key="source.source">
          <strong>{{ source.source }}</strong>: {{ source.skipped === null ? source.postings : source.skipped }}
        </li>
      </ul>
      <h4>{{ t('diag.funnel') }}</h4>
      <p class="small">
        {{ run.metrics.signals.collected ?? 0 }} → {{ run.metrics.signals.unique ?? 0 }} →
        {{ run.metrics.companies.found ?? 0 }} → {{ run.metrics.companies.after_filter ?? 0 }} →
        {{ run.metrics.companies.classified ?? 0 }} → {{ run.metrics.qualified }}
      </p>
      <p v-if="entries(run.metrics.prefilter_dropped).length > 0" class="small">
        <span v-for="[reason, total] in entries(run.metrics.prefilter_dropped)" :key="reason" class="chip">{{ reason }} {{ total }}</span>
      </p>
      <template v-if="entries(run.metrics.rejected).length > 0">
        <h4>{{ t('diag.rejected') }}</h4>
        <p class="small"><span v-for="[reason, total] in entries(run.metrics.rejected)" :key="reason" class="chip">{{ reason }} {{ total }}</span></p>
      </template>
      <template v-if="run.metrics.errors.length > 0">
        <h4>{{ t('diag.errors') }}</h4>
        <ul class="small"><li v-for="(error, i) in run.metrics.errors.slice(0, 8)" :key="i"><strong>{{ error.stage }}</strong>: {{ error.message }}</li></ul>
      </template>
      <p class="small"><strong>{{ t('diag.cost') }}:</strong> {{ costLine(run.cost, run.metrics.qualified) }}</p>
    </article>

    <template v-if="rejected.length > 0">
      <h3>{{ t('diag.rejectedList') }}</h3>
      <ul class="small">
        <li v-for="lead in rejected.slice(0, 30)" :key="lead.id"><strong>{{ lead.company_name }}</strong> ({{ Math.round(lead.score) }}) — {{ lead.rejection_reason }}</li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
h2 { font-size: 1rem; }
h3 { font-size: 0.92rem; margin: 1.2rem 0 0.3rem; }
h4 { font-size: 0.8rem; margin: 0.8rem 0 0.2rem; color: var(--fg-muted); text-transform: uppercase; letter-spacing: 0.04em; }
ul { padding-left: 1.1rem; margin: 0.2rem 0; }
li { font-size: 0.88rem; margin: 0.2rem 0; }
.small, .small li { font-size: 0.8rem; }
.run { border-top: 1px solid var(--border); padding-top: 0.6rem; }
.chip { display: inline-block; border: 1px solid var(--border); border-radius: 999px; padding: 0 0.5rem; margin: 0 0.3rem 0.3rem 0; font-family: var(--font-mono); font-size: 0.72rem; }
.meta, .empty { color: var(--fg-muted); }
.problem { color: oklch(0.7 0.15 30); }
</style>
