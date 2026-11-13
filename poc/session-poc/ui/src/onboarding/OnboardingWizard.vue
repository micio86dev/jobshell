<script setup lang="ts">
// The first-run wizard and the later edit of the profile. Pure rules live in wizard.ts, the
// boundary schemas in schema.ts and the messages in i18n; this component wires them to Tauri.
import { computed, onMounted, ref, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';

import { keyOf, languageName, setPrimaryLanguage, systemLanguageCode, t } from '../i18n/store';
import type { MessageKey } from '../i18n/locale';
import { readCvFile } from './cv-file';
import { isPortfolioLink, parseCheckResult } from './portfolio-link';
import CountryPicker from './CountryPicker.vue';
import {
  cvProposalSchema,
  draftSchema,
  storedProfileSchema,
  CONTRACT_TYPES,
  LANGUAGE_LEVELS,
  LANGUAGE_USAGE,
  REMOTE_MODES,
  REMOTE_SCOPES,
  SENIORITIES,
  STRENGTHS,
  type CvProposal,
  type LanguageLevel,
  type LanguageUsage,
} from './schema';
import {
  applyPortfolioProposal,
  applyProposal,
  applyScopeNeedsChoice,
  canFinish,
  emptyDraft,
  hydrateDraft,
  profileToDraft,
  STEP_LABEL_KEYS,
  stepOfIssue,
  stepStatus,
  summaryRows,
  toUserProfile,
  withDefaultPrimary,
  type Issue,
  type ProfilePayload,
  type WizardDraft,
} from './wizard';

type ApplyScope = 'new_only' | 'active_searches' | 'all_future';

const props = defineProps<{ mode: 'first' | 'edit' }>();
const emit = defineEmits<{ done: []; cancel: [] }>();

const STEPS = ['cv', 'work', 'location', 'languages', 'summary'] as const;
type Step = (typeof STEPS)[number];
const SCOPES: ApplyScope[] = ['new_only', 'active_searches', 'all_future'];
const LANGUAGE_CHOICES = ['en', 'it', 'es', 'fr', 'de', 'pt'] as const;

const step = ref<Step>('cv');
const draft = ref<WizardDraft>(emptyDraft());
const notice = ref('');
const issues = ref<Issue[]>([]);
const busy = ref(false);

// CV and portfolio intake: the CV text lives in the draft, the portfolio text does not
const proposal = ref<CvProposal | null>(null);

// New language row
const newCode = ref('');
const newLevel = ref<LanguageLevel | ''>('');
const newUsage = ref<LanguageUsage | ''>('');

// Edit mode: the profile as it was saved, and the scope the user picked for the change
const saved = ref<ProfilePayload | null>(null);
const applyScope = ref<ApplyScope | null>(null);

const status = computed(() => stepStatus(draft.value));
const summary = computed(() => summaryRows(draft.value));
const finishable = computed(() => canFinish(draft.value));
const stepIndex = computed(() => STEPS.indexOf(step.value));

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const issueText = (issue: Issue): string => t(issue.key, issue.params);

/** Every problem the finish would report right now, live, so the flagged steps stay current. */
const pendingIssues = computed<Issue[]>(() => {
  const result = toUserProfile(draft.value);
  return result.ok ? [] : result.issues;
});
const issuesOf = (item: Step): Issue[] =>
  item === 'summary' ? [] : pendingIssues.value.filter((issue) => stepOfIssue(issue) === item);

const stateOf = (item: Step): string =>
  item === 'work' || item === 'location' || item === 'languages' ? status.value[item] : 'empty';

const goTo = (target: Step) => {
  step.value = target;
  issues.value = [];
};
const next = () => goTo(STEPS[Math.min(stepIndex.value + 1, STEPS.length - 1)] ?? 'summary');
const back = () => goTo(STEPS[Math.max(stepIndex.value - 1, 0)] ?? 'cv');

/** Free text lists: "Rust, Python". Country codes are kept upper case. */
const listFrom = (text: string, upper = false): string[] =>
  text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => (upper ? part.toUpperCase() : part));

