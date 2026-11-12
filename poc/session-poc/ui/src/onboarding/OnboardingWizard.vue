<script setup lang="ts">
// The first-run wizard and the later edit of the profile. Pure rules live in wizard.ts and the
// boundary schemas in schema.ts; this component only wires them to the Tauri commands.
import { computed, onMounted, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';

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
  type Strength,
} from './schema';
import {
  applyProposal,
  applyScopeNeedsChoice,
  canFinish,
  emptyDraft,
  hydrateDraft,
  profileToDraft,
  proposedLanguageCodes,
  stepStatus,
  summaryLines,
  toUserProfile,
  type ProfilePayload,
  type WizardDraft,
} from './wizard';

type ApplyScope = 'new_only' | 'active_searches' | 'all_future';

const props = defineProps<{ mode: 'first' | 'edit' }>();
const emit = defineEmits<{ done: []; cancel: [] }>();

const STEPS = ['cv', 'work', 'location', 'languages', 'summary'] as const;
type Step = (typeof STEPS)[number];
const STEP_LABELS: Record<Step, string> = {
  cv: 'CV',
  work: 'Work',
  location: 'Where',
  languages: 'Languages',
  summary: 'Summary',
};
const STRENGTH_LABELS: Record<Strength, string> = {
  mandatory: 'Mandatory',
  preferred: 'Preferred',
  acceptable: 'Acceptable',
};
const CONTRACT_LABELS: Record<string, string> = { employee: 'Employee', freelance: 'Freelance' };
const REMOTE_LABELS: Record<string, string> = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'Onsite' };
const SCOPE_LABELS: Record<string, string> = {
  worldwide: 'Worldwide (only if you explicitly choose it)',
  europe: 'Europe',
  countries: 'Only some countries',
  residence: 'Only from the country of residence',
};
const APPLY_SCOPES: Array<{ value: ApplyScope; label: string; help: string }> = [
  { value: 'new_only', label: 'New searches only', help: 'Existing searches stay as they are.' },
  {
    value: 'active_searches',
    label: 'Active searches',
    help: 'Active searches use the new profile; paused ones stay unchanged.',
  },
  {
    value: 'all_future',
    label: 'All future sessions',
    help: 'Paused searches too use the new profile when they resume.',
  },
];

const step = ref<Step>('cv');
const draft = ref<WizardDraft>(emptyDraft());
const notice = ref('');
const issues = ref<string[]>([]);
const busy = ref(false);

// CV intake
const cvText = ref('');
const proposal = ref<CvProposal | null>(null);
const accepted = ref<Record<'headline' | 'capabilities' | 'seniority' | 'years_experience', boolean>>({
  headline: true,
  capabilities: true,
  seniority: true,
  years_experience: true,
});

// Edit mode: the profile as it was saved, and the scope the user picked for the change
const saved = ref<ProfilePayload | null>(null);
const applyScope = ref<ApplyScope | null>(null);

const status = computed(() => stepStatus(draft.value));
const summary = computed(() => summaryLines(draft.value));
const finishable = computed(() => canFinish(draft.value));
const suggestedLanguages = computed(() => (proposal.value ? proposedLanguageCodes(proposal.value) : []));

const stepIndex = computed(() => STEPS.indexOf(step.value));

/** The state a step button shows. The summary has no state of its own. */
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

// Language row being added: nothing is preselected, so no preference is invented.
const newCode = ref('');
const newLevel = ref<LanguageLevel | ''>('');
const newUsage = ref<LanguageUsage | ''>('');
const addLanguage = () => {
  if (newCode.value === '' || newLevel.value === '' || newUsage.value === '') {
    issues.value = ['To add a language, choose the code, the level and the usage.'];
    return;
  }
  if (draft.value.languages.items.some((item) => item.code === newCode.value)) {
    issues.value = ['This language is already in the list.'];
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
};

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  it: 'Italian',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
};

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const loadSaved = async () => {
  try {
    if (props.mode === 'edit') {
      const identity = await invoke<{ version: number; payload: string } | null>('identity_get');
      if (identity === null) return;
      const parsed = storedProfileSchema.safeParse(JSON.parse(identity.payload));
      if (!parsed.success) {
        notice.value = 'The saved profile cannot be read: edit it from scratch.';
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
      notice.value = 'You have a saved draft: it is here.';
    }
  } catch (error) {
    notice.value = `Cannot read the saved profile: ${errorText(error)}`;
  }
};

onMounted(loadSaved);

const analyseCv = async () => {
  busy.value = true;
  notice.value = '';
  try {
    const raw = await invoke<string>('cv_extract', { cv: cvText.value });
    const parsed = cvProposalSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      notice.value = 'The extractor answer is not valid: nothing is proposed.';
      proposal.value = null;
      return;
    }
    proposal.value = parsed.data;
    if (parsed.data.source === 'fallback') {
      notice.value = `No proposal from the CV: ${parsed.data.reason ?? 'reason not stated'}.`;
    }
  } catch (error) {
    notice.value = `CV analysis failed: ${errorText(error)}`;
    proposal.value = null;
  } finally {
    busy.value = false;
  }
};

