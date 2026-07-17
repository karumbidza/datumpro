import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// Plain-TS domain/validation package — no React, no DOM.
export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', 'eslint.config.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
