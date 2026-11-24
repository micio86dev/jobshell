<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { onMounted, ref } from 'vue';
import OnboardingWizard from './onboarding/OnboardingWizard.vue';
import SourcesPanel from './sources/SourcesPanel.vue';
import DiagnosticsPanel from './leads/DiagnosticsPanel.vue';
import LeadSettings from './leads/LeadSettings.vue';
import LeadsPanel from './leads/LeadsPanel.vue';
import { setPrimaryLanguage, t } from './i18n/store';
import { primaryOf } from './onboarding/schema';
import { describeKeyCheck, parseKeyCheckReport, type KeyCheckView } from './settings/key-check';
import { chooseProvider, CLI_NAMES, CLI_PROVIDERS, isCliProvider, modelOptions, validateChoice, type ChoiceProblem, type ProviderChoiceView } from './settings/provider-settings';
import { parseReportResult, type ReportView } from './report/report-result';
import { renderMarkdown } from './report/markdown-html';

const CHOICE_COPY: Record<ChoiceProblem, string> = {
  'llm-model-missing': 'scegli un modello per il provider che legge il CV',
  'judgment-model-missing': 'scegli un modello per il servizio che giudica',
  'laya-address-missing': 'Laya ha bisogno dell’indirizzo dove gira',
  'threshold-out-of-range': 'la soglia di corrispondenza va da 1% a 100%',
};

type SelectedView = {
  key: string;
  title: string;
  company: string | null;
  url: string;
  source: string;
  probability: number;
  verdict: string;
  stack_stance: string;
  gaps: string[];
};

type DroppedCount = { reason: string; count: number };

type RunSummary = {
  run_at: string;
  threshold: number;
  fetched: number;
  kept: number;
  judged: number;
  budget: number;
  input_tokens: number;
  dropped: DroppedCount[];
  selected: SelectedView[];
};

type AgentRunView = { evidence_path: string; summary: RunSummary };

type TaskView = {
  id: number;
  kind: string;
  state: string;
  attempts: number;
  result: string | null;
};

const tab = ref<'leads' | 'diagnostics' | 'results' | 'tasks' | 'settings'>('leads');
// Bumped after each lead search, so the diagnostics reload what the run just recorded.
const leadRuns = ref(0);

// Results view
const run = ref<AgentRunView | null>(null);
const loaded = ref(false);
const status = ref('idle');

const loadRun = async (): Promise<void> => {
  try {
    run.value = await invoke<AgentRunView | null>('agent_last_run');
    loaded.value = true;
  } catch (error) {
    status.value = `lettura fallita: ${String(error)}`;
    loaded.value = true;
  }
};

const running = ref<'' | 'dry' | 'real'>('');

// One report per selected posting, keyed by the posting key. `busy` shows the wait; the report
// is shown as text, never as HTML.
type ReportState = { busy: boolean; view: ReportView | null };
const reports = ref<Record<string, ReportState>>({});

const openReport = async (key: string): Promise<void> => {
  reports.value = { ...reports.value, [key]: { busy: true, view: null } };
  let view: ReportView;
  try {
    view = parseReportResult(await invoke<string>('agent_report', { key }));
  } catch (error) {
    view = { ok: false, reason: String(error) };
  }
  reports.value = { ...reports.value, [key]: { busy: false, view } };
};

const reportMarkdown = (key: string): string | null => {
  const view = reports.value[key]?.view;
  return view?.ok === true ? view.markdown : null;
};

const reportReason = (key: string): string | null => {
  const view = reports.value[key]?.view;
  return view?.ok === false ? view.reason : null;
};

// The tailored CV of one posting: its rewritten text and the PDF written beside the evidence.
const tailored = ref<Record<string, ReportState>>({});

const openTailored = async (key: string): Promise<void> => {
  tailored.value = { ...tailored.value, [key]: { busy: true, view: null } };
  let view: ReportView;
  try {
    view = parseReportResult(await invoke<string>('agent_tailored_cv', { key }));
  } catch (error) {
    view = { ok: false, reason: String(error) };
  }
  tailored.value = { ...tailored.value, [key]: { busy: false, view } };
};

const tailoredMarkdown = (key: string): string | null => {
  const view = tailored.value[key]?.view;
  return view?.ok === true ? view.markdown : null;
};

// The PDF copy the user asked for: the Downloads path, or the reason it could not be copied.
const downloads = ref<Record<string, { busy: boolean; path: string | null; reason: string | null }>>({});

