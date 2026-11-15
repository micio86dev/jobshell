<script setup lang="ts">
// The sources page. It shows every source in the group the user reasons about, with a switch and,
// for the company boards, the employers the user follows. The agent does the writing; this view
// asks it to, shows its answer, and rolls a switch back when the agent refuses.
import { invoke } from '@tauri-apps/api/core';
import { computed, onMounted, ref } from 'vue';

import {
  displayName,
  employerMessage,
  filterRows,
  GROUPS,
  groupOf,
  parseRows,
  sourceStatusLine,
  summarize,
  validateEmployer,
  type SourceRow,
} from './sources-model';

const rows = ref<SourceRow[]>([]);
const loading = ref(true);
const loadFailed = ref(false);
const query = ref('');
const notice = ref('');
const noticeTone = ref<'ok' | 'bad'>('ok');
const employerDraft = ref<Record<string, string>>({});
const employerHint = ref<Record<string, string>>({});
const pendingRemoval = ref<string | null>(null);
const busy = ref<Record<string, boolean>>({});

const failure = 'Non è stato possibile salvare. Riprova tra un momento.';

const say = (text: string, tone: 'ok' | 'bad' = 'ok'): void => {
  notice.value = text;
  noticeTone.value = tone;
};

/** Read the rows. Used after each change too, so it never shows the loading state: that would close the open sections. */
const refresh = async (): Promise<void> => {
  loadFailed.value = false;
  try {
    const parsed = parseRows(JSON.parse(await invoke<string>('sources_list')));
    if (parsed.ok) rows.value = parsed.rows;
    else loadFailed.value = true;
  } catch {
    loadFailed.value = true;
  }
};

/** The first read: the only one that shows the loading state. */
const load = async (): Promise<void> => {
  loading.value = true;
  await refresh();
  loading.value = false;
};

const summary = computed(() => summarize(rows.value));

/** Visible rows per group, after the search. Empty groups are not shown. */
const sections = computed(() => {
  const visible = filterRows(rows.value, query.value);
  return GROUPS.map((section) => ({
    ...section,
    rows: visible.filter((row) => groupOf(row) === section.group),
  })).filter((section) => section.rows.length > 0);
});

const setBusy = (id: string, value: boolean): void => {
  busy.value = { ...busy.value, [id]: value };
};

const switchSource = async (row: SourceRow): Promise<void> => {
  const next = !row.enabled;
  row.enabled = next; // shown at once; rolled back below if the agent refuses
  setBusy(row.id, true);
  try {
    await invoke('source_switch', { id: row.id, enabled: next });
    say(`${displayName(row.id)}: ${next ? 'attivata' : 'disattivata'}.`);
  } catch {
    row.enabled = !next;
    say(failure, 'bad');
  } finally {
    setBusy(row.id, false);
  }
};

const addEmployer = async (row: SourceRow): Promise<void> => {
  const value = (employerDraft.value[row.id] ?? '').trim();
  const problem = validateEmployer(value);
  if (problem !== null) {
    employerHint.value = { ...employerHint.value, [row.id]: employerMessage(problem) };
    return;
  }
  employerHint.value = { ...employerHint.value, [row.id]: '' };
  setBusy(row.id, true);
  try {
    await invoke('source_employer', { id: row.id, employer: value, add: true });
    employerDraft.value = { ...employerDraft.value, [row.id]: '' };
    say(`Azienda «${value}» aggiunta a ${displayName(row.id)}. Verrà letta alla prossima ricerca.`);
    await refresh();
  } catch {
    say(failure, 'bad');
  } finally {
    setBusy(row.id, false);
  }
};

const removeEmployer = async (row: SourceRow, employer: string): Promise<void> => {
  setBusy(row.id, true);
  try {
    await invoke('source_employer', { id: row.id, employer, add: false });
    pendingRemoval.value = null;
    say(`Azienda «${employer}» rimossa da ${displayName(row.id)}.`);
    await refresh();
  } catch {
    say(failure, 'bad');
  } finally {
    setBusy(row.id, false);
  }
};

const switchTitle = (row: SourceRow): string =>
  row.reachable ? '' : 'Questa fonte non è disponibile per il criterio di sicurezza';

onMounted(load);
</script>

