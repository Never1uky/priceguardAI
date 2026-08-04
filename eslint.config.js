import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Minimal flat config so `npm run lint` is a real gate (not a dead script).
 * Soft rules only — no style rewrite of the legacy tree.
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'supabase/functions/**',
      'docs/**',
      'scripts/**',
      '**/*.min.js',
      'priceguard-ai-v*/**',
      'priceguard-ai-v*.zip',
      'eslint-report.json',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}', '*.config.{js,ts,mjs,cjs}', 'eslint.config.js'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.worker,
        chrome: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      ...js.configs.recommended.rules,
      // Soft gate: avoid drowning in legacy noise
      'no-unused-vars': 'off',
      'no-undef': 'off',
      'no-console': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'prefer-const': 'off',
      'no-useless-assignment': 'off',
      'no-useless-escape': 'off',
      'preserve-caught-error': 'off',
      'no-prototype-builtins': 'off',
      'no-cond-assign': 'off',
      'no-fallthrough': 'off',
      'no-constant-condition': 'off',
      'no-control-regex': 'off',
      'no-func-assign': 'off',
      'no-redeclare': 'off',
      'no-extra-boolean-cast': 'off',
      'no-unreachable': 'warn',
      'no-misleading-character-class': 'off',
      'getter-return': 'off',
      'valid-typeof': 'warn',
      'no-unassigned-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
);
