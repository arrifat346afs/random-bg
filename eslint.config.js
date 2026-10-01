import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      /**
       * shadcn/ui components intentionally export their CVA variant map next
       * to the component, and `src/lib/**` exports plain functions. Neither
       * breaks fast refresh in practice, so the rule is noise here.
       */
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // Node-side QA helpers talk to the CDP wire, which is untyped by nature.
    files: ['scripts/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
])