<template>
  <section class="sources" aria-labelledby="sources-title">
    <header class="sources-head">
      <div>
        <h2 id="sources-title">Fonti</h2>
        <p class="meta">
          Scegli da dove arrivano gli annunci. Una fonte spenta non viene mai interrogata, quindi non
          vedi i suoi annunci.
        </p>
      </div>
      <ul v-if="!loading && !loadFailed" class="summary" aria-label="Riepilogo delle fonti">
        <li><strong>{{ summary.active }}</strong> attive</li>
        <li><strong>{{ summary.off }}</strong> spente</li>
        <li><strong>{{ summary.extension }}</strong> solo estensione</li>
        <li><strong>{{ summary.blocked }}</strong> non disponibili</li>
      </ul>
    </header>

    <div v-if="!loading && !loadFailed" class="search">
      <label for="sources-search" class="meta">Cerca una fonte</label>
      <input id="sources-search" v-model="query" type="search" placeholder="es. Greenhouse, Remote" autocomplete="off" />
    </div>

    <p v-if="loading" class="meta" role="status">Carico le fonti…</p>

    <div v-else-if="loadFailed" class="notice bad" role="alert">
      Non riesco a leggere le fonti. <button type="button" @click="load">Riprova</button>
    </div>

    <template v-else>
      <p v-if="sections.length === 0" class="meta">Nessuna fonte corrisponde a «{{ query }}».</p>

      <div v-for="section in sections" :key="section.group" class="group">
        <h3>{{ section.title }}</h3>
        <p class="meta">{{ section.hint }}</p>

        <article
          v-for="row in section.rows"
          :key="row.id"
          class="source"
          :class="{ off: !row.enabled || !row.reachable, busy: busy[row.id] }"
        >
          <div class="source-main">
            <div class="source-name">
              <span class="name">{{ displayName(row.id) }}</span>
              <code class="id">{{ row.id }}</code>
            </div>
            <span class="state" :class="{ on: row.enabled && row.reachable }">{{ sourceStatusLine(row) }}</span>
          </div>

          <button
            type="button"
            class="switch"
            role="switch"
            :aria-checked="row.enabled && row.reachable"
            :aria-label="`${displayName(row.id)}: ${row.enabled ? 'attiva' : 'spenta'}`"
            :disabled="!row.reachable || busy[row.id]"
            :title="switchTitle(row)"
            @click="switchSource(row)"
          >
            <span class="knob" aria-hidden="true" />
          </button>

          <details v-if="row.isBoard && row.reachable" class="employers">
            <summary>
              Aziende: {{ row.verifiedTenants }} verificate
              <template v-if="row.userTenants.length > 0">· {{ row.userTenants.length }} tue</template>
            </summary>

            <ul v-if="row.userTenants.length > 0" class="chips">
              <li v-for="employer in row.userTenants" :key="employer">
                <span>{{ employer }}</span>
                <button
                  v-if="pendingRemoval !== `${row.id}/${employer}`"
                  type="button"
                  :aria-label="`Rimuovi ${employer}`"
                  @click="pendingRemoval = `${row.id}/${employer}`"
                >
                  Rimuovi
                </button>
                <span v-else class="confirm">
                  <button type="button" class="danger" @click="removeEmployer(row, employer)">Conferma</button>
                  <button type="button" @click="pendingRemoval = null">Annulla</button>
                </span>
              </li>
            </ul>

            <form class="add" @submit.prevent="addEmployer(row)">
              <label :for="`employer-${row.id}`" class="meta">Aggiungi un'azienda</label>
              <div class="add-row">
                <input
                  :id="`employer-${row.id}`"
                  v-model="employerDraft[row.id]"
                  type="text"
                  autocomplete="off"
                  placeholder="identificativo, es. acme"
                  :aria-describedby="`hint-${row.id}`"
                  :aria-invalid="employerHint[row.id] ? 'true' : 'false'"
                />
                <button type="submit" :disabled="busy[row.id]">Aggiungi</button>
              </div>
              <p :id="`hint-${row.id}`" class="hint" aria-live="polite">{{ employerHint[row.id] ?? '' }}</p>
            </form>
          </details>
        </article>
      </div>
    </template>

    <p v-if="notice" class="notice" :class="noticeTone" role="status" aria-live="polite">{{ notice }}</p>
  </section>
</template>

