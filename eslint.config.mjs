// Lint for every TypeScript and Vue file in the repository.
// Type-aware rules are off: typescript-eslint does not yet support TypeScript 7,
// which the packages use. Type safety is enforced by `tsc --noEmit` (strict mode).
import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/target/**',
      '**/*.d.ts',
      'evidence/**',
      'odd/**',
      '.cache/**',
    ],
  },
  ...tseslint.configs.strict.map((config) => ({ ...config, files: ['**/*.ts', '**/*.mts', '**/*.vue'] })),
  {
    // A leading underscore marks a binding that is unused on purpose.
    files: ['**/*.ts', '**/*.mts', '**/*.vue'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  ...vue.configs['flat/essential'].map((config) => ({ ...config, files: ['**/*.vue'] })),
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.vue'] },
    },
  },
);
