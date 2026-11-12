/**
 * The reactive interface language. It follows the primary language once the profile has one, and
 * the operating system language before that. Components read messages through `t`, so a change of
 * primary language re-renders them in place.
 */
import { computed, ref } from 'vue';

import { MESSAGES, resolveLocale, translate, type Locale, type MessageKey } from './locale';

const primaryLanguage = ref<string | null>(null);

/** The operating system language tag, as the webview reports it. */
export const systemTag = (): string | undefined =>
  typeof navigator === 'undefined' ? undefined : navigator.language;

/** The two-letter code of the operating system language, used as a default language choice. */
export const systemLanguageCode = (): string => (systemTag() ?? 'en').slice(0, 2).toLowerCase();

export const locale = computed<Locale>(() => resolveLocale(primaryLanguage.value, systemTag()));

/** Set once the profile says which language the app navigates in. */
export const setPrimaryLanguage = (code: string | null): void => {
  primaryLanguage.value = code;
};

export const t = (key: MessageKey, params?: Record<string, string | number>): string =>
  translate(locale.value, key, params);

/** A language's name in the interface language, or its code when the app has no name for it. */
export const languageName = (code: string): string => {
  const key = `lang.${code}` as MessageKey;
  return key in MESSAGES.en ? t(key) : code.toUpperCase();
};

/** A message key built from a value the data carries, such as a level or a usage. */
export const keyOf = (prefix: string, value: string): MessageKey => `${prefix}.${value}` as MessageKey;
