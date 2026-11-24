<script setup lang="ts">
// One lead as a card: who, how well it fits, why, and what to do next. Presentational: it shows what
// it is given and says what the user pressed, nothing more.
import { t } from '../i18n/store';
import { ACTIONS, confidenceLevel, scoreTone, type Action, type Lead } from './leads-model';

const props = defineProps<{ lead: Lead; busy: boolean }>();
const emit = defineEmits<{ action: [action: Action]; open: [] }>();

/** The decisions that still make sense: a dismissed or contacted lead offers to reopen, not to repeat itself. */
const offered = (): readonly Action[] =>
  props.lead.status === 'new' || props.lead.status === 'interesting'
    ? ACTIONS.filter((action) => action !== 'reopen' && !(action === 'interesting' && props.lead.status === 'interesting'))
    : ACTIONS.filter((action) => action === 'reopen' || action === 'converted');
</script>

<template>
  <article class="card" :class="scoreTone(lead.score)">
    <header>
      <span class="score" :aria-label="t('leads.score')">{{ Math.round(lead.score) }}</span>
      <div class="who">
        <h3>{{ lead.company_name }}</h3>
        <p class="meta">
          <span v-if="lead.country">{{ lead.country }} · </span>
          <span v-if="lead.website">{{ lead.website }} · </span>
          <span :class="'conf ' + confidenceLevel(lead.confidence)">
            {{ t('leads.confidence') }}: {{ t(('leads.conf.' + confidenceLevel(lead.confidence)) as 'leads.conf.high') }}
          </span>
          <span v-if="lead.status !== 'new'" class="status"> · {{ t(('leads.status.' + lead.status) as 'leads.status.new') }}</span>
        </p>
      </div>
    </header>
    <p class="why"><strong>{{ t('leads.why') }}.</strong> {{ lead.summary }}</p>
    <p class="match"><strong>{{ t('leads.match') }}.</strong> {{ lead.why_match }}</p>
    <p class="next"><strong>{{ t('leads.next') }}.</strong> {{ lead.next_action }}</p>
    <p class="meta small">{{ t('leads.completeness', { percent: Math.round(lead.completeness * 100) }) }}</p>
    <div class="buttons">
      <button type="button" class="open" @click="emit('open')">{{ t('leads.open') }}</button>
      <button v-for="action in offered()" :key="action" type="button" :disabled="busy" @click="emit('action', action)">
        {{ t(('leads.action.' + action) as 'leads.action.reopen') }}
      </button>
    </div>
  </article>
</template>

<style scoped>
.card {
  border: 1px solid var(--border);
  border-left-width: 4px;
  border-radius: var(--radius-sm);
  background: var(--bg-raised);
  padding: 0.8rem 1rem;
  margin: 0 0 0.8rem;
}
.card.strong { border-left-color: var(--accent); }
.card.good { border-left-color: var(--cta); }
.card.weak { border-left-color: var(--border); }
header { display: flex; gap: 0.8rem; align-items: center; }
.score { font-family: var(--font-mono); font-size: 1.4rem; min-width: 2.6rem; text-align: center; }
h3 { margin: 0; font-size: 1rem; }
p { margin: 0.35rem 0; font-size: 0.9rem; line-height: 1.4; }
.meta { color: var(--fg-muted); font-size: 0.8rem; margin: 0.1rem 0 0; }
.small { margin-top: 0.4rem; }
.conf.low { color: oklch(0.7 0.12 60); }
.buttons { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.6rem; }
button { font: inherit; font-size: 0.82rem; padding: 0.25rem 0.6rem; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--fg); cursor: pointer; }
button.open { background: var(--cta); color: var(--cta-fg); border-color: var(--cta); }
button:disabled { opacity: 0.5; cursor: default; }
</style>
