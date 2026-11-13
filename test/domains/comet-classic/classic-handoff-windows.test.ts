import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resolveClassicDesignContext,
  writeClassicDesignHandoffView,
} from '../../../domains/comet-classic/classic-handoff.js';

const memory = vi.hoisted(() => ({
  files: new Map<string, string>(),
  specs: [] as string[],
}));
vi.mock('../../../domains/comet-classic/classic-store.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../domains/comet-classic/classic-store.js')>()),
  readClassicState: async () => ({ classic: { workflow: 'full', phase: 'design' } }),
}));
vi.mock('path', async () => {
  const { win32 } = await vi.importActual<typeof import('node:path')>('node:path');
  return { ...win32, default: win32 };
});
vi.mock('../../../domains/comet-classic/classic-protected-path.js', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../../domains/comet-classic/classic-protected-path.js')
  >()),
  classicProjectTargetExists: async (_root: string, file: string) =>
    memory.files.has(file.replaceAll('\\', '/')),
  readClassicProjectFile: async (root: string, file: string) => {
    const target = path.win32.isAbsolute(file) ? file : path.win32.join(root, file);
    const content = memory.files.get(target.replaceAll('\\', '/'));
    if (content === undefined) throw new Error(`Missing fixture: ${file}`);
    return content;
  },
  ensureClassicProjectDirectory: async () => undefined,
  writeClassicProjectText: async (_root: string, file: string, content: string) => {
    memory.files.set(file.replaceAll('\\', '/'), content);
  },
}));
vi.mock('../../../domains/comet-classic/classic-paths.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../domains/comet-classic/classic-paths.js')>()),
  collectClassicSpecFiles: async () => memory.specs,
}));
vi.mock(
  '../../../domains/comet-classic/classic-artifact-requirements.js',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('../../../domains/comet-classic/classic-artifact-requirements.js')
    >()),
    readClassicArtifactRequirements: async () => ({ files: [], problems: [] }),
  }),
);

beforeEach(() => {
  memory.files.clear();
  memory.specs = [];
});

describe('Classic beta handoff Windows paths', () => {
  it('projects forward-slash spec listings with a backslash change directory', async () => {
    const projectRoot = 'C:\\project';
    const changeDir = path.win32.join(projectRoot, 'openspec', 'changes', 'demo');
    const spec = 'C:/project/openspec/changes/demo/specs/login/spec.md';
    memory.specs.push(spec);
    memory.files.set(
      'C:/project/openspec/changes/demo/proposal.md',
      'Original Windows requirements.\n',
    );
    memory.files.set(spec, '## Requirement: Windows acceptance\n### Scenario: Login succeeds\n');
    const result = await resolveClassicDesignContext({
      projectRoot,
      changeDir,
      change: 'demo',
      contextCompression: 'beta',
    });
    expect(result.handoffContext).toBe('openspec/changes/demo/proposal.md');
    expect([...memory.files.keys()].some((file) => file.includes('/.comet/handoff/'))).toBe(false);
    await writeClassicDesignHandoffView({ projectRoot, changeDir, change: 'demo' });
    const markdown = memory.files.get(
      'C:/project/openspec/changes/demo/.comet/handoff/design-context.md',
    );
    expect(markdown).toContain('## openspec/changes/demo/specs/login/spec.md');
    expect(markdown).toContain('## Requirement: Windows acceptance');
    expect(markdown).toContain('### Scenario: Login succeeds');
    expect(markdown).not.toContain('No delta spec files found.');
  });
});