const downloadTailored = async (key: string): Promise<void> => {
  downloads.value = { ...downloads.value, [key]: { busy: true, path: null, reason: null } };
  try {
    const path = await invoke<string>('agent_download_cv', { key });
    downloads.value = { ...downloads.value, [key]: { busy: false, path, reason: null } };
  } catch (error) {
    downloads.value = { ...downloads.value, [key]: { busy: false, path: null, reason: String(error) } };
  }
};

const tailoredPdf = (key: string): string | null => {
  const view = tailored.value[key]?.view;
  return view?.ok === true ? view.pdf : null;
};

const tailoredReason = (key: string): string | null => {
  const view = tailored.value[key]?.view;
  return view?.ok === false ? view.reason : null;
};

const runAgent = async (dryRun: boolean): Promise<void> => {
  running.value = dryRun ? 'dry' : 'real';
  const label = dryRun ? 'Dry run in progress…' : 'Run in progress…';
  status.value = label;
  // The agent reports each step while it works; the last one stays on screen until the run ends.
  const unlisten = await listen<string>('agent-progress', (event) => {
    status.value = `${label} ${event.payload}`;
  });
  try {
    await invoke<string>('agent_run', { dryRun });
    status.value = dryRun ? 'Dry run complete' : 'Run complete';
    await loadRun();
  } catch (error) {
    status.value = `Run failed: ${String(error)}`;
  } finally {
    unlisten();
    running.value = '';
  }
};

// The title opens the real posting in the browser; the window itself never navigates away.
const openPosting = async (url: string): Promise<void> => {
  try {
    await invoke('agent_open_posting', { url });
  } catch (error) {
    status.value = `Apertura non riuscita: ${String(error)}`;
  }
};

const sourcesMessage = ref('');

const openSources = async (): Promise<void> => {
  sourcesMessage.value = 'apro il bridge e il browser…';
  try {
    const message = await invoke<string>('agent_open_sources');
    sourcesMessage.value = `fonti aperte: ${message}`;
  } catch (error) {
    sourcesMessage.value = `non riesco ad aprire le fonti: ${String(error)}`;
  }
};

const stopSources = async (): Promise<void> => {
  try {
    await invoke('agent_stop_sources');
    sourcesMessage.value = 'fonti chiuse';
  } catch (error) {
    sourcesMessage.value = `chiusura fallita: ${String(error)}`;
  }
};

const percent = (probability: number): number => Math.round(probability * 100);

const verdictLabel = (verdict: string): string => {
  switch (verdict) {
    case 'yes':
      return 'fit pieno';
    case 'yes_with_gap':
      return 'fit con gap';
    case 'gap_not_accepted':
      return 'gap non accettato';
    case 'no':
      return 'non adatto';
    default:
      return verdict;
  }
};

const stackLabel = (stance: string): string => {
  switch (stance) {
    case 'required_specific':
      return 'stack richiesto';
    case 'preferred':
      return 'stack preferito';
    case 'tool_mentioned':
      return 'stack come strumento';
    default:
      return 'stack non specificato';
  }
};

const when = (iso: string): string => {
  if (iso.length === 0) return 'data sconosciuta';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('it-IT');
};

// Settings view: the keys are written to the OS keychain by the Rust side, never to a file.
type KeyAccount = 'typesafe' | 'anthropic' | 'openai' | 'gemini' | 'qwen';
const KEY_ACCOUNTS: KeyAccount[] = ['typesafe', 'anthropic', 'openai', 'gemini', 'qwen'];
const LLM_OPTIONS = ['anthropic', 'openai', 'gemini', 'qwen'];
const JUDGMENT_OPTIONS = ['typesafe', 'ollama', 'laya', 'provider'];

const keyInputs = ref<Record<KeyAccount, string>>({ typesafe: '', anthropic: '', openai: '', gemini: '', qwen: '' });
const keyStatus = ref<Record<string, boolean> | null>(null);
const keyMessage = ref('');
const keyChecks = ref<Record<KeyAccount, KeyCheckView | null>>({
  typesafe: null,
  anthropic: null,
  openai: null,
  gemini: null,
  qwen: null,
});

// The provider choice: names and an address only. The models come from each provider's own list.
const providerChoice = ref<ProviderChoiceView | null>(null);
const offeredModels = ref<Record<string, string[]>>({});
const choiceMessage = ref('');

const loadChoice = async (): Promise<void> => {
  try {
    providerChoice.value = await invoke<ProviderChoiceView>('agent_get_settings');
  } catch (error) {
    choiceMessage.value = `lettura della scelta fallita: ${String(error)}`;
  }
};

