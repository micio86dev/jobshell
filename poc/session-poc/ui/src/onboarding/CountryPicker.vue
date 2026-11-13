<script setup lang="ts">
import { computed, ref } from 'vue';

import { locale, t } from '../i18n/store';
import { countryName, suggestCountries } from './countries';

const props = defineProps<{ modelValue: string[]; label: string }>();
const emit = defineEmits<{ 'update:modelValue': [codes: string[]] }>();

const query = ref('');
const open = ref(false);

const suggestions = computed(() => suggestCountries(query.value, locale.value, props.modelValue));

const choose = (code: string) => {
  if (!props.modelValue.includes(code)) emit('update:modelValue', [...props.modelValue, code]);
  query.value = '';
  open.value = false;
};

const remove = (code: string) => emit('update:modelValue', props.modelValue.filter((item) => item !== code));

const onEnter = () => {
  const first = suggestions.value[0];
  if (first !== undefined) choose(first);
};
</script>

<template>
  <div class="country-picker">
    <label>
      {{ label }}
      <input
        v-model="query"
        type="text"
        role="combobox"
        autocomplete="off"
        :aria-expanded="open && suggestions.length > 0"
        :placeholder="t('countries.search')"
        @focus="open = true"
        @blur="open = false"
        @keydown.enter.prevent="onEnter"
        @keydown.esc="open = false"
      />
    </label>
    <ul v-if="open && suggestions.length > 0" class="suggestions" role="listbox">
      <!-- mousedown keeps the input focused until the choice is applied -->
      <li v-for="code in suggestions" :key="code" role="option" @mousedown.prevent="choose(code)">
        {{ countryName(code, locale) }} <span class="code">{{ code }}</span>
      </li>
    </ul>
    <p v-if="query.trim() !== '' && suggestions.length === 0" class="hint">{{ t('countries.noMatch') }}</p>
    <ul class="chips" :aria-label="label">
      <li v-for="code in modelValue" :key="code" class="chip">
        {{ countryName(code, locale) }}
        <button type="button" :aria-label="`${t('action.remove')} ${countryName(code, locale)}`" @click="remove(code)">×</button>
      </li>
    </ul>
    <p v-if="modelValue.length === 0" class="hint">{{ t('countries.none') }}</p>
  </div>
</template>

<style scoped>
.country-picker {
  display: grid;
  gap: 0.5rem;
  position: relative;
}
.country-picker input {
  min-height: 2.75rem;
  font-size: 1rem;
}
.suggestions {
  position: absolute;
  z-index: 10;
  top: 100%;
  left: 0;
  right: 0;
  margin: 0;
  padding: 0.25rem 0;
  list-style: none;
  background: var(--surface, #fff);
  border: 1px solid var(--border, #ccc);
  border-radius: 8px;
  max-height: 16rem;
  overflow-y: auto;
  box-shadow: 0 6px 18px rgb(0 0 0 / 0.12);
}
.suggestions li {
  padding: 0.6rem 0.9rem;
  cursor: pointer;
  font-size: 1rem;
}
.suggestions li:hover {
  background: var(--hover, #eef3ef);
}
.code {
  opacity: 0.6;
  font-size: 0.85rem;
  margin-left: 0.25rem;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.3rem 0.4rem 0.3rem 0.75rem;
  border-radius: 999px;
  background: var(--chip, #e6efe9);
  font-size: 0.95rem;
}
.chip button {
  border: 0;
  background: transparent;
  cursor: pointer;
  font-size: 1.1rem;
  line-height: 1;
  padding: 0 0.3rem;
}
.hint {
  margin: 0;
  font-size: 0.9rem;
  opacity: 0.8;
}
</style>
