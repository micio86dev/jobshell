<script setup lang="ts">
// A destructive action that asks inside the page. The desktop window does not show a native confirm dialog:
// window.confirm returns false at once there, so a button guarded by it would silently never work.
import { ref } from 'vue';

import { t } from '../i18n/store';

defineProps<{ label: string; question: string }>();
const emit = defineEmits<{ confirm: [] }>();

const asking = ref(false);
const yes = (): void => {
  asking.value = false;
  emit('confirm');
};
</script>

<template>
  <span v-if="!asking" class="confirm">
    <button type="button" class="ask" @click="asking = true">{{ label }}</button>
  </span>
  <span v-else class="confirm" role="alertdialog" :aria-label="question">
    <span class="question">{{ question }}</span>
    <button type="button" class="yes" @click="yes">{{ t('leads.confirm.yes') }}</button>
    <button type="button" class="no" @click="asking = false">{{ t('leads.confirm.no') }}</button>
  </span>
</template>

<style scoped>
.confirm { display: inline-flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; }
.question { font-size: 0.85rem; }
</style>
