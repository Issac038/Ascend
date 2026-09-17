import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Data fetching in effects legitimately calls setState in async callbacks;
      // the sync-cascade heuristic flags these false positives.
      'react-hooks/set-state-in-effect': 'off',
      // AppStore intentionally exports the useStore hook alongside its provider.
      'react-refresh/only-export-components': 'off',
    },
  },
])
