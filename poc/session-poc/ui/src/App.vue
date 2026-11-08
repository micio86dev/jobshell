<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core';
import { onMounted, ref } from 'vue';

type TaskView = {
  id: number;
  kind: string;
  state: string;
  attempts: number;
  result: string | null;
};

const tasks = ref<TaskView[]>([]);
const status = ref('idle');
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

const finish = async (id: number): Promise<void> => {
  try {
    await invoke<string>('finish_task', { id, result: 'completed in the spike' });
    await refresh();
  } catch (error) {
    status.value = `finish failed: ${String(error)}`;
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

const probeKeyring = async (): Promise<void> => {
  try {
    keyringOk.value = await invoke<boolean>('keyring_probe', { account: 'selftest-account' });
  } catch (error) {
    keyringOk.value = false;
    status.value = `keyring failed: ${String(error)}`;
  }
};

onMounted(refresh);
</script>

<template>
  <main>
    <h1>openjob.dev — Phase 0 spike</h1>
    <p class="status">status: {{ status }}</p>
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
  </main>
</template>

<style scoped>
main {
  font-family: ui-sans-serif, system-ui, sans-serif;
  margin: 2rem;
  color: #14181f;
}
h1 {
  font-size: 1.1rem;
  letter-spacing: 0.02em;
}
.actions {
  display: flex;
  gap: 0.5rem;
  margin: 1rem 0;
}
button {
  font: inherit;
  padding: 0.4rem 0.8rem;
  border-radius: 6px;
  border: 1px solid #c3c9d4;
  background: #f6f8fb;
  cursor: pointer;
}
button:hover {
  background: #eaeef5;
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
.status {
  font-family: ui-monospace, monospace;
  font-size: 0.85rem;
  color: #45505f;
}
.keyring {
  font-size: 0.85rem;
}
</style>