// The competences field keeps the text the user types, so a comma stays while more are typed.
// The list is parsed from it; the text is rebuilt from the list only when the list changes elsewhere.
const capabilitiesRaw = ref('');
const onCapabilitiesInput = (text: string) => {
  capabilitiesRaw.value = text;
  draft.value.capabilities = listFrom(text);
};
watch(
  () => draft.value.capabilities,
  (list) => {
    if (listFrom(capabilitiesRaw.value).join('\u0000') !== list.join('\u0000')) capabilitiesRaw.value = list.join(', ');
  },
  { deep: true, immediate: true },
);
const remoteCountriesText = computed({
  get: () => draft.value.location.remote_countries.join(', '),
  set: (text: string) => (draft.value.location.remote_countries = listFrom(text, true)),
});
const onsiteCitiesText = computed({
  get: () => draft.value.location.onsite_cities.join(', '),
  set: (text: string) => (draft.value.location.onsite_cities = listFrom(text)),
});

const toggle = <T extends string>(list: T[], value: T): T[] =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

const levelName = (level: LanguageLevel | null): string => (level === null ? '—' : t(keyOf('level', level)));
const usageName = (usage: LanguageUsage | null): string => (usage === null ? '—' : t(keyOf('usage', usage)));

const setItemLevel = (code: string, value: string) => {
  const item = draft.value.languages.items.find((row) => row.code === code);
  if (item) item.level = value === '' ? null : (value as LanguageLevel);
};
const setItemUsage = (code: string, value: string) => {
  const item = draft.value.languages.items.find((row) => row.code === code);
  if (item) item.usage = value === '' ? null : (value as LanguageUsage);
};

const addLanguage = () => {
  if (newCode.value === '' || newLevel.value === '' || newUsage.value === '') {
    issues.value = [{ key: 'issue.languageFieldsMissing' }];
    return;
  }
  if (draft.value.languages.items.some((item) => item.code === newCode.value)) {
    issues.value = [{ key: 'issue.languageDuplicate' }];
    return;
  }
  draft.value.languages.items.push({ code: newCode.value, level: newLevel.value, usage: newUsage.value });
  newCode.value = '';
  newLevel.value = '';
  newUsage.value = '';
  issues.value = [];
};

const removeLanguage = (code: string) => {
  draft.value.languages.items = draft.value.languages.items.filter((item) => item.code !== code);
  if (draft.value.languages.primary === code) draft.value.languages.primary = null;
};

const loadSaved = async () => {
  try {
    if (props.mode === 'edit') {
      const identity = await invoke<{ version: number; payload: string } | null>('identity_get');
      if (identity === null) return;
      const parsed = storedProfileSchema.safeParse(JSON.parse(identity.payload));
      if (!parsed.success) {
        notice.value = t('notice.profileUnreadable');
        return;
      }
      draft.value = profileToDraft(parsed.data);
      const result = toUserProfile(draft.value);
      if (result.ok) saved.value = result.profile;
      step.value = 'work';
      return;
    }
    const draftRow = await invoke<{ version: number; payload: string } | null>('draft_get');
    if (draftRow === null) return;
    const parsed = draftSchema.safeParse(JSON.parse(draftRow.payload));
    if (parsed.success) {
      draft.value = hydrateDraft(parsed.data);
      notice.value = t('notice.draftFound');
    }
  } catch (error) {
    notice.value = t('notice.draftLoadFailed', { reason: errorText(error) });
  }
};

onMounted(async () => {
  // A new profile starts with the operating system language as its primary language.
  if (props.mode === 'first') draft.value = withDefaultPrimary(draft.value, systemLanguageCode());
  await loadSaved();
  if (props.mode === 'first') draft.value = withDefaultPrimary(draft.value, systemLanguageCode());
});

