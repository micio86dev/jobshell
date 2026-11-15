<script setup lang="ts">
// The sources page: every source with its switch, and for the board sources the employers the user
// added. The agent does the writing; this view only asks it to, and shows what it answers.
import { invoke } from '@tauri-apps/api/core';
import { onMounted, ref } from 'vue';

import { parseRows, sourceStatusLine, validateEmployer, type SourceRow } from './sources-model';

const rows = ref<SourceRow[]>([]);
const message = ref('');
const newEmployer = ref<Record<string, string>>({});

const load = async (): Promise<void> => {
  try {
    const parsed = parseRows(JSON.parse(await invoke<string>('sources_list')));
    if (parsed.ok) rows.value = parsed.rows;
    else message.value = parsed.error;
  } catch {
    message.value = 'non riesco a leggere le fonti: l\'agente non ha risposto';
  }
};

const switchSource = async (row: SourceRow, enabled: boolean): Promise<void> => {
  try {
    await invoke('source_switch', { id: row.id, enabled });
    await load();
  } catch (error) {
    message.value = String(error);
  }
};

const addEmployer = async (row: SourceRow): Promise<void> => {
  const value = (newEmployer.value[row.id] ?? '').trim();
  const problem = validateEmployer(value);
  if (problem === 'empty') {
    message.value = 'scrivi l\'identificativo dell\'azienda';
    return;
  }
  if (problem === 'invalid') {
    message.value = 'l\'identificativo deve contenere solo lettere, numeri e trattini: niente indirizzi né chiavi';
    return;
  }
  try {
    await invoke('source_employer', { id: row.id, employer: value, add: true });
    newEmployer.value[row.id] = '';
    await load();
  } catch (error) {
    message.value = String(error);
  }
};

const removeEmployer = async (row: SourceRow, employer: string): Promise<void> => {
  try {
    await invoke('source_employer', { id: row.id, employer, add: false });
    await load();
  } catch (error) {
    message.value = String(error);
  }
};

onMounted(load);
</script>

<template>
  <section class="sources">
    <h2>Fonti</h2>
    <p class="meta">
      Attiva o disattiva ogni fonte. Una fonte disattivata non viene interrogata, quindi non vedi
      i suoi annunci. Per le aziende che usano Greenhouse, Lever, Recruitee o Personio puoi aggiungere
      la tua azienda con il suo identificativo.
    </p>

    <div v-for="row in rows" :key="row.id" class="source">
      <div class="source-head">
        <label>
          <input
            type="checkbox"
            :checked="row.enabled"
            :disabled="!row.reachable"
            @change="switchSource(row, ($event.target as HTMLInputElement).checked)"
          />
          {{ row.id }}
        </label>
        <span class="meta">{{ sourceStatusLine(row) }}</span>
      </div>

      <div v-if="row.isBoard" class="employers">
        <span class="meta">{{ row.verifiedTenants }} aziende verificate; le tue:</span>
        <ul>
          <li v-for="employer in row.userTenants" :key="employer">
            {{ employer }}
            <button type="button" @click="removeEmployer(row, employer)">Rimuovi</button>
          </li>
        </ul>
        <div class="keyrow">
          <input v-model="newEmployer[row.id]" type="text" placeholder="identificativo azienda" />
          <button type="button" @click="addEmployer(row)">Aggiungi</button>
        </div>
      </div>
    </div>

    <p class="status">{{ message }}</p>
  </section>
</template>
