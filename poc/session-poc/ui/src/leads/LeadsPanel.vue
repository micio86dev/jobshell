<script setup lang="ts">
// The clients page: run a search, see the few leads worth the user's time, decide on each, read the
// evidence, copy a draft. This is the container: it talks to the backend and validates what comes
// back; the cards and the detail only show what they are given.
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

import { t } from '../i18n/store';
import ImportBox from './ImportBox.vue';
import LeadCard from './LeadCard.vue';
import LeadDetail from './LeadDetail.vue';
import {
  actionEvent,
  costLine,
  lookSeconds,
  parseDetail,
  parseLeads,
  parseRunSummary,
  VIEWS,
  type Action,
  type Lead,
  type LeadDetail as Detail,
  type View,
} from './leads-model';

const emit = defineEmits<{ ran: [] }>();

const view = ref<View>('inbox');
const leads = ref<Lead[]>([]);
const loaded = ref(false);
const problem = ref('');
const busyId = ref<number | null>(null);
const detail = ref<Detail | null>(null);
const running = ref<'' | 'dry' | 'real'>('');
const progress = ref('');
const resultLine = ref('');
const importMessage = ref('');
const importFailed = ref(false);
const importBusy = ref(false);

// The time the user spends with a lead open is what the search is judged by (wanted leads per hour of their
// time). It counts only while the window is visible, and a look is recorded when the lead is closed or left.
let looking: { id: number; since: number } | null = null;
const stopLooking = (): void => {
  if (looking === null) return;
  const seconds = lookSeconds(looking.since, Date.now());
  const id = looking.id;
  looking = null;
  if (seconds > 0) void invoke('lead_review', { id, seconds }).catch(() => undefined);
};
const startLooking = (id: number): void => {
  stopLooking();
  if (document.visibilityState === 'visible') looking = { id, since: Date.now() };
};
const onVisibility = (): void => {
  if (document.visibilityState === 'hidden') stopLooking();
  else if (detail.value !== null) startLooking(detail.value.lead.id);
};

const load = async (): Promise<void> => {
  problem.value = '';
  try {
    const parsed = parseLeads(await invoke<unknown>('lead_list', { view: view.value }));
    if (parsed.ok) leads.value = parsed.leads;
    else problem.value = parsed.error;
  } catch (error) {
    problem.value = String(error);
  }
  loaded.value = true;
};

const select = async (next: View): Promise<void> => {
  view.value = next;
  stopLooking();
  detail.value = null;
  await load();
};

