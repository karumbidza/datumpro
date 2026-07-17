import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// React Native / Expo app. No DOM globals; RN provides its own runtime + timers.
export default tseslint.config(
  { ignores: ['node_modules/**', '.expo/**', 'dist/**', 'eslint.config.mjs', 'babel.config.js', 'metro.config.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.node, ...globals.browser, __DEV__: 'readonly' },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off', // RN asset requires
    },
  },
);
