import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['.*/**', 'node_modules/**'] }, eslint.configs.recommended, ...tseslint.configs.recommended,
  { files: ['scripts/**/*.mjs', 'tests/**/*.mjs'], languageOptions: { globals: { console: 'readonly', process: 'readonly', URL: 'readonly', URLSearchParams: 'readonly', fetch: 'readonly' } } },
  { files: ['**/*.ts', '**/*.tsx'], rules: { '@typescript-eslint/no-explicit-any': 'error', '@typescript-eslint/consistent-type-imports': 'error' } },
);