const readProposal = (raw: string): CvProposal | null => {
  const parsed = cvProposalSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    notice.value = t('notice.extractorInvalid');
    return null;
  }
  return parsed.data;
};

const analyseCv = async () => {
  busy.value = true;
  notice.value = '';
  try {
    const next = readProposal(await invoke<string>('cv_extract', { cv: draft.value.cv, kind: 'cv' }));
    // The proposal fills the fields the user has not written; nothing already written is changed.
    if (next?.source === 'model') {
      draft.value = applyProposal(draft.value, next);
      notice.value = t('notice.autoFilled');
    }
    if (next?.source === 'fallback') notice.value = t('notice.noProposal', { reason: next.reason ?? t('notice.reasonNotStated') });
  } catch (error) {
    notice.value = t('notice.analysisFailed', { reason: errorText(error) });
    proposal.value = null;
  } finally {
    busy.value = false;
  }
};

const cvFileName = ref('');

const cvError = ref('');

const onCvFile = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  cvError.value = '';
  try {
    const text = await readCvFile(file);
    // A file with no readable text is refused here, so the CV is never silently left empty.
    if (text === '') {
      cvFileName.value = '';
      draft.value.cv = '';
      cvError.value = t('cv.noText');
      return;
    }
    draft.value.cv = text;
    cvFileName.value = file.name;
    proposal.value = null;
    notice.value = '';
    // The CV fills the fields as soon as it is loaded; the button only runs it again.
    await analyseCv();
  } catch (error) {
    cvFileName.value = '';
    cvError.value = t('notice.analysisFailed', { reason: errorText(error) });
  } finally {
    // Picking the same file again must fire the change event again.
    input.value = '';
  }
};


const portfolioStatus = ref<{ tone: 'ok' | 'error' | 'busy'; text: string } | null>(null);

const checkPortfolio = async () => {
  const link = draft.value.portfolio.trim();
  if (!isPortfolioLink(link)) {
    portfolioStatus.value = { tone: 'error', text: t('portfolio.invalid') };
    return;
  }
  busy.value = true;
  portfolioStatus.value = { tone: 'busy', text: t('portfolio.checking') };
  try {
    const check = parseCheckResult(await invoke<string>('portfolio_check', { link }));
    if (check === null || !check.reachable) {
      portfolioStatus.value = { tone: 'error', text: t('portfolio.unreachable') };
      return;
    }
    let text = t('portfolio.reachable');
    if (check.text.trim() !== '') {
      const next = readProposal(await invoke<string>('cv_extract', { cv: check.text, kind: 'portfolio' }));
      if (next !== null && next.source === 'model') {
        draft.value = applyPortfolioProposal(draft.value, next);
        text = `${text} ${t('notice.portfolioApplied')}`;
      }
    }
    portfolioStatus.value = { tone: 'ok', text };
  } catch (error) {
    portfolioStatus.value = { tone: 'error', text: t('notice.analysisFailed', { reason: errorText(error) }) };
  } finally {
    busy.value = false;
  }
};


const saveForLater = async () => {
  busy.value = true;
  try {
    await invoke<number>('draft_save', { payload: JSON.stringify(draft.value) });
    notice.value = t('notice.draftSaved');
  } catch (error) {
    notice.value = t('notice.saveDraftFailed', { reason: errorText(error) });
  } finally {
    busy.value = false;
  }
};

const finish = async () => {
  const result = toUserProfile(draft.value);
  if (!result.ok) {
    issues.value = result.issues;
    return;
  }
  const profile = result.profile;
  const changed = saved.value === null || applyScopeNeedsChoice(saved.value, profile);
  if (props.mode === 'edit' && changed && applyScope.value === null) {
    issues.value = [{ key: 'issue.scopeNeeded' }];
    return;
  }
  busy.value = true;
  try {
    await invoke<number>('identity_save', {
      payload: JSON.stringify(profile),
      applyScope: applyScope.value ?? 'new_only',
    });
    if (props.mode === 'first') await invoke('onboarding_complete');
    setPrimaryLanguage(profile.primary_language);
    emit('done');
  } catch (error) {
    issues.value = [{ key: 'issue.notSaved', params: { reason: errorText(error) } }];
  } finally {
    busy.value = false;
  }
};

