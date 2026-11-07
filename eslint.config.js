import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      'dist/',
      'node_modules/',
      'bin/',
      'scripts/',
      'assets/',
      'domains/dashboard/web/vite.config.mjs',
    ],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: [
      'domains/dashboard/web/src/**/*.{js,jsx}',
      'plugin/codex/web/**/*.js',
      'plugin/dsh/client.js',
    ],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      // Declare browser APIs without hiding accidental out-of-scope identifiers.
      globals: Object.fromEntries(
        [
          'window',
          'innerWidth',
          'matchMedia',
          'document',
          'navigator',
          'localStorage',
          'sessionStorage',
          'fetch',
          'URL',
          'URLSearchParams',
          'AbortController',
          'AbortSignal',
          'setTimeout',
          'clearTimeout',
          'setInterval',
          'clearInterval',
          'requestAnimationFrame',
          'cancelAnimationFrame',
          'ResizeObserver',
          'MutationObserver',
          'IntersectionObserver',
          'File',
          'Blob',
          'FormData',
          'FileReader',
          'TextEncoder',
          'TextDecoder',
          'atob',
          'btoa',
          'performance',
          'crypto',
          'Event',
          'CustomEvent',
          'DOMParser',
          'Node',
          'HTMLElement',
          'HTMLInputElement',
          'InputEvent',
          'getComputedStyle',
          'structuredClone',
          'WebSocket',
          'EventSource',
          'console',
        ].map((name) => [name, 'readonly']),
      ),
    },
    rules: { 'no-undef': 'error' },
  },
  {
    files: ['plugin/dsh/index.js'],
    languageOptions: {
      globals: Object.fromEntries(
        ['process', 'Buffer', 'URL', 'Response', 'console', 'setTimeout', 'clearTimeout'].map(
          (name) => [name, 'readonly'],
        ),
      ),
    },
  },
);
