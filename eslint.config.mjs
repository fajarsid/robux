// Root ESLint flat config for Node/TypeScript packages (apps/api, packages/*).
// apps/web has its own config based on eslint-config-next.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/.next/**', '**/coverage/**', '**/generated/**', 'apps/web/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'error',
      // Raw SQL must go through tagged templates (parameterised); see SECURITY.md §7.
      'no-restricted-properties': [
        'error',
        { property: '$queryRawUnsafe', message: 'Use $queryRaw tagged templates.' },
        { property: '$executeRawUnsafe', message: 'Use $executeRaw tagged templates.' },
      ],
    },
  },
);