/** The label of a summary row: plain text, or the translated enumerated values it names. */
const rowValue = (row: (typeof summary.value)[number]): string => {
  if (row.kind === 'characters') return row.value === null ? t('field.notStated') : t('summary.cvCharacters', { count: row.value });
  if (row.codes !== undefined) {
    if (row.codes.length === 0) return t('field.notStated');
    return row.codes
      .map((code) => {
        if (row.kind === 'contract') return t(keyOf('contract', code));
        if (row.kind === 'mode') return t(keyOf('mode', code));
        if (row.kind === 'scope') return t(keyOf('scope', code));
        return languageName(code);
      })
      .join(', ');
  }
  return row.value ?? t('field.notStated');
};

const applyLabel = (scope: ApplyScope): string => t(`apply.${scope}.label` as MessageKey);
const applyHelp = (scope: ApplyScope): string => t(`apply.${scope}.help` as MessageKey);
</script>

<template>
  <section class="wizard" aria-labelledby="wizard-title">
    <header>
      <h1 v-if="mode === 'first'" id="wizard-title">{{ t('title.first') }}</h1>
      <h2 v-else id="wizard-title">{{ t('title.edit') }}</h2>
      <nav class="steps" :aria-label="t('steps.aria')">
        <button
          v-for="(item, index) in STEPS"
          :key="item"
          type="button"
          :class="[{ on: step === item, 'has-issues': issuesOf(item).length > 0 }, stateOf(item)]"
          :aria-current="step === item ? 'step' : undefined"
          @click="goTo(item)"
        >
          {{ index + 1 }}. {{ t(STEP_LABEL_KEYS[item]) }}
        </button>
      </nav>
    </header>

    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <ul v-if="issues.length" class="issues" role="alert">
      <li v-for="issue in issues" :key="issue.key">{{ issueText(issue) }}</li>
    </ul>

    <!-- CV first: required to finish; the analysis proposes fields the user can refuse -->
    <div v-if="step === 'cv'" class="pane">
      <p>{{ t('cv.intro') }}</p>
      <label class="file-button">
        {{ t('cv.file') }}
        <input class="sr-only" type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown" @change="onCvFile" />
      </label>
      <p v-if="cvFileName" class="notice">{{ t('cv.loaded', { name: cvFileName }) }}</p>
      <p v-if="cvError" class="notice error" role="alert">{{ cvError }}</p>
      <div class="actions">
        <button type="button" :disabled="busy || draft.cv.trim() === ''" @click="analyseCv">{{ t('action.analyse') }}</button>
        <button type="button" class="primary" @click="next">{{ t('action.next') }}</button>
      </div>
      <fieldset>
        <legend>{{ t('portfolio.title') }}</legend>
        <p>{{ t('portfolio.intro') }}</p>
        <input v-model="draft.portfolio" type="url" inputmode="url" :aria-label="t('portfolio.url')" placeholder="https://" />
        <div class="actions">
          <button type="button" :disabled="busy || draft.portfolio.trim() === ''" @click="checkPortfolio">{{ t('portfolio.check') }}</button>
        </div>
        <p v-if="portfolioStatus" class="notice" :class="portfolioStatus.tone" role="status">{{ portfolioStatus.text }}</p>
      </fieldset>
    </div>

    <!-- Work -->
    <div v-else-if="step === 'work'" class="pane">
      <label>{{ t('field.headline') }} <input v-model="draft.headline" type="text" maxlength="60" /></label>
      <label>{{ t('field.capabilities') }} <input :value="capabilitiesRaw" type="text" @input="onCapabilitiesInput(($event.target as HTMLInputElement).value)" /></label>
      <div class="row">
      <label>
        {{ t('field.seniority') }}
        <select v-model="draft.seniority">
          <option :value="null">{{ t('field.notStated') }}</option>
          <option v-for="level in SENIORITIES" :key="level" :value="level">{{ level }}</option>
        </select>
      </label>
      <label>
        {{ t('field.years') }}
        <input
          type="number"
          min="0"
          max="60"
          :value="draft.years_experience ?? ''"
          @input="draft.years_experience = ($event.target as HTMLInputElement).value === '' ? null : Number(($event.target as HTMLInputElement).value)"
        />
      </label>
      </div>
      <fieldset>
        <legend>{{ t('work.contract') }}</legend>
        <label v-for="type in CONTRACT_TYPES" :key="type">
          <input
            type="checkbox"
            :checked="draft.work.contract_types.includes(type)"
            @change="draft.work.contract_types = toggle(draft.work.contract_types, type)"
          />
          {{ t(keyOf('contract', type)) }}
        </label>
      </fieldset>
      <label>
        {{ t('work.strength') }}
        <select v-model="draft.work.strength">
          <option v-for="value in STRENGTHS" :key="value" :value="value">{{ t(keyOf('strength', value)) }}</option>
        </select>
      </label>
      <div class="actions">
        <button type="button" @click="back">{{ t('action.back') }}</button>
        <button type="button" class="primary" @click="next">{{ t('action.next') }}</button>
        <button type="button" :disabled="busy" @click="saveForLater">{{ t('action.saveLater') }}</button>
      </div>
    </div>

    <!-- Where: remote needs an explicit scope, never worldwide by default -->
    <div v-else-if="step === 'location'" class="pane">
      <fieldset>
        <legend>{{ t('where.workModes') }}</legend>
        <label v-for="mode in REMOTE_MODES" :key="mode">
          <input
            type="checkbox"
            :checked="draft.location.remote_modes.includes(mode)"
            @change="draft.location.remote_modes = toggle(draft.location.remote_modes, mode)"
          />
          {{ t(keyOf('mode', mode)) }}
        </label>
      </fieldset>
      <template v-if="draft.location.remote_modes.includes('remote')">
        <label>
          {{ t('where.remoteScope') }}
          <select v-model="draft.location.remote_scope">
            <option :value="null">{{ t('where.chooseScope') }}</option>
            <option v-for="scope in REMOTE_SCOPES" :key="scope" :value="scope">{{ t(keyOf('scope', scope)) }}</option>
          </select>
        </label>
        <label v-if="draft.location.remote_scope === 'countries'">
          {{ t('where.remoteCountries') }}
          <input v-model="remoteCountriesText" type="text" placeholder="IT, DE" />
        </label>
        <label v-if="draft.location.remote_scope === 'residence'">
          {{ t('where.residence') }}
          <input v-model="draft.location.residence" type="text" maxlength="2" placeholder="IT" />
        </label>
      </template>
      <label>{{ t('where.onsiteCities') }} <input v-model="onsiteCitiesText" type="text" /></label>
      <div class="row">
        <CountryPicker v-model="draft.location.employee_countries" :label="t('where.employeeCountries')" />
        <CountryPicker v-model="draft.location.contractor_countries" :label="t('where.contractorCountries')" />
      </div>
      <p class="hint">{{ t('where.separateHint') }}</p>
      <div class="actions">
        <button type="button" @click="back">{{ t('action.back') }}</button>
        <button type="button" class="primary" @click="next">{{ t('action.next') }}</button>
        <button type="button" :disabled="busy" @click="saveForLater">{{ t('action.saveLater') }}</button>
      </div>
    </div>

    <!-- Languages: searched only in these, at these levels; one of them is primary -->
    <div v-else-if="step === 'languages'" class="pane">
      <p>{{ t('languages.intro') }}</p>
      <p v-if="draft.languages.items.length === 0">{{ t('languages.none') }}</p>
      <ul v-else class="list">
        <li v-for="item in draft.languages.items" :key="item.code">
          <strong class="lang-name">{{ languageName(item.code) }}</strong>
          <label class="inline">
            {{ t('languages.level') }}
            <select :value="item.level ?? ''" @change="setItemLevel(item.code, ($event.target as HTMLSelectElement).value)">
              <option value="">—</option>
              <option v-for="level in LANGUAGE_LEVELS" :key="level" :value="level">{{ t(keyOf('level', level)) }}</option>
            </select>
          </label>
          <label class="inline">
            {{ t('languages.usage') }}
            <select :value="item.usage ?? ''" @change="setItemUsage(item.code, ($event.target as HTMLSelectElement).value)">
              <option value="">—</option>
              <option v-for="usage in LANGUAGE_USAGE" :key="usage" :value="usage">{{ t(keyOf('usage', usage)) }}</option>
            </select>
          </label>
          <span v-if="item.level === null || item.usage === null" class="hint">{{ t('languages.incomplete') }}</span>
          <button type="button" @click="removeLanguage(item.code)">{{ t('action.remove') }}</button>
        </li>
      </ul>
      <div class="row">
        <select v-model="newCode" :aria-label="t('languages.language')">
          <option value="">{{ t('languages.language') }}</option>
          <option v-for="code in LANGUAGE_CHOICES" :key="code" :value="code">{{ languageName(code) }}</option>
        </select>
        <select v-model="newLevel" :aria-label="t('languages.level')">
          <option value="">{{ t('languages.level') }}</option>
          <option v-for="level in LANGUAGE_LEVELS" :key="level" :value="level">{{ t(keyOf('level', level)) }}</option>
        </select>
        <select v-model="newUsage" :aria-label="t('languages.usage')">
          <option value="">{{ t('languages.usage') }}</option>
          <option v-for="usage in LANGUAGE_USAGE" :key="usage" :value="usage">{{ t(keyOf('usage', usage)) }}</option>
        </select>
        <button type="button" @click="addLanguage">{{ t('languages.add') }}</button>
      </div>
      <label>
        {{ t('languages.primary') }}
        <select v-model="draft.languages.primary">
          <option :value="null">—</option>
          <option v-for="item in draft.languages.items" :key="item.code" :value="item.code">{{ languageName(item.code) }}</option>
        </select>
      </label>
      <div class="actions">
        <button type="button" @click="back">{{ t('action.back') }}</button>
        <button type="button" class="primary" @click="next">{{ t('action.summary') }}</button>
        <button type="button" :disabled="busy" @click="saveForLater">{{ t('action.saveLater') }}</button>
      </div>
    </div>

    <!-- Summary: every field, unstated ones as unstated; finish only when valid -->
    <div v-else class="pane">
      <dl class="summary">
        <template v-for="row in summary" :key="row.label">
          <dt>{{ t(row.label) }}</dt>
          <dd>{{ rowValue(row) }}</dd>
        </template>
        <dt>{{ t('summary.languages') }}</dt>
        <dd>
          <template v-if="draft.languages.items.length === 0">{{ t('field.notStated') }}</template>
          <template v-else>
            {{ draft.languages.items.map((item) => `${languageName(item.code)} (${levelName(item.level)}, ${usageName(item.usage)})`).join(', ') }}
          </template>
        </dd>
      </dl>
      <fieldset v-if="mode === 'edit' && saved">
        <legend>{{ t('apply.title') }}</legend>
        <label v-for="scope in SCOPES" :key="scope" class="scope">
          <input v-model="applyScope" type="radio" name="apply-scope" :value="scope" />
          <strong>{{ applyLabel(scope) }}</strong>
          <span>{{ applyHelp(scope) }}</span>
        </label>
      </fieldset>
      <p v-if="!finishable" class="hint">{{ t('summary.stillMissing') }}</p>
      <div v-if="!finishable" class="flagged" role="alert">
        <p>{{ t('summary.flagged') }}</p>
        <template v-for="item in STEPS.slice(0, 4)" :key="item">
          <div v-if="issuesOf(item).length > 0">
            <button type="button" class="link" @click="goTo(item)">{{ t(STEP_LABEL_KEYS[item]) }}</button>
            <ul>
              <li v-for="issue in issuesOf(item)" :key="issue.key">{{ issueText(issue) }}</li>
            </ul>
          </div>
        </template>
      </div>
      <div class="actions">
        <button type="button" @click="back">{{ t('action.back') }}</button>
        <button type="button" class="primary" :disabled="!finishable || busy" @click="finish">
          {{ mode === 'first' ? t('action.finish') : t('action.saveChange') }}
        </button>
        <button type="button" :disabled="busy" @click="saveForLater">{{ t('action.saveLater') }}</button>
        <button v-if="mode === 'edit'" type="button" @click="emit('cancel')">{{ t('action.cancel') }}</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* Restrained palette: tinted neutrals and one accent. Dark mode follows the system setting. */