const openDetail = async (id: number): Promise<void> => {
  try {
    const parsed = parseDetail(await invoke<unknown>('lead_detail', { id }));
    if (parsed.ok) {
      detail.value = parsed.detail;
      startLooking(parsed.detail.lead.id);
      // The detail sits above the list: bring it into view, or a click far down the page seems to do nothing.
      await nextTick();
      document.querySelector('.detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else problem.value = parsed.error;
  } catch (error) {
    problem.value = String(error);
  }
};

const act = async (lead: Lead, action: Action): Promise<void> => {
  busyId.value = lead.id;
  try {
    await invoke('lead_event', { id: lead.id, event: actionEvent(action), note: null });
    await load();
    if (detail.value?.lead.id === lead.id) await openDetail(lead.id);
  } catch (error) {
    problem.value = String(error);
  } finally {
    busyId.value = null;
  }
};

const forget = async (): Promise<void> => {
  const current = detail.value;
  if (current === null) return;
  if (!window.confirm(t('leads.forgetConfirm', { name: current.lead.company_name }))) return;
  try {
    await invoke('lead_forget', { key: current.lead.company_key });
    looking = null;
    detail.value = null;
    await load();
  } catch (error) {
    problem.value = String(error);
  }
};

const closeDetail = (): void => {
  stopLooking();
  detail.value = null;
};

const openLink = (url: string): void => {
  // The backend opens only plain web addresses.
  void invoke('agent_open_posting', { url }).catch((error: unknown) => {
    problem.value = String(error);
  });
};

const run = async (dry: boolean): Promise<void> => {
  running.value = dry ? 'dry' : 'real';
  resultLine.value = '';
  progress.value = '';
  try {
    const parsed = parseRunSummary(await invoke<string>('lead_run', { dryRun: dry }));
    if (parsed.ok) {
      resultLine.value = dry
        ? parsed.summary.explanation.join(' ')
        : t('leads.result', { qualified: parsed.summary.qualified, total: parsed.summary.leads, cost: costLine(parsed.summary.cost) });
    } else {
      resultLine.value = t('leads.failed', { reason: parsed.error });
    }
    emit('ran');
  } catch (error) {
    resultLine.value = t('leads.failed', { reason: String(error) });
  } finally {
    running.value = '';
    progress.value = '';
    await load();
  }
};

const submitImport = async (request: { text: string | null; url: string | null }): Promise<void> => {
  importBusy.value = true;
  importMessage.value = '';
  try {
    await invoke<string>('lead_import', { text: request.text, url: request.url });
    importFailed.value = false;
    importMessage.value = t('leads.import.queued');
  } catch (error) {
    importFailed.value = true;
    importMessage.value = t('leads.import.failed', { reason: String(error) });
  } finally {
    importBusy.value = false;
  }
};

let unlisten: UnlistenFn | null = null;
onMounted(async () => {
  void load();
  unlisten = await listen<string>('agent-progress', (event) => {
    if (running.value !== '') progress.value = event.payload;
  });
});
onMounted(() => document.addEventListener('visibilitychange', onVisibility));
onBeforeUnmount(() => {
  unlisten?.();
  document.removeEventListener('visibilitychange', onVisibility);
  stopLooking();
});
</script>

<template>
  <section class="leads">
    <div class="actions">
      <button type="button" class="primary" :disabled="running !== ''" @click="run(false)">
        {{ running === 'real' ? t('leads.running') : t('leads.run') }}
      </button>
      <button type="button" :disabled="running !== ''" @click="run(true)">
        {{ running === 'dry' ? t('leads.running') : t('leads.runDry') }}
      </button>
      <button type="button" :disabled="running !== ''" @click="load">{{ t('leads.reload') }}</button>
    </div>
    <p class="hint">{{ t('leads.hint') }}</p>
    <p v-if="progress !== ''" class="progress">{{ progress }}</p>
    <p v-if="resultLine !== ''" class="result">{{ resultLine }}</p>
    <p v-if="problem !== ''" class="problem">{{ problem }}</p>

    <ImportBox :busy="importBusy" :message="importMessage" :failed="importFailed" @submit="submitImport" />

    <nav class="views">
      <button v-for="name in VIEWS" :key="name" type="button" :class="{ on: view === name }" @click="select(name)">
        {{ t(('leads.view.' + name) as 'leads.view.inbox') }}
      </button>
    </nav>

    <LeadDetail
      v-if="detail !== null"
      :detail="detail"
      @close="closeDetail"
      @forget="forget"
      @open-link="openLink"
    />

    <p v-if="loaded && leads.length === 0 && view === 'inbox'" class="empty">{{ t('leads.empty') }}</p>
    <LeadCard
      v-for="lead in leads"
      :key="lead.id"
      :lead="lead"
      :busy="busyId === lead.id"
      @action="(action) => act(lead, action)"
      @open="openDetail(lead.id)"
    />
  </section>
</template>

<style scoped>
.actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
button { font: inherit; font-size: 0.85rem; padding: 0.3rem 0.8rem; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-raised); color: var(--fg); cursor: pointer; }
button.primary { background: var(--cta); color: var(--cta-fg); border-color: var(--cta); }
button:disabled { opacity: 0.5; cursor: default; }
.hint { font-size: 0.78rem; color: var(--fg-muted); max-width: 46rem; }
.progress { font-family: var(--font-mono); font-size: 0.75rem; color: var(--fg-muted); }
.result { font-size: 0.88rem; }
.problem { color: oklch(0.7 0.15 30); font-size: 0.85rem; }
.views { display: flex; gap: 0.4rem; margin: 0.8rem 0; }
.views button.on { background: var(--cta); color: var(--cta-fg); border-color: var(--cta); }
.empty { color: var(--fg-muted); max-width: 42rem; font-size: 0.9rem; }
</style>
