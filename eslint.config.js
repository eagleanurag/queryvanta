import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Generated output, never source.
  //
  // `dist` is the build artefact. `.wrangler` is the cache `wrangler dev`
  // writes while the integration tests boot a real Worker; it contains
  // bundled/minified middleware and transient entry stubs that cannot be
  // parsed as project source, so linting it produced phantom "Parsing
  // error" diagnostics that came and went depending on whether a test had
  // just run.
  globalIgnores(['dist', '.wrangler']),
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
  },
])