const loadModels = async (account: string): Promise<void> => {
  choiceMessage.value = `elenco modelli di ${account}…`;
  try {
    offeredModels.value[account] = await invoke<string[]>('agent_list_models', { account });
    choiceMessage.value = `${offeredModels.value[account]?.length ?? 0} modelli disponibili per ${account}`;
  } catch (error) {
    choiceMessage.value = `elenco modelli non disponibile: ${String(error)}`;
  }
};

// The programs of a subscription found on this computer, asked on demand: only presence is read.
const cliFound = ref<Record<string, boolean> | null>(null);
const checkPrograms = async (): Promise<void> => {
  try {
    cliFound.value = await invoke<Record<string, boolean>>('agent_cli_status');
  } catch {
    cliFound.value = null;
  }
};
const cliStatusLine = (provider: string): string => {
  if (!isCliProvider(provider) || cliFound.value === null) return '';
  const entry = CLI_NAMES[provider];
  return cliFound.value[entry.program] === true ? t('settings.cli.found', { name: entry.name }) : t('settings.cli.missing', { name: entry.name });
};
// Choosing a program needs no list of models and no key; leaving one asks for a model again.
const onProviderChange = async (): Promise<void> => {
  const choice = providerChoice.value;
  if (choice === null) return;
  // One choice moves the judge with it: a subscription program answers its questions too, so no other key.
  providerChoice.value = chooseProvider(choice, choice.llm_provider);
  if (isCliProvider(choice.llm_provider)) await checkPrograms();
  else await loadModels(choice.llm_provider);
};

const saveChoice = async (): Promise<void> => {
  if (providerChoice.value === null) return;
  const problem = validateChoice(providerChoice.value);
  if (problem !== null) {
    choiceMessage.value = CHOICE_COPY[problem];
    return;
  }
  try {
    await invoke('agent_save_settings', { settings: providerChoice.value });
    choiceMessage.value = 'scelta salvata';
  } catch (error) {
    choiceMessage.value = `salvataggio fallito: ${String(error)}`;
  }
};

// Ask the provider whether the stored key is accepted. The key itself never reaches the window.
const verifyKey = async (account: KeyAccount): Promise<void> => {
  keyChecks.value[account] = { tone: 'unknown', text: 'verifica in corso…' };
  try {
    const report = parseKeyCheckReport(await invoke<unknown>('agent_verify_key', { account }));
    keyChecks.value[account] = report === null
      ? { tone: 'unknown', text: 'risposta della verifica non valida' }
      : describeKeyCheck(report);
  } catch (error) {
    keyChecks.value[account] = { tone: 'unknown', text: `verifica fallita: ${String(error)}` };
  }
};

const loadKeyStatus = async (): Promise<void> => {
  try {
    keyStatus.value = await invoke<Record<string, boolean>>('agent_key_status');
  } catch (error) {
    keyMessage.value = `lettura chiavi fallita: ${String(error)}`;
  }
};

const zipClientId = ref('');
const zipMessage = ref('');

const connectZipRecruiter = async (): Promise<void> => {
  const clientId = zipClientId.value.trim();
  if (clientId.length === 0) {
    zipMessage.value = "serve l'URL del document che hai pubblicato";
    return;
  }
  zipMessage.value = 'apro la pagina di consenso nel browser…';
  try {
    zipMessage.value = await invoke<string>('ziprecruiter_connect', { clientId });
  } catch (error) {
    zipMessage.value = `collegamento fallito: ${String(error)}`;
  }
};

const zipQuery = ref('');

const writeZipDocument = async (): Promise<void> => {
  const clientId = zipClientId.value.trim();
  if (clientId.length === 0) {
    zipMessage.value = "prima scrivi l'URL dove pubblicherai il document";
    return;
  }
  try {
    const path = await invoke<string>('ziprecruiter_client_document', { clientId });
    zipMessage.value = `document scritto in ${path}: pubblicalo a quell'URL`;
  } catch (error) {
    zipMessage.value = `scrittura fallita: ${String(error)}`;
  }
};

const fetchZipRecruiter = async (): Promise<void> => {
  const query = zipQuery.value.trim();
  if (query.length === 0) {
    zipMessage.value = 'scrivi cosa cercare';
    return;
  }
  zipMessage.value = 'interrogo ZipRecruiter…';
  try {
    zipMessage.value = await invoke<string>('ziprecruiter_fetch', { query });
    await loadRun();
  } catch (error) {
    zipMessage.value = `ricerca fallita: ${String(error)}`;
  }
};

