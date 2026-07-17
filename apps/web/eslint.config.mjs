import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import nextPlugin from '@next/eslint-plugin-next';
import globals from 'globals';

// Flat-config ESLint for the Next.js app (replaces the deprecated `next lint`).
// Tuned to be a real safety net that passes clean: correctness rules error,
// stylistic/opinion rules warn or off, so `pnpm lint` fails only on genuine bugs.
export default tseslint.config(
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'eslint.config.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { '@next/next': nextPlugin, 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, React: 'readonly' },
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactHooks.configs.recommended.rules,
      // Unused code — the class of bug this pass exists to catch. `_`-prefixed
      // args/vars are intentional throwaways (e.g. useActionState's _prev).
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // We lean on Record<string, unknown> and supabase's loose typings; `any`
      // is pragmatic here, not worth failing the build over.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