<style scoped>
.sources {
  display: grid;
  gap: 1.25rem;
  color: var(--fg);
}
.sources-head {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1.5rem;
  justify-content: space-between;
  align-items: flex-start;
}
.sources-head h2 {
  margin: 0 0 0.25rem;
}
.sources-head p {
  margin: 0;
  max-width: 40rem;
}
.summary {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  list-style: none;
  margin: 0;
  padding: 0;
}
.summary li {
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.2rem 0.7rem;
  font-size: var(--text-sm);
  color: var(--fg-muted);
}
.summary strong {
  color: var(--fg);
  font-variant-numeric: tabular-nums;
}
.search {
  display: grid;
  gap: 0.35rem;
  max-width: 24rem;
}
.search input,
.add input {
  font: inherit;
  padding: 0.5rem 0.7rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-raised);
  color: var(--fg);
}
.search input:focus-visible,
.add input:focus-visible,
button:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
.group {
  display: grid;
  gap: 0.6rem;
}
.group h3 {
  margin: 0.5rem 0 0;
  font-size: var(--text-lg);
}
.group > .meta {
  margin: 0;
}
.source {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.5rem 1rem;
  align-items: center;
  padding: 0.75rem 0.9rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-raised);
  transition: opacity 0.15s ease;
}
.source.off {
  opacity: 0.72;
}
.source.busy {
  opacity: 0.5;
}
.source-main {
  display: grid;
  gap: 0.15rem;
  min-width: 0;
}
.source-name {
  display: flex;
  gap: 0.5rem;
  align-items: baseline;
  flex-wrap: wrap;
}
.name {
  font-weight: 600;
}
.id {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--fg-muted);
}
.state {
  font-size: var(--text-sm);
  color: var(--fg-muted);
}
.state.on {
  color: var(--accent);
}
.switch {
  position: relative;
  width: 2.6rem;
  height: 1.5rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg);
  cursor: pointer;
  padding: 0;
}
.switch[aria-checked='true'] {
  background: var(--cta);
  border-color: var(--cta);
}
.switch:disabled {
  cursor: not-allowed;
}
.knob {
  position: absolute;
  top: 50%;
  left: 0.2rem;
  width: 1.05rem;
  height: 1.05rem;
  margin-top: -0.525rem;
  border-radius: 50%;
  background: var(--fg-muted);
  transition: transform 0.15s ease;
}
.switch[aria-checked='true'] .knob {
  transform: translateX(1.1rem);
  background: var(--cta-fg);
}
.employers {
  grid-column: 1 / -1;
  border-top: 1px dashed var(--border);
  padding-top: 0.5rem;
}
.employers summary {
  cursor: pointer;
  font-size: var(--text-sm);
  color: var(--fg-muted);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  list-style: none;
  padding: 0;
  margin: 0.6rem 0;
}
.chips li {
  display: inline-flex;
  gap: 0.4rem;
  align-items: center;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.15rem 0.5rem 0.15rem 0.7rem;
  font-size: var(--text-sm);
}
.add {
  display: grid;
  gap: 0.3rem;
  margin-top: 0.5rem;
}
.add-row {
  display: flex;
  gap: 0.5rem;
  max-width: 28rem;
}
.add-row input {
  flex: 1;
}
.hint {
  margin: 0;
  min-height: 1.2em;
  font-size: var(--text-sm);
  color: var(--fg-muted);
}
.hint:not(:empty) {
  color: #9a3412;
}
.confirm {
  display: inline-flex;
  gap: 0.3rem;
}
.danger {
  color: #9a3412;
}
button {
  font: inherit;
  padding: 0.35rem 0.75rem;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--fg);
  cursor: pointer;
}
button[type='submit'] {
  background: var(--cta);
  border-color: var(--cta);
  color: var(--cta-fg);
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.notice {
  margin: 0;
  padding: 0.6rem 0.8rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  font-size: var(--text-sm);
}
.notice.ok {
  color: var(--accent);
}
.notice.bad {
  color: #9a3412;
}
@media (max-width: 36rem) {
  .source {
    grid-template-columns: 1fr;
  }
  .switch {
    justify-self: start;
  }
}
@media (prefers-reduced-motion: reduce) {
  .knob,
  .source {
    transition: none;
  }
}
</style>
