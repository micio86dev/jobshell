<script setup lang="ts">
// The first-run wizard and the later edit of the profile. Pure rules live in wizard.ts, the
// boundary schemas in schema.ts and the messages in i18n; this component wires them to Tauri.
import { computed, onMounted, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';

import { keyOf, languageName, setPrimaryLanguage, systemLanguageCode, t } from '../i18n/store';
import type { MessageKey } from '../i18n/locale';
import { readCvFile } from './cv-file';
import { isPortfolioLink, parseCheckResult } from './portfolio-link';
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
  applyPortfolioLanguages,
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
const accepted = ref({ headline: true, capabilities: true, seniority: true, years_experience: true });

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

const capabilitiesText = computed({
  get: () => draft.value.capabilities.join(', '),
  set: (text: string) => (draft.value.capabilities = listFrom(text)),
});
const remoteCountriesText = computed({
  get: () => draft.value.location.remote_countries.join(', '),
  set: (text: string) => (draft.value.location.remote_countries = listFrom(text, true)),
});
const onsiteCitiesText = computed({
  get: () => draft.value.location.onsite_cities.join(', '),
  set: (text: string) => (draft.value.location.onsite_cities = listFrom(text)),
});
const employeeCountriesText = computed({
  get: () => draft.value.location.employee_countries.join(', '),
  set: (text: string) => (draft.value.location.employee_countries = listFrom(text, true)),
});
const contractorCountriesText = computed({
  get: () => draft.value.location.contractor_countries.join(', '),
  set: (text: string) => (draft.value.location.contractor_countries = listFrom(text, true)),
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
    proposal.value = next;
    if (next?.source === 'fallback') notice.value = t('notice.noProposal', { reason: next.reason ?? t('notice.reasonNotStated') });
  } catch (error) {
    notice.value = t('notice.analysisFailed', { reason: errorText(error) });
    proposal.value = null;
  } finally {
    busy.value = false;
  }
};

const cvFileName = ref('');

const onCvFile = async (event: Event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    draft.value.cv = await readCvFile(file);
    cvFileName.value = file.name;
    proposal.value = null;
    notice.value = '';
  } catch (error) {
    cvFileName.value = '';
    notice.value = t('notice.analysisFailed', { reason: errorText(error) });
  }
};

const applySelectedProposal = () => {
  if (!proposal.value) return;
  const chosen: CvProposal = {
    source: proposal.value.source,
    reason: proposal.value.reason,
    fields: {
      headline: accepted.value.headline ? proposal.value.fields.headline : null,
      capabilities: accepted.value.capabilities ? proposal.value.fields.capabilities : [],
      domains: [],
      seniority: accepted.value.seniority ? proposal.value.fields.seniority : null,
      years_experience: accepted.value.years_experience ? proposal.value.fields.years_experience : null,
      languages: proposal.value.fields.languages,
    },
  };
  draft.value = applyProposal(draft.value, chosen);
  notice.value = t('notice.applied');
  goTo('work');
};