const saveKey = async (account: KeyAccount): Promise<void> => {
  const value = keyInputs.value[account].trim();
  if (value.length === 0) {
    keyMessage.value = `nessuna chiave da salvare per ${account}`;
    return;
  }
  try {
    await invoke('agent_save_key', { account, value });
    keyInputs.value[account] = '';
    keyChecks.value[account] = null;
    keyMessage.value = `${account}: salvata nel portachiavi`;
    await loadKeyStatus();
  } catch (error) {
    keyMessage.value = `salvataggio fallito: ${String(error)}`;
  }
};

// Task view (the Phase 0 spike, still here because it is the queue's proof)
const tasks = ref<TaskView[]>([]);
const keyringOk = ref<boolean | null>(null);

const refresh = async (): Promise<void> => {
  try {
    tasks.value = await invoke<TaskView[]>('list_tasks');
  } catch (error) {
    status.value = `list failed: ${String(error)}`;
  }
};

const enqueue = async (): Promise<void> => {
  try {
    const id = await invoke<number>('enqueue_probe', { kind: 'browser_probe' });
    status.value = `queued task ${id}`;
    await refresh();
  } catch (error) {
    status.value = `enqueue failed: ${String(error)}`;
  }
};

const recover = async (): Promise<void> => {
  try {
    const ids = await invoke<number[]>('recover_tasks');
    status.value = ids.length === 0 ? 'nothing to recover' : `recovered ${ids.join(', ')}`;
    await refresh();
  } catch (error) {
    status.value = `recover failed: ${String(error)}`;
  }
};

const start = async (id: number): Promise<void> => {
  try {
    await invoke<string>('start_task', { id });
    await refresh();
  } catch (error) {
    status.value = `start failed: ${String(error)}`;
  }
};

const fail = async (id: number): Promise<void> => {
  try {
    await invoke<string>('fail_task', { id, reason: 'failed in the spike' });
    await refresh();
  } catch (error) {
    status.value = `fail failed: ${String(error)}`;
  }
};

const finish = async (id: number): Promise<void> => {
  try {
    await invoke<string>('finish_task', { id, result: 'completed in the spike' });
    await refresh();
  } catch (error) {
    status.value = `finish failed: ${String(error)}`;
  }
};

const probeKeyring = async (): Promise<void> => {
  try {
    keyringOk.value = await invoke<boolean>('keyring_probe', { account: 'selftest-account' });
  } catch (error) {
    keyringOk.value = false;
    status.value = `keyring failed: ${String(error)}`;
  }
};

// Null until the first-run flag is read; the wizard opens only when onboarding is not complete.
const onboardingDone = ref<boolean | null>(null);
const editingProfile = ref(false);

onMounted(() => {
  void loadRun();
  void loadKeyStatus();
  void loadChoice();
  invoke<boolean>('onboarding_status')
    .then((done) => (onboardingDone.value = done))
    .catch(() => (onboardingDone.value = true));
  // The interface language follows the saved primary language; the system language until then.
  invoke<{ payload: string } | null>('identity_get')
    .then((found) => setPrimaryLanguage(found === null ? null : primaryOf(found.payload)))
    .catch(() => undefined);
});
</script>

