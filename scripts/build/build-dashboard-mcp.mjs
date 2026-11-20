import { build as bundle, transform } from 'esbuild';
import { build as buildWeb } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveRepositoryPath } from '../lib/repository-layout.mjs';

export function renderDashboardMcpHtml(template, script, style = '') {
  const safeScript = script.replace(/<\/script/giu, '<\\/script');
  return template
    .replace(
      '<!-- COMET_MCP_STYLE -->',
      () => `<style>${style.replace(/<\/style/giu, '<\\/style')}</style>`,
    )
    .replace('<!-- COMET_MCP_SCRIPT -->', () => `<script type="module">${safeScript}</script>`);
}

export async function buildDashboardMcp({ outputRoot, version }) {
  await fs.mkdir(outputRoot, { recursive: true });
  const logo = await fs.readFile(resolveRepositoryPath('plugin/codex/icon.png'), 'base64');
  const client = await buildWeb({
    configFile: resolveRepositoryPath('domains/dashboard/web/vite.config.mjs'),
    logLevel: 'silent',
    publicDir: false,
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'globalThis.__COMET_DASHBOARD_MCP__': 'true',
      'globalThis.__COMET_DASHBOARD_LOGO__': JSON.stringify(`data:image/png;base64,${logo}`),
    },
    build: {
      write: false,
      cssCodeSplit: false,
      target: 'es2022',
      lib: {
        entry: resolveRepositoryPath('plugin/codex/web/mcp-app.js'),
        formats: ['es'],
        fileName: 'mcp-app',
      },
      rollupOptions: { output: { codeSplitting: false } },
    },
  });
  const template = await fs.readFile(
    resolveRepositoryPath('plugin/codex/web/mcp-app.html'),
    'utf8',
  );
  const output = (Array.isArray(client) ? client : [client]).flatMap((result) => result.output);
  const script = await transform(
    output.find((item) => item.type === 'chunk' && item.isEntry).code,
    {
      minify: true,
      target: 'es2022',
      format: 'esm',
      legalComments: 'none',
    },
  );
  await fs.writeFile(
    path.join(outputRoot, 'dashboard-app.html'),
    renderDashboardMcpHtml(
      template,
      script.code,
      output
        .filter((item) => item.type === 'asset' && item.fileName.endsWith('.css'))
        .map((item) => item.source)
        .join('\n'),
    ),
  );
  for (const [entry, outputName] of [
    ['plugin/codex/mcp-server-entry.ts', 'comet-dashboard-mcp.mjs'],
    ['plugin/codex/cli-setup-entry.ts', 'comet-cli-setup.mjs'],
  ])
    await bundle({
      absWorkingDir: resolveRepositoryPath('.'),
      entryPoints: [entry],
      outfile: path.join(outputRoot, outputName),
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      minify: true,
      legalComments: 'none',
      define: { __COMET_VERSION__: JSON.stringify(version) },
      banner: {
        js: "import { createRequire as __cometCreateRequire } from 'node:module'; const require = __cometCreateRequire(import.meta.url);",
      },
    });
  await buildWeb({
    configFile: resolveRepositoryPath('domains/dashboard/web/vite.config.mjs'),
    logLevel: 'silent',
    build: { outDir: path.join(outputRoot, 'web'), emptyOutDir: true },
  });
}
