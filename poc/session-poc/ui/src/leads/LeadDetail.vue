<script setup lang="ts">
// The evidence behind one lead: the score line by line, what is known and how well, where it came from,
// the public contacts, and the draft to copy. Presentational. Nothing here sends anything.
import { ref } from 'vue';

import { t } from '../i18n/store';
import ConfirmAction from './ConfirmAction.vue';
import { orderFacts, type LeadDetail } from './leads-model';

const props = defineProps<{ detail: LeadDetail }>();
const emit = defineEmits<{ close: []; forget: []; openLink: [url: string] }>();

const copied = ref<string | null>(null);

const copy = async (lang: string, text: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = lang;
  } catch {
    copied.value = null;
  }
};

const facts = (): ReturnType<typeof orderFacts> => orderFacts(props.detail.facts);
</script>

<template>
  <section class="detail">
    <header>
      <h2>{{ detail.lead.company_name }}</h2>
      <button type="button" @click="emit('close')">{{ t('leads.close') }}</button>
    </header>

    <h3>{{ t('leads.detail.scores') }}</h3>
    <ul class="lines">
      <li v-for="line in detail.scores" :key="line.name">
        <span class="pts">{{ line.points }} / {{ line.max }}</span>
        <span>{{ line.explanation }}</span>
      </li>
    </ul>

    <h3>{{ t('leads.detail.facts') }}</h3>
    <ul v-if="facts().proven.length > 0" class="facts">
      <li v-for="fact in facts().proven" :key="fact.id">
        <span class="prov" :class="fact.provenance">{{ t(('leads.prov.' + fact.provenance) as 'leads.prov.verified') }}</span>
        <strong>{{ fact.field }}</strong>: {{ fact.value }}
        <a v-if="fact.source_url" href="#" @click.prevent="emit('openLink', fact.source_url)">↗</a>
        <q v-if="fact.quote" class="quote">{{ fact.quote }}</q>
      </li>
    </ul>
    <template v-if="facts().readings.length > 0">
      <h4>{{ t('leads.detail.readings') }}</h4>
      <ul class="facts readings">
        <li v-for="fact in facts().readings" :key="fact.id"><strong>{{ fact.field }}</strong>: {{ fact.value }}</li>
      </ul>
    </template>

    <h3>{{ t('leads.detail.signals') }}</h3>
    <ul class="signals">
      <li v-for="signal in detail.signals" :key="signal.id">
        <a href="#" @click.prevent="emit('openLink', signal.url)">{{ signal.title }}</a>
        <span class="meta"> · {{ signal.source }}<span v-if="signal.published_at"> · {{ signal.published_at.slice(0, 10) }}</span></span>
      </li>
    </ul>

    <h3>{{ t('leads.detail.contacts') }}</h3>
    <p v-if="detail.contacts.length === 0" class="meta">{{ t('leads.noContacts') }}</p>
    <ul v-else class="contacts">
      <li v-for="contact in detail.contacts" :key="contact.channel + contact.value">
        <strong>{{ contact.role }}</strong><span v-if="contact.name"> · {{ contact.name }}</span> —
        <a v-if="contact.channel !== 'email'" href="#" @click.prevent="emit('openLink', contact.value)">{{ contact.value }}</a>
        <span v-else>{{ contact.value }}</span>
        <span class="meta"> · {{ t('leads.contact.verified') }}</span>
        <q class="quote">{{ contact.quote }}</q>
      </li>
    </ul>

    <h3>{{ t('leads.detail.drafts') }}</h3>
    <p class="meta">{{ t('leads.draft.notSent') }}</p>
    <p v-if="detail.drafts.length === 0" class="meta">{{ t('leads.draft.none') }}</p>
    <div v-for="draft in detail.drafts" :key="draft.lang" class="draft">
      <p class="subject">{{ draft.subject }} <span class="meta">({{ draft.lang }})</span></p>
      <pre>{{ draft.body }}</pre>
      <button type="button" @click="copy(draft.lang, draft.subject + '\n\n' + draft.body)">{{ t('leads.draft.copy') }}</button>
      <span v-if="copied === draft.lang" class="meta"> {{ t('leads.draft.copied') }}</span>
    </div>

    <h3 v-if="detail.events.length > 0">{{ t('leads.detail.events') }}</h3>
    <ul class="events">
      <li v-for="(event, index) in detail.events" :key="index">{{ event.at }} · {{ t(('leads.status.' + event.event) as 'leads.status.new') }}<span v-if="event.note"> · {{ event.note }}</span></li>
    </ul>

    <div class="forget">
      <ConfirmAction :label="t('leads.forget')" :question="t('leads.forgetConfirm', { name: detail.lead.company_name })" @confirm="emit('forget')" />
    </div>
  </section>
</template>

<style scoped>
.detail { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 1rem; margin: 0 0 1rem; background: var(--bg); }
header { display: flex; justify-content: space-between; align-items: baseline; }
h2 { font-size: 1.05rem; margin: 0; }
h3 { font-size: 0.9rem; margin: 1.1rem 0 0.35rem; }
h4 { font-size: 0.8rem; margin: 0.7rem 0 0.25rem; color: var(--fg-muted); }
ul { list-style: none; padding: 0; margin: 0; }
li { font-size: 0.85rem; margin: 0.3rem 0; line-height: 1.4; }
.pts { font-family: var(--font-mono); display: inline-block; min-width: 4.4rem; color: var(--fg-muted); }
.prov { font-size: 0.7rem; border: 1px solid var(--border); border-radius: 4px; padding: 0 0.3rem; margin-right: 0.4rem; text-transform: uppercase; }
.prov.verified { border-color: var(--accent); color: var(--accent); }
.readings li { color: var(--fg-muted); font-style: italic; }
.quote { display: block; color: var(--fg-muted); font-size: 0.78rem; margin-left: 1rem; }
.meta { color: var(--fg-muted); font-size: 0.8rem; }
pre { white-space: pre-wrap; font: inherit; font-size: 0.85rem; background: var(--code-bg); border-radius: 6px; padding: 0.6rem 0.8rem; margin: 0.3rem 0; }
.subject { font-weight: 600; font-size: 0.88rem; margin: 0.4rem 0 0; }
button { font: inherit; font-size: 0.82rem; padding: 0.25rem 0.6rem; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-raised); color: var(--fg); cursor: pointer; }
.forget { margin-top: 1.2rem; }
</style>