<template>
  <main>
    <OnboardingWizard v-if="onboardingDone === false" mode="first" @done="onboardingDone = true" />
    <template v-else>
    <header>
      <h1>Jobshell</h1>
      <nav>
        <button type="button" :class="{ on: tab === 'leads' }" @click="tab = 'leads'">{{ t('tab.leads') }}</button>
        <button type="button" :class="{ on: tab === 'diagnostics' }" @click="tab = 'diagnostics'">{{ t('tab.diagnostics') }}</button>
        <button type="button" :class="{ on: tab === 'results' }" @click="tab = 'results'">{{ t('tab.results') }}</button>
        <button type="button" :class="{ on: tab === 'tasks' }" @click="tab = 'tasks'">{{ t('tab.tasks') }}</button>
        <button type="button" :class="{ on: tab === 'settings' }" @click="tab = 'settings'">{{ t('tab.settings') }}</button>
      </nav>
      <p class="status">{{ status }}</p>
    </header>

    <LeadsPanel v-if="tab === 'leads'" @ran="leadRuns += 1" />
    <DiagnosticsPanel v-else-if="tab === 'diagnostics'" :refresh="leadRuns" />

    <section v-else-if="tab === 'results'">
      <div class="actions">
        <button type="button" :disabled="running !== ''" @click="runAgent(true)">
          {{ running === 'dry' ? 'Dry run in progress…' : 'Dry run' }}
        </button>
        <button type="button" :disabled="running !== ''" @click="runAgent(false)">
          {{ running === 'real' ? 'Search in progress…' : 'Search now' }}
        </button>
        <button type="button" :disabled="running !== ''" @click="loadRun">Reload</button>
      </div>
      <p class="hint">
        "Dry run" fetches and filters without spending tokens. "Search now" judges with the service
        chosen in the Settings tab: Jev with its TypeSafe key, or the AI service you chose, with no other key.
      </p>

      <div class="actions">
        <button type="button" @click="openSources">Apri le fonti con login</button>
        <button type="button" @click="stopSources">Chiudi le fonti</button>
      </div>
      <p class="hint">
        Apre un browser dedicato con l'estensione già caricata: fai login su LinkedIn o Indeed
        una volta, poi apri un annuncio e premi l'icona dell'estensione. Il profilo è
        dell'app, non il tuo browser di tutti i giorni.
      </p>
      <p v-if="sourcesMessage.length > 0" class="status">{{ sourcesMessage }}</p>

      <p v-if="loaded && run === null" class="empty">
        No run yet. Press <strong>Dry run</strong> for the first one: it fetches the public
        postings without spending tokens.
      </p>

      <template v-if="run !== null">
        <p class="meta">
          last run {{ when(run.summary.run_at) }} · threshold
          {{ Math.round(run.summary.threshold * 100) }}% ·
          {{ run.summary.fetched }} postings fetched · {{ run.summary.kept }} kept ·
          <strong>{{ run.summary.judged }} judged of {{ run.summary.kept }}</strong> ·
          {{ run.summary.input_tokens }} tokens
        </p>

        <p
          v-if="run.summary.judged > 0 && run.summary.judged < run.summary.kept"
          class="empty"
        >
          Scoring budget of this profile: {{ run.summary.budget }} judgements per run. The other
          {{ run.summary.kept - run.summary.judged }} kept postings were not judged: raise
          <code>scoring_budget</code> in the profile to include them.
        </p>

        <p v-if="run.summary.selected.length === 0 && run.summary.judged === 0" class="empty">
          No judgement in this run: the dry run fetches and filters but spends no tokens.
          Press <strong>Search now</strong> to judge the {{ run.summary.kept }} kept postings.
        </p>
        <p v-else-if="run.summary.selected.length === 0" class="empty">
          Nothing above the threshold in this run. That is the product working, not an error:
          two excellent postings are better than a hundred useless ones.
        </p>

        <ul class="results">
          <li v-for="item in run.summary.selected" :key="item.key">
            <span class="score" :class="{ good: percent(item.probability) >= 90 }">
              {{ percent(item.probability) }}%
            </span>
            <div class="body">
              <a href="#" @click.prevent="openPosting(item.url)">{{ item.title }}</a>
              <p class="sub">
                {{ item.company ?? 'azienda non indicata' }} · {{ item.source }} ·
                {{ verdictLabel(item.verdict) }} · {{ stackLabel(item.stack_stance) }}
              </p>
              <p v-if="item.gaps.length > 0" class="gap">gap dichiarato: {{ item.gaps.join(', ') }}</p>
              <button
                type="button"
                :disabled="reports[item.key]?.busy === true"
                @click="openReport(item.key)"
              >
                {{ reports[item.key]?.busy ? 'Report in corso…' : 'Report' }}
              </button>
              <p v-if="reportReason(item.key) !== null" class="gap">
                Report non disponibile: {{ reportReason(item.key) }}
              </p>
              <div v-if="reportMarkdown(item.key) !== null" class="report" v-html="renderMarkdown(reportMarkdown(item.key) ?? '')"></div>
              <button
                type="button"
                :disabled="tailored[item.key]?.busy === true"
                @click="openTailored(item.key)"
              >
                {{ tailored[item.key]?.busy ? 'CV in preparazione…' : 'CV su misura' }}
              </button>
              <p v-if="tailoredReason(item.key) !== null" class="gap">
                CV non disponibile: {{ tailoredReason(item.key) }}
              </p>
              <p v-if="tailoredPdf(item.key) !== null" class="sub">PDF salvato in: {{ tailoredPdf(item.key) }}</p>
              <button
                v-if="tailoredPdf(item.key) !== null"
                type="button"
                :disabled="downloads[item.key]?.busy === true"
                @click="downloadTailored(item.key)"
              >
                {{ downloads[item.key]?.busy ? 'Scaricamento…' : 'Scarica PDF' }}
              </button>
              <p v-if="downloads[item.key]?.path" class="sub">Scaricato in: {{ downloads[item.key]?.path }}</p>
              <p v-if="downloads[item.key]?.reason" class="gap">Download non riuscito: {{ downloads[item.key]?.reason }}</p>
              <div v-if="tailoredMarkdown(item.key) !== null" class="report" v-html="renderMarkdown(tailoredMarkdown(item.key) ?? '')"></div>
            </div>
          </li>
        </ul>

        <p v-if="run.summary.dropped.length > 0" class="dropped">
          scartati:
          <span v-for="drop in run.summary.dropped" :key="drop.reason" class="chip">
            {{ drop.reason }} {{ drop.count }}
          </span>
        </p>

        <p class="path">{{ run.evidence_path }}</p>
      </template>
    </section>

    <section v-else-if="tab === 'settings'">
      <div class="actions">
        <button type="button" @click="editingProfile = true">{{ t('action.editProfile') }}</button>
      </div>
      <OnboardingWizard
        v-if="editingProfile"
        mode="edit"
        @done="editingProfile = false"
        @cancel="editingProfile = false"
      />
      <LeadSettings />
      <h2>Servizio AI</h2>
      <div v-if="providerChoice !== null" class="choice">
        <label for="llm-provider">modello per leggere il CV e cercare</label>
        <select id="llm-provider" v-model="providerChoice.llm_provider" @change="onProviderChange">
          <optgroup :label="t('settings.cli.apiGroup')">
            <option v-for="name in LLM_OPTIONS" :key="name" :value="name">{{ name }}</option>
          </optgroup>
          <optgroup :label="t('settings.cli.group')">
            <option v-for="name in CLI_PROVIDERS" :key="name" :value="name">{{ CLI_NAMES[name].name }}</option>
          </optgroup>
        </select>
        <template v-if="isCliProvider(providerChoice.llm_provider)">
          <input id="llm-model" v-model="providerChoice.llm_model" type="text" :aria-label="t('settings.cli.model')" :placeholder="t('settings.cli.model')" />
          <button type="button" @click="checkPrograms">{{ t('settings.cli.check') }}</button>
          <p v-if="cliStatusLine(providerChoice.llm_provider) !== ''" class="hint">{{ cliStatusLine(providerChoice.llm_provider) }}</p>
          <p class="hint">{{ t('settings.cli.hint') }}</p>
        </template>
        <template v-else>
          <select id="llm-model" v-model="providerChoice.llm_model">
            <option v-for="name in modelOptions(offeredModels[providerChoice.llm_provider] ?? [], providerChoice.llm_model)" :key="name" :value="name">{{ name }}</option>
          </select>
          <button type="button" @click="loadModels(providerChoice.llm_provider)">Aggiorna elenco</button>
        </template>

        <label for="judgment-service">servizio che giudica le offerte</label>
        <select id="judgment-service" v-model="providerChoice.judgment_service">
          <option v-for="name in JUDGMENT_OPTIONS" :key="name" :value="name">{{ name === 'provider' ? t('settings.judge.provider') : name }}</option>
        </select>
        <input
          v-if="providerChoice.judgment_service !== 'typesafe' && providerChoice.judgment_service !== 'provider'"
          v-model="providerChoice.judgment_model"
          type="text"
          placeholder="nome del modello"
        />
        <select v-else-if="providerChoice.judgment_service === 'typesafe'" v-model="providerChoice.judgment_model">
          <option v-for="name in modelOptions(offeredModels['typesafe'] ?? [], providerChoice.judgment_model)" :key="name" :value="name">{{ name }}</option>
        </select>
        <input
          v-if="providerChoice.judgment_service === 'laya'"
          v-model="providerChoice.judgment_address"
          type="text"
          placeholder="indirizzo dove gira Laya, es. http://127.0.0.1:9000/v1/systemone"
        />
        <label for="match-threshold">soglia di corrispondenza</label>
        <div class="threshold">
          <input id="match-threshold" v-model.number="providerChoice.match_threshold" type="range" min="1" max="100" step="1" />
          <output for="match-threshold">{{ providerChoice.match_threshold }}%</output>
        </div>
        <p class="meta threshold-note">
          Mostra le offerte con almeno questa probabilità di corrispondenza. Più è bassa, più offerte vedrai.
        </p>
        <button type="button" @click="saveChoice">Salva scelta</button>
      </div>
      <p class="status">{{ choiceMessage }}</p>

      <p class="meta">
        Le chiavi finiscono nel portachiavi di macOS, mai in un file. Il portachiavi è
        l'unico posto che l'agente legge.
      </p>
      <template v-for="account in KEY_ACCOUNTS" :key="account">
        <div class="keyrow">
          <label :for="account">
            {{ account }}
            <span v-if="keyStatus !== null" :class="keyStatus[account] === true ? 'ok' : 'missing'">
              {{ keyStatus[account] === true ? 'configurata' : 'mancante' }}
            </span>
          </label>
          <input
            :id="account"
            v-model="keyInputs[account]"
            type="password"
            autocomplete="off"
            :placeholder="account === 'typesafe' ? 'richiesta per giudicare' : 'opzionale'"
          />
          <button type="button" @click="saveKey(account)">Salva</button>
          <button type="button" @click="verifyKey(account)">Verifica</button>
        </div>
        <p v-if="keyChecks[account]" class="keycheck" :class="keyChecks[account]?.tone">
          {{ keyChecks[account]?.text }}
        </p>
      </template>
      <p class="status">{{ keyMessage }}</p>

      <SourcesPanel />

      <h2>ZipRecruiter</h2>
      <p class="meta">
        Si collega con il tuo account: l'app apre la pagina di consenso, riceve il codice e
        tiene il token nel portachiavi. Serve l'URL del metadata document che hai pubblicato.
      </p>
      <div class="keyrow">
        <label for="zipclient">client id (URL del document)</label>
        <input id="zipclient" v-model="zipClientId" type="text" placeholder="https://tuo-dominio/jobshell-client.json" />
        <button type="button" @click="connectZipRecruiter">Collega</button>
      </div>
      <div class="actions">
        <button type="button" @click="writeZipDocument">Scrivi il document da pubblicare</button>
      </div>
      <div class="keyrow">
        <label for="zipquery">cerca</label>
        <input id="zipquery" v-model="zipQuery" type="text" placeholder="rust engineer" />
        <button type="button" @click="fetchZipRecruiter">Cerca su ZipRecruiter</button>
      </div>
      <p class="status">{{ zipMessage }}</p>
    </section>

    <section v-else>
      <div class="actions">
        <button type="button" @click="enqueue">Enqueue probe task</button>
        <button type="button" @click="recover">Recover interrupted</button>
        <button type="button" @click="probeKeyring">Probe keyring</button>
      </div>
      <p v-if="keyringOk !== null" class="keyring">
        keyring round trip: {{ keyringOk ? 'ok' : 'failed' }}
      </p>
      <table>
        <thead>
          <tr><th>id</th><th>kind</th><th>state</th><th>attempts</th><th>result</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="task in tasks" :key="task.id">
            <td>{{ task.id }}</td>
            <td>{{ task.kind }}</td>
            <td>{{ task.state }}</td>
            <td>{{ task.attempts }}</td>
            <td>{{ task.result ?? '' }}</td>
            <td>
              <button
                v-if="task.state === 'queued' || task.state === 'interrupted'"
                type="button"
                @click="start(task.id)"
              >{{ task.state === 'interrupted' ? 'retry' : 'start' }}</button>
              <button v-if="task.state === 'running'" type="button" @click="fail(task.id)">fail</button>
              <!-- `failed` is terminal by choice, so it offers no way out. -->
              <button
                v-if="task.state !== 'done' && task.state !== 'failed'"
                type="button"
                @click="finish(task.id)"
              >finish</button>
            </td>
          </tr>
          <tr v-if="tasks.length === 0"><td colspan="6">no tasks yet</td></tr>
        </tbody>
      </table>
    </section>
    </template>
  </main>