.wizard {
  --surface: var(--bg);
  --panel: var(--bg-raised);
  --ink: var(--fg);
  --muted: var(--fg-muted);
  --line: var(--border);
  --accent-hover: var(--accent);
  --on-accent: var(--cta-fg);
  --danger-strong: oklch(0.46 0.17 27);
  --danger: oklch(0.43 0.17 27);
  --danger-tint: oklch(0.96 0.02 27);
  --info-tint: var(--accent-soft);
  max-width: 42rem;
  margin: 0 auto;
  padding: 1.25rem 1rem 2rem;
  font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  font-size: 0.95rem;
  line-height: 1.5;
  color: var(--ink);
  background: var(--surface);
  display: grid;
  gap: 1rem;
}
@media (prefers-color-scheme: dark) {
  .wizard {
    --danger: oklch(0.78 0.14 27);
    --danger-tint: oklch(0.28 0.04 27);
  }
}

header {
  display: grid;
  gap: 0.75rem;
}
h2 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 650;
  letter-spacing: -0.01em;
}

/* Steps: a row of pills that wraps on a narrow screen. */
.steps {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.steps button {
  font: inherit;
  font-size: 0.875rem;
  padding: 0.35rem 0.75rem;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink);
  cursor: pointer;
}
.steps button.on {
  background: var(--cta);
  color: var(--cta-fg);
  border-color: var(--cta);
}
.steps button.has-issues {
  border-color: var(--danger);
  color: var(--danger);
}
.steps button.on.has-issues {
  color: var(--cta-fg);
  background: var(--danger-strong);
  border-color: var(--danger-strong);
}

