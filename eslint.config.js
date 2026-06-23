import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Dashboard frontend runs in the browser, not Node. Skipping it here
    // avoids `no-undef` against `window`/`document` and keeps the lint
    // config scoped to the CLI/server TypeScript sources.
    ignores: ['dist/', 'node_modules/', 'bin/', 'scripts/', 'assets/', 'src/dashboard/web/'],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  }
);