</template>

<style scoped>
main {
  font-family: ui-sans-serif, system-ui, sans-serif;
  margin: 1.25rem 1.5rem;
  color: var(--fg);
}
header {
  display: flex;
  align-items: baseline;
  gap: 1rem;
}
h2 {
  font-size: 0.95rem;
  margin: 1.6rem 0 0.4rem;
}
h1 {
  font-size: 1.05rem;
  letter-spacing: 0.02em;
  margin: 0;
}
nav {
  display: flex;
  gap: 0.4rem;
}
nav button {
  font: inherit;
  padding: 0.25rem 0.6rem;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg);
  cursor: pointer;
}
nav button.on {
  background: var(--cta);
  color: var(--cta-fg);
  border-color: var(--cta);
}
.status {
  margin-left: auto;
  font-family: ui-monospace, monospace;
  font-size: 0.75rem;
  color: var(--fg-muted);
}
.hint {
  font-size: 0.78rem;
  color: var(--fg-muted);
  margin: 0 0 0.8rem;
}
.meta {
  font-size: 0.85rem;
  color: var(--fg-muted);
}
.empty {
  font-size: 0.9rem;
  color: var(--fg-muted);
  max-width: 42rem;
}
.results {
  list-style: none;
  padding: 0;
  margin: 0;
}
.results li {
  display: flex;
  gap: 0.9rem;
  padding: 0.7rem 0;
  border-bottom: 1px solid var(--border);
}
.score {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--fg-muted);
  min-width: 3.2rem;
}
.score.good {
  color: #166534;
}
.body a {
  color: var(--accent);
  font-weight: 600;
  text-decoration: none;
}
.body a:hover {
  text-decoration: underline;
}
.sub {
  margin: 0.15rem 0 0;
  font-size: 0.8rem;
  color: var(--fg-muted);
}
.report {
  margin: 0.5rem 0 0;
  padding: 0.75rem;
  max-width: 100%;
  overflow-x: auto;
  font-size: 0.85rem;
  line-height: 1.5;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}
