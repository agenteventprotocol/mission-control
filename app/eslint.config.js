import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist'] },
  {
    files: ['src/**/*.{ts,tsx}', 'test/**/*.{ts,tsx}', 'vite.config.ts'],
    extends: [...tseslint.configs.recommended, reactHooks.configs.flat['recommended-latest']],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      // TanStack Virtual is a deliberate dependency; the React Compiler
      // memoization notice for it is informational, not actionable here.
      'react-hooks/incompatible-library': 'off',
    },
  },
);