/* One step at a time: a panel with the fields in a single column. */
.pane {
  display: grid;
  gap: 1rem;
  padding: 1.25rem;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel);
}
.pane > p {
  margin: 0;
  color: var(--muted);
}
label {
  display: grid;
  gap: 0.3rem;
  font-weight: 500;
}
label:has(> input[type="checkbox"]),
label:has(> input[type="radio"]) {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 400;
}
input,
select,
textarea {
  font: inherit;
  color: var(--ink);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 0.5rem 0.65rem;
  width: 100%;
  box-sizing: border-box;
}
input[type="checkbox"],
input[type="radio"] {
  width: auto;
  margin: 0;
  accent-color: var(--accent);
}
textarea {
  resize: vertical;
}
input:focus-visible,
select:focus-visible,
textarea:focus-visible,
button:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

fieldset {
  display: grid;
  gap: 0.6rem;
  margin: 0;
  padding: 0.9rem 1rem;
  border: 1px solid var(--line);
  border-radius: 10px;
  min-width: 0;
}
legend {
  padding: 0 0.35rem;
  font-weight: 600;
}

.row {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.4rem;
}

/* Actions: the button that moves forward is marked primary; the others stay quiet. */
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  justify-content: flex-end;
}
.actions button,
.wizard button:not(.steps button):not(.link) {
  font: inherit;
  padding: 0.5rem 1rem;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink);
  cursor: pointer;
}
.wizard .actions button.primary:not(:disabled) {
  background: var(--cta);
  border-color: var(--cta);
  color: var(--cta-fg);
}
.wizard .actions button.primary:not(:disabled) {
  transition: background-color 160ms ease, transform 160ms ease, box-shadow 160ms ease;
}
.wizard .actions button.primary:not(:disabled):hover {
  background: var(--cta-hover);
  box-shadow: 0 8px 18px -10px var(--cta);
}
.wizard .actions button.primary:not(:disabled):active {
  transform: scale(0.98);
  box-shadow: none;
}
.actions button:hover:not(:disabled) {
  background: var(--panel);
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
button.link {
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  color: var(--accent);
  text-decoration: underline;
  cursor: pointer;
}

/* Messages: a notice for what happened, a hint for what to do, issues in red. */
.notice {
  margin: 0;
  padding: 0.6rem 0.8rem;
  border-radius: 8px;
  background: var(--info-tint);
}
.hint {
  margin: 0;
  color: var(--muted);
  font-size: 0.9rem;
}
.issues {
  margin: 0;
  padding: 0.6rem 0.8rem 0.6rem 2rem;
  border: 1px solid var(--danger);
  border-radius: 8px;
  background: var(--danger-tint);
  color: var(--danger);
}
.flagged {
  display: grid;
  gap: 0.5rem;
  padding: 0.9rem 1rem;
  border: 1px solid var(--danger);
  border-radius: 10px;
  background: var(--danger-tint);
  color: var(--danger);
}
.flagged p {
  margin: 0;
  font-weight: 600;
}
.flagged ul {
  margin: 0 0 0.5rem 1.25rem;
}

/* The summary: a label column and a value column, one column on a narrow screen. */
.summary {
  display: grid;
  grid-template-columns: minmax(8rem, 13rem) 1fr;
  gap: 0.55rem 1rem;
  margin: 0;
  padding: 1.25rem;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel);
}
.summary dt {
  color: var(--muted);
}
.summary dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.scope {
  display: grid;
  gap: 0.15rem;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
}
.scope span {
  color: var(--muted);
  font-size: 0.9rem;
}

