<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core';
import { onMounted, ref } from 'vue';

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

const tab = ref<'results' | 'tasks' | 'settings'>('results');

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
type KeyAccount = 'typesafe' | 'anthropic' | 'qwen';

const keyInputs = ref<Record<KeyAccount, string>>({ typesafe: '', anthropic: '', qwen: '' });
const keyStatus = ref<Record<string, boolean> | null>(null);
const keyMessage = ref('');

const loadKeyStatus = async (): Promise<void> => {
  try {
    keyStatus.value = await invoke<Record<string, boolean>>('agent_key_status');
  } catch (error) {
    keyMessage.value = `lettura chiavi fallita: ${String(error)}`;
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

onMounted(() => {
  void loadRun();
  void loadKeyStatus();
});
</script>

<template>
  <main>
    <header>
      <h1>openjob.dev</h1>
      <nav>
        <button type="button" :class="{ on: tab === 'results' }" @click="tab = 'results'">Risultati</button>
        <button type="button" :class="{ on: tab === 'tasks' }" @click="tab = 'tasks'">Task</button>
        <button type="button" :class="{ on: tab === 'settings' }" @click="tab = 'settings'">Impostazioni</button>
      </nav>
      <p class="status">{{ status }}</p>
    </header>

    <section v-if="tab === 'results'">
      <button type="button" class="reload" @click="loadRun">Ricarica</button>

      <p v-if="loaded && run === null" class="empty">
        Nessun giro ancora. Lancia il primo dalla riga di comando
        (<code>make agent PROFILE=./profile.json</code>) e premi <strong>Ricarica</strong>.
      </p>

      <template v-if="run !== null">
        <p class="meta">
          ultimo giro {{ when(run.summary.run_at) }} · soglia
          {{ Math.round(run.summary.threshold * 100) }}% ·
          {{ run.summary.fetched }} annunci scaricati · {{ run.summary.kept }} tenuti ·
          {{ run.summary.judged }} giudicati · {{ run.summary.input_tokens }} token
        </p>

        <p v-if="run.summary.selected.length === 0" class="empty">
          Niente sopra la soglia in quel giro. È il prodotto che funziona, non un errore:
          meglio due annunci ottimi che cento inutili.
        </p>

        <ul class="results">
          <li v-for="item in run.summary.selected" :key="item.key">
            <span class="score" :class="{ good: percent(item.probability) >= 90 }">
              {{ percent(item.probability) }}%
            </span>
            <div class="body">
              <a :href="item.url" target="_blank" rel="noreferrer">{{ item.title }}</a>
              <p class="sub">
                {{ item.company ?? 'azienda non indicata' }} · {{ item.source }} ·
                {{ verdictLabel(item.verdict) }} · {{ stackLabel(item.stack_stance) }}
              </p>
              <p v-if="item.gaps.length > 0" class="gap">gap dichiarato: {{ item.gaps.join(', ') }}</p>
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
      <p class="meta">
        Le chiavi finiscono nel portachiavi di macOS, mai in un file. Il portachiavi è
        l'unico posto che l'agente legge.
      </p>
      <div v-for="account in (['typesafe', 'anthropic', 'qwen'] as KeyAccount[])" :key="account" class="keyrow">
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
      </div>
      <p class="status">{{ keyMessage }}</p>
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
  </main>
</template>

<style scoped>
main {
  font-family: ui-sans-serif, system-ui, sans-serif;
  margin: 1.25rem 1.5rem;
  color: #14181f;
}
header {
  display: flex;
  align-items: baseline;
  gap: 1rem;
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
  border: 1px solid #c3c9d4;
  background: #fff;
  cursor: pointer;
}
nav button.on {
  background: #14181f;
  color: #fff;
  border-color: #14181f;
}
.status {
  margin-left: auto;
  font-family: ui-monospace, monospace;
  font-size: 0.75rem;
  color: #45505f;
}
.reload {
  font: inherit;
  padding: 0.3rem 0.7rem;
  border-radius: 6px;
  border: 1px solid #c3c9d4;
  background: #f6f8fb;
  cursor: pointer;
  margin-bottom: 0.8rem;
}
.meta {
  font-size: 0.85rem;
  color: #45505f;
}
.empty {
  font-size: 0.9rem;
  color: #45505f;
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
  border-bottom: 1px solid #e3e7ee;
}
.score {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #475569;
  min-width: 3.2rem;
}
.score.good {
  color: #166534;
}
.body a {
  color: #1d4ed8;
  font-weight: 600;
  text-decoration: none;
}
.body a:hover {
  text-decoration: underline;
}
.sub {
  margin: 0.15rem 0 0;
  font-size: 0.8rem;
  color: #45505f;
}
.gap {
  margin: 0.15rem 0 0;
  font-size: 0.8rem;
  color: #9a3412;
}
.dropped {
  font-size: 0.8rem;
  color: #45505f;
}
.chip {
  display: inline-block;
  margin-right: 0.4rem;
  padding: 0 0.4rem;
  border-radius: 9999px;
  background: #f1f5f9;
}
.path {
  font-family: ui-monospace, monospace;
  font-size: 0.7rem;
  color: #8a93a1;
  margin-top: 1.2rem;
}
.keyrow {
  display: grid;
  grid-template-columns: 12rem 1fr auto;
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
  border: 1px solid #c3c9d4;
  border-radius: 6px;
}
.keyrow button {
  font: inherit;
  padding: 0.3rem 0.7rem;
  border-radius: 6px;
  border: 1px solid #c3c9d4;
  background: #f6f8fb;
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
  border: 1px solid #c3c9d4;
  background: #f6f8fb;
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
  border-bottom: 1px solid #e3e7ee;
}
.keyring {
  font-size: 0.85rem;
}
code {
  font-family: ui-monospace, monospace;
  font-size: 0.85em;
  background: #f1f5f9;
  padding: 0 0.25rem;
  border-radius: 4px;
}
</style>