const checkPortfolio = async () => {
  const link = draft.value.portfolio.trim();
  if (!isPortfolioLink(link)) {
    notice.value = t('portfolio.invalid');
    return;
  }
  busy.value = true;
  try {
    const check = parseCheckResult(await invoke<string>('portfolio_check', { link }));
    if (check === null || !check.reachable) {
      notice.value = t('portfolio.unreachable');
      return;
    }
    // The reachability verdict stays on screen: the language notice is added to it, never replaces it.
    notice.value = t('portfolio.reachable');
    if (check.text.trim() !== '') {
      const next = readProposal(await invoke<string>('cv_extract', { cv: check.text, kind: 'portfolio' }));
      if (next !== null && next.source === 'model') {
        draft.value = applyPortfolioLanguages(draft.value, next);
        notice.value = `${notice.value} ${t('notice.portfolioApplied')}`;
      }
    }
  } catch (error) {
    notice.value = t('notice.analysisFailed', { reason: errorText(error) });
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
      <h2 id="wizard-title">{{ mode === 'first' ? t('title.first') : t('title.edit') }}</h2>
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
      <input type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown" :aria-label="t('cv.file')" @change="onCvFile" />
      <p v-if="cvFileName" class="notice">{{ t('cv.loaded', { name: cvFileName }) }}</p>
      <div class="actions">
        <button type="button" :disabled="busy || draft.cv.trim() === ''" @click="analyseCv">{{ t('action.analyse') }}</button>
        <button type="button" @click="next">{{ t('action.next') }}</button>
      </div>
      <fieldset v-if="proposal && proposal.source === 'model'">
        <legend>{{ t('cv.proposal') }}</legend>
        <label><input v-model="accepted.headline" type="checkbox" /> {{ t('field.headline') }}: {{ proposal.fields.headline ?? '—' }}</label>
        <label><input v-model="accepted.capabilities" type="checkbox" /> {{ t('field.capabilities') }}: {{ proposal.fields.capabilities.join(', ') || '—' }}</label>
        <label><input v-model="accepted.seniority" type="checkbox" /> {{ t('field.seniority') }}: {{ proposal.fields.seniority ?? '—' }}</label>
        <label><input v-model="accepted.years_experience" type="checkbox" /> {{ t('field.years') }}: {{ proposal.fields.years_experience ?? '—' }}</label>
        <p v-if="proposal.fields.languages.length">
          {{ t('cv.mentions', { languages: proposal.fields.languages.map((language) => languageName(language.code)).join(', ') }) }}
        </p>
        <button type="button" @click="applySelectedProposal">{{ t('action.applyChosen') }}</button>
      </fieldset>
      <fieldset>
        <legend>{{ t('portfolio.title') }}</legend>
        <p>{{ t('portfolio.intro') }}</p>
        <input v-model="draft.portfolio" type="url" inputmode="url" :aria-label="t('portfolio.url')" placeholder="https://" />
        <div class="actions">
          <button type="button" :disabled="busy || draft.portfolio.trim() === ''" @click="checkPortfolio">{{ t('portfolio.check') }}</button>
        </div>
      </fieldset>
    </div>

    <!-- Work -->
    <div v-else-if="step === 'work'" class="pane">
      <label>{{ t('field.headline') }} <input v-model="draft.headline" type="text" maxlength="60" /></label>
      <label>{{ t('field.capabilities') }} <input v-model="capabilitiesText" type="text" /></label>
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
        <button type="button" @click="next">{{ t('action.next') }}</button>
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
      <label>
        {{ t('where.employeeCountries') }}
        <input v-model="employeeCountriesText" type="text" placeholder="IT" />
      </label>
      <label>
        {{ t('where.contractorCountries') }}
        <input v-model="contractorCountriesText" type="text" placeholder="IT" />
      </label>
      <p class="hint">{{ t('where.separateHint') }}</p>
      <div class="actions">
        <button type="button" @click="back">{{ t('action.back') }}</button>
        <button type="button" @click="next">{{ t('action.next') }}</button>
        <button type="button" :disabled="busy" @click="saveForLater">{{ t('action.saveLater') }}</button>
      </div>
    </div>

    <!-- Languages: searched only in these, at these levels; one of them is primary -->
    <div v-else-if="step === 'languages'" class="pane">
      <p>{{ t('languages.intro') }}</p>
      <p v-if="draft.languages.items.length === 0">{{ t('languages.none') }}</p>
      <ul v-else class="list">
        <li v-for="item in draft.languages.items" :key="item.code">
          <strong>{{ languageName(item.code) }}</strong>
          <label>
            {{ t('languages.level') }}
            <select :value="item.level ?? ''" @change="setItemLevel(item.code, ($event.target as HTMLSelectElement).value)">
              <option value="">—</option>
              <option v-for="level in LANGUAGE_LEVELS" :key="level" :value="level">{{ t(keyOf('level', level)) }}</option>
            </select>
          </label>
          <label>
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
        <button type="button" @click="next">{{ t('action.summary') }}</button>
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
        <button type="button" :disabled="!finishable || busy" @click="finish">
          {{ mode === 'first' ? t('action.finish') : t('action.saveChange') }}
        </button>
        <button type="button" :disabled="busy" @click="saveForLater">{{ t('action.saveLater') }}</button>
        <button v-if="mode === 'edit'" type="button" @click="emit('cancel')">{{ t('action.cancel') }}</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.steps button.has-issues {
  border-color: #b42318;
  color: #b42318;
}
.flagged {
  color: #b42318;
}
.flagged ul {
  margin: 0.25rem 0 0.75rem 1.25rem;
}
.flagged button.link {
  background: none;
  border: 0;
  padding: 0;
  color: #b42318;
  font-weight: 600;
  text-decoration: underline;
  cursor: pointer;
}
</style>