.report :deep(h1),
.report :deep(h2),
.report :deep(h3) {
  margin: 0.8rem 0 0.3rem;
  font-size: 0.95rem;
}
.report :deep(p),
.report :deep(ul),
.report :deep(ol) {
  margin: 0.3rem 0;
}
.report :deep(ul),
.report :deep(ol) {
  padding-left: 1.2rem;
}

.gap {
  margin: 0.15rem 0 0;
  font-size: 0.8rem;
  color: #9a3412;
}
.dropped {
  font-size: 0.8rem;
  color: var(--fg-muted);
}
.chip {
  display: inline-block;
  margin-right: 0.4rem;
  padding: 0 0.4rem;
  border-radius: 9999px;
  background: var(--bg-raised);
}
.path {
  font-family: ui-monospace, monospace;
  font-size: 0.7rem;
  color: var(--fg-muted);
  margin-top: 1.2rem;
}
.choice {
  display: grid;
  grid-template-columns: 14rem 1fr auto;
  gap: 0.5rem 0.6rem;
  align-items: center;
  margin: 0.6rem 0;
}
.choice label {
  font-weight: 600;
  font-size: 0.85rem;
}
.threshold {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.threshold-note {
  grid-column: 1 / -1;
}
.choice select,
.choice input {
  padding: 0.35rem 0.5rem;
  font: inherit;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.keycheck {
  margin: -0.2rem 0 0.6rem 12.6rem;
  font-size: 0.8rem;
  color: var(--muted, #555);
}
.keycheck.ok {
  color: #166534;
}
.keycheck.bad {
  color: #9a3412;
}
.keyrow {
  display: grid;
  grid-template-columns: 12rem 1fr auto auto;
  gap: 0.6rem;
  align-items: center;
  margin: 0.6rem 0;
}
.keyrow label {
  font-weight: 600;
  font-size: 0.85rem;
}
.keyrow input {
  padding: 0.35rem 0.5rem;
  font: inherit;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.keyrow button {
  font: inherit;
  padding: 0.3rem 0.7rem;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-raised);
  cursor: pointer;
}
.ok {
  color: #166534;
  font-weight: 400;
  font-size: 0.75rem;
  margin-left: 0.4rem;
}
.missing {
  color: #9a3412;
  font-weight: 400;
  font-size: 0.75rem;
  margin-left: 0.4rem;
}
.actions {
  display: flex;
  gap: 0.5rem;
  margin: 0.6rem 0 1rem;
}
.actions button {
  font: inherit;
  padding: 0.4rem 0.8rem;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-raised);
  cursor: pointer;
}
table {
  border-collapse: collapse;
  width: 100%;
  font-size: 0.9rem;
}
th,
td {
  text-align: left;
  padding: 0.35rem 0.5rem;
  border-bottom: 1px solid var(--border);
}
.keyring {
  font-size: 0.85rem;
}
code {
  font-family: ui-monospace, monospace;
  font-size: 0.85em;
  background: var(--bg-raised);
  padding: 0 0.25rem;
  border-radius: 4px;
}
</style>
