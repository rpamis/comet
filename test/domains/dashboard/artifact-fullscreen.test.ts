// @vitest-environment jsdom

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import React, { act, useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { useDashboardModalState } from '../../../domains/dashboard/web/src/dashboard-modal.jsx';
import { extractToc } from '../../../domains/dashboard/web/src/markdown-preview.js';

type ArtifactDrawerProps = {
  artifact: { key: string; name: string; preview: { exists: boolean; content: string } };
  embedded?: boolean;
  onClose: () => void;
};
let ArtifactDrawer: React.ComponentType<ArtifactDrawerProps>;
let container: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  // Exercise the shared drawer without mounting the entire Dashboard and its data services.
  const source = await readFile('domains/dashboard/web/src/main.jsx', 'utf8');
  const drawer = source.slice(
    source.indexOf('function ArtifactDrawer('),
    source.indexOf('function ProjectKnowledgePreviewModal('),
  );
  const code = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { readFileSync } from 'node:fs';
    import { transformSync } from 'esbuild';
    process.stdout.write(transformSync(readFileSync(0, 'utf8'), {
      loader: 'jsx', format: 'cjs', jsx: 'automatic',
    }).code);
  `,
    ],
    { input: `${drawer}\nexports.ArtifactDrawer = ArtifactDrawer;`, encoding: 'utf8' },
  );
  const icon = () => React.createElement('span');
  const dependencies = {
    useEffect,
    useRef,
    useState,
    useDashboardModalState,
    useDashboardLanguage: () => 'zh',
    AntApp: { useApp: () => ({ message: {} }) },
    t: (value: string) => value,
    extractToc,
    renderMarkdown: async () => '<h1 id="brief">Brief</h1><h2 id="acceptance">Acceptance</h2>',
    runMermaid: () => undefined,
    CloseOutlined: icon,
    CopyOutlined: icon,
    ExpandOutlined: icon,
    CompressOutlined: icon,
    DashboardLineSkeleton: () => null,
  };
  const exports: { ArtifactDrawer?: typeof ArtifactDrawer } = {};
  new Function('require', 'exports', ...Object.keys(dependencies), code)(
    createRequire(import.meta.url),
    exports,
    ...Object.values(dependencies),
  );
  ArtifactDrawer = exports.ArtifactDrawer!;
});

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  ['Native', 'brief', '需求简报'],
  ['Classic', 'proposal', '提案'],
])('expands %s artifacts without dismissing the preview', async (_workflow, key, name) => {
  const onClose = vi.fn();
  await act(async () =>
    root.render(
      React.createElement(ArtifactDrawer, {
        artifact: { key, name, preview: { exists: true, content: '# Brief' } },
        onClose,
      }),
    ),
  );
  const button = container.querySelector<HTMLButtonElement>('header button[aria-label="全屏展示"]');
  expect(button).not.toBeNull();
  expect(container.querySelector('[aria-label="关闭产物预览"]')).toBeNull();
  act(() => button!.click());
  expect(container.querySelector('.dashboard-artifact-preview-panel.is-fullscreen')).not.toBeNull();
  expect(container.querySelector('[aria-label="文档目录"]')?.textContent).toContain('Acceptance');
  expect(onClose).not.toHaveBeenCalled();
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="退出全屏"]')!.click());
  expect(container.querySelector('.dashboard-artifact-preview-panel.is-fullscreen')).toBeNull();
  act(() => button!.click());
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(container.querySelector('.dashboard-artifact-preview-panel.is-fullscreen')).toBeNull();
  expect(container.querySelector('[aria-label="文档目录"]')).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(onClose).toHaveBeenCalledOnce();
});

it('keeps embedded artifact previews closable within their container', async () => {
  const onClose = vi.fn();
  await act(async () =>
    root.render(
      React.createElement(ArtifactDrawer, {
        artifact: { key: 'brief', name: '需求简报', preview: { exists: true, content: '# Brief' } },
        embedded: true,
        onClose,
      }),
    ),
  );
  expect(container.querySelector('[aria-label="全屏展示"]')).toBeNull();
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="关闭产物预览"]')!.click());
  expect(onClose).toHaveBeenCalledOnce();
});