@media (max-width: 30rem) {
  .wizard {
    padding: 1rem 0.75rem 1.5rem;
  }
  .pane {
    padding: 1rem;
  }
  .summary {
    grid-template-columns: 1fr;
    padding: 1rem;
  }
  .summary dt {
    margin-top: 0.4rem;
  }
  .actions button {
    flex: 1 1 auto;
  }
}

/* Result rows: one line per item, with its fields side by side and no gap between items. */
.list {
  gap: 0;
}
.list li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.75rem;
  padding: 0.45rem 0;
  border-bottom: 1px solid var(--line, #e5e5e0);
}
.list .lang-name {
  min-width: 6.5rem;
}
label.inline {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-weight: 400;
}
label.inline select {
  width: auto;
  min-width: 9rem;
}
.row > label,
.row > .country-picker {
  min-width: 0;
}

/* Larger controls: the choice and text fields are easy to hit and read. */
input:not([type='checkbox']):not([type='radio']):not(.sr-only),
select {
  min-height: 2.75rem;
  font-size: 1rem;
}
select {
  padding: 0.55rem 0.7rem;
}
.file-button {
  display: inline-flex;
  align-items: center;
  min-height: 2.75rem;
  padding: 0.55rem 1rem;
  border-radius: 8px;
  border: 1px solid var(--line, #ccc);
  cursor: pointer;
  font-weight: 600;
  width: fit-content;
}
.file-button:focus-within {
  outline: 2px solid var(--accent, #1f6f4a);
  outline-offset: 2px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.notice.ok {
  color: var(--ok, #1f6f4a);
}
.notice.error {
  color: var(--error, #b42318);
}
.notice.busy {
  opacity: 0.8;
}
</style>