const onCvFile = async (event: Event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) cvText.value = await file.text();
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
      languages: [],
    },
  };
  draft.value = applyProposal(draft.value, chosen);
  notice.value = 'CV fields applied where you had not written a value.';
  goTo('work');
};

const saveForLater = async () => {
  busy.value = true;
  try {
    await invoke<number>('draft_save', { payload: JSON.stringify(draft.value) });
    notice.value = 'Draft saved. You can finish it whenever you like.';
  } catch (error) {
    notice.value = `Saving the draft failed: ${errorText(error)}`;
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
    issues.value = ['Choose which searches the change applies to.'];
    return;
  }
  busy.value = true;
  try {
    await invoke<number>('identity_save', {
      payload: JSON.stringify(profile),
      applyScope: applyScope.value ?? 'new_only',
    });
    if (props.mode === 'first') await invoke('onboarding_complete');
    emit('done');
  } catch (error) {
    issues.value = [`The profile was not saved: ${errorText(error)}`];
  } finally {
    busy.value = false;
  }
};
</script>

<template>
  <section class="wizard" aria-labelledby="wizard-title">
    <header>
      <h2 id="wizard-title">{{ mode === 'first' ? 'Set up your profile' : 'Edit profile' }}</h2>
      <nav class="steps" aria-label="Steps">
        <button
          v-for="(item, index) in STEPS"
          :key="item"
          type="button"
          :class="[{ on: step === item }, stateOf(item)]"
          :aria-current="step === item ? 'step' : undefined"
          @click="goTo(item)"
        >
          {{ index + 1 }}. {{ STEP_LABELS[item] }}
        </button>
      </nav>
    </header>

    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <ul v-if="issues.length" class="issues" role="alert">
      <li v-for="issue in issues" :key="issue">{{ issue }}</li>
    </ul>

    <!-- Step 0: CV, optional, pre-fills only what the user has not written -->
    <div v-if="step === 'cv'" class="pane">
      <p>Upload or paste your CV: I propose headline, capabilities, seniority and years. You can skip this step.</p>
      <input type="file" accept=".txt,.md,text/plain,text/markdown" @change="onCvFile" />
      <textarea v-model="cvText" rows="8" placeholder="Paste the CV text here"></textarea>
      <div class="actions">
        <button type="button" :disabled="busy || cvText.trim() === ''" @click="analyseCv">Analyse the CV</button>
        <button type="button" @click="next">Skip</button>
      </div>
      <fieldset v-if="proposal && proposal.source === 'model'">
        <legend>CV proposal: choose what to apply</legend>
        <label><input v-model="accepted.headline" type="checkbox" /> Headline: {{ proposal.fields.headline ?? '—' }}</label>
        <label><input v-model="accepted.capabilities" type="checkbox" /> Capabilities: {{ proposal.fields.capabilities.join(', ') || '—' }}</label>
        <label><input v-model="accepted.seniority" type="checkbox" /> Seniority: {{ proposal.fields.seniority ?? '—' }}</label>
        <label><input v-model="accepted.years_experience" type="checkbox" /> Years: {{ proposal.fields.years_experience ?? '—' }}</label>
        <p v-if="suggestedLanguages.length">
          The CV mentions: {{ suggestedLanguages.map((code) => LANGUAGE_NAMES[code] ?? code).join(', ') }}. Add them with level and usage in the Languages step.
        </p>
        <button type="button" @click="applySelectedProposal">Apply the chosen fields</button>
      </fieldset>
    </div>

    <!-- Step 1: work -->
    <div v-else-if="step === 'work'" class="pane">
      <label>Headline <input v-model="draft.headline" type="text" maxlength="60" /></label>
      <label>Capabilities (comma-separated) <input v-model="capabilitiesText" type="text" /></label>
      <label>
        Seniority
        <select v-model="draft.seniority">
          <option :value="null">Not stated</option>
          <option v-for="level in SENIORITIES" :key="level" :value="level">{{ level }}</option>
        </select>
      </label>
      <label>
        Years of experience
        <input
          type="number"
          min="0"
          max="60"
          :value="draft.years_experience ?? ''"
          @input="draft.years_experience = ($event.target as HTMLInputElement).value === '' ? null : Number(($event.target as HTMLInputElement).value)"
        />
      </label>
      <fieldset>
        <legend>Contract type</legend>
        <label v-for="type in CONTRACT_TYPES" :key="type">
          <input
            type="checkbox"
            :checked="draft.work.contract_types.includes(type)"
            @change="draft.work.contract_types = toggle(draft.work.contract_types, type)"
          />
          {{ CONTRACT_LABELS[type] }}
        </label>
      </fieldset>
      <label>
        How strict is the contract requirement
        <select v-model="draft.work.strength">
          <option v-for="value in STRENGTHS" :key="value" :value="value">{{ STRENGTH_LABELS[value] }}</option>
        </select>
      </label>
      <div class="actions">
        <button type="button" @click="back">Indietro</button>
        <button type="button" @click="next">Avanti</button>
        <button type="button" :disabled="busy" @click="saveForLater">Salva e continua dopo</button>
      </div>
    </div>

    <!-- Step 2: location; remote scope is asked, never assumed -->
    <div v-else-if="step === 'location'" class="pane">
      <fieldset>
        <legend>Work modes (optional)</legend>
        <label v-for="mode in REMOTE_MODES" :key="mode">
          <input
            type="checkbox"
            :checked="draft.location.remote_modes.includes(mode)"
            @change="draft.location.remote_modes = toggle(draft.location.remote_modes, mode)"
          />
          {{ REMOTE_LABELS[mode] }}
        </label>
      </fieldset>
      <template v-if="draft.location.remote_modes.includes('remote')">
        <label>
          Remote scope (required, never worldwide by default)
          <select v-model="draft.location.remote_scope">
            <option :value="null">Choose a scope</option>
            <option v-for="scope in REMOTE_SCOPES" :key="scope" :value="scope">{{ SCOPE_LABELS[scope] }}</option>
          </select>
        </label>
        <label v-if="draft.location.remote_scope === 'countries'">
          Remote countries (codes, comma-separated)
          <input v-model="remoteCountriesText" type="text" placeholder="IT, DE" />
        </label>
        <label v-if="draft.location.remote_scope === 'residence'">
          Country of residence (two-letter code)
          <input v-model="draft.location.residence" type="text" maxlength="2" placeholder="IT" />
        </label>
      </template>
      <label>Onsite cities (optional) <input v-model="onsiteCitiesText" type="text" /></label>
      <label>
        Countries where you work as an employee (optional)
        <input v-model="employeeCountriesText" type="text" placeholder="IT" />
      </label>
      <label>
        Countries where you work as a freelancer (optional)
        <input v-model="contractorCountriesText" type="text" placeholder="IT" />
      </label>
      <p class="hint">Employee and freelance stay separate. An empty field means not stated, never “everywhere”.</p>
      <div class="actions">
        <button type="button" @click="back">Indietro</button>
        <button type="button" @click="next">Avanti</button>
        <button type="button" :disabled="busy" @click="saveForLater">Salva e continua dopo</button>
      </div>
    </div>

    <!-- Step 3: languages; at least one, and mandatory -->
    <div v-else-if="step === 'languages'" class="pane">
      <p>At least one language is mandatory. A language you do not speak at the required level excludes the posting.</p>
      <ul class="list">
        <li v-for="item in draft.languages.items" :key="item.code">
          {{ LANGUAGE_NAMES[item.code] ?? item.code }} · {{ item.level }} · {{ item.usage }}
          <button type="button" @click="removeLanguage(item.code)">Remove</button>
        </li>
      </ul>
      <div class="row">
        <select v-model="newCode" aria-label="Language">
          <option value="">Language</option>
          <option v-for="(name, code) in LANGUAGE_NAMES" :key="code" :value="code">{{ name }}</option>
        </select>
        <select v-model="newLevel" aria-label="Level">
          <option value="">Level</option>
          <option v-for="level in LANGUAGE_LEVELS" :key="level" :value="level">{{ level }}</option>
        </select>
        <select v-model="newUsage" aria-label="Usage">
          <option value="">Usage</option>
          <option v-for="usage in LANGUAGE_USAGE" :key="usage" :value="usage">{{ usage }}</option>
        </select>
        <button type="button" @click="addLanguage">Add</button>
      </div>
      <label>
        Language requirement strength
        <select v-model="draft.languages.strength">
          <option v-for="value in STRENGTHS" :key="value" :value="value">{{ STRENGTH_LABELS[value] }}</option>
        </select>
      </label>
      <div class="actions">
        <button type="button" @click="back">Indietro</button>
        <button type="button" @click="next">Summary</button>
        <button type="button" :disabled="busy" @click="saveForLater">Salva e continua dopo</button>
      </div>
    </div>

    <!-- Step 4: summary and save -->
    <div v-else class="pane">
      <dl class="summary">
        <template v-for="line in summary" :key="line.label">
          <dt>{{ line.label }}</dt>
          <dd>{{ line.value }}</dd>
        </template>
      </dl>
      <fieldset v-if="mode === 'edit' && saved">
        <legend>Apply the change to</legend>
        <label v-for="option in APPLY_SCOPES" :key="option.value" class="scope">
          <input v-model="applyScope" type="radio" name="apply-scope" :value="option.value" />
          <strong>{{ option.label }}</strong>
          <span>{{ option.help }}</span>
        </label>
      </fieldset>
      <p v-if="!finishable" class="hint">Some fields are still missing: go back to the steps flagged.</p>
      <div class="actions">
        <button type="button" @click="back">Indietro</button>
        <button type="button" :disabled="!finishable || busy" @click="finish">
          {{ mode === 'first' ? 'Complete and save' : 'Save the change' }}
        </button>
        <button type="button" :disabled="busy" @click="saveForLater">Salva e continua dopo</button>
        <button v-if="mode === 'edit'" type="button" @click="emit('cancel')">Cancel</button>
      </div>
    </div>
  </section>
</template>
