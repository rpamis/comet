import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { assertClassicLayoutInitializationSafe } from '../../../domains/comet-classic/classic-layout-initialization.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';

describe('Classic layout initialization safety', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-layout-init-'));
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('allows an explicit desired layout only for a fresh project with both roots missing', async () => {
    await expect(assertClassicLayoutInitializationSafe(projectRoot, 'docs')).resolves.toMatchObject(
      {
        artifactLayout: 'docs',
        openSpecRoot: path.join(projectRoot, 'docs', 'openspec'),
      },
    );
  });

  it('revalidates the desired root created by the same initialization without weakening later calls', async () => {
    const initialization = await assertClassicLayoutInitializationSafe(projectRoot, 'docs');
    await fs.mkdir(initialization.openSpecRoot, { recursive: true });

    await expect(
      assertClassicLayoutInitializationSafe(
        projectRoot,
        'docs',
        initialization.initializationPermit,
      ),
    ).resolves.toMatchObject({
      artifactLayout: 'docs',
      openSpecRoot: path.join(projectRoot, 'docs', 'openspec'),
    });
    await expect(assertClassicLayoutInitializationSafe(projectRoot, 'docs')).rejects.toThrow(
      /cannot initialize Classic layout without.*config/iu,
    );
  });

  it('uses the configured layout for an existing project', async () => {
    await writeClassicConfig('docs');
    await fs.mkdir(path.join(projectRoot, 'docs', 'openspec'), { recursive: true });

    await expect(assertClassicLayoutInitializationSafe(projectRoot, 'docs')).resolves.toMatchObject(
      {
        artifactLayout: 'docs',
        openSpecRoot: path.join(projectRoot, 'docs', 'openspec'),
      },
    );
  });

  it('allows a configured Classic project to initialize its missing root when both roots are absent', async () => {
    await writeClassicConfig('docs');

    await expect(assertClassicLayoutInitializationSafe(projectRoot, 'docs')).resolves.toMatchObject(
      {
        artifactLayout: 'docs',
        openSpecRoot: path.join(projectRoot, 'docs', 'openspec'),
      },
    );
  });

  it('binds an existing configured Classic project to the initial config identity', async () => {
    await writeClassicConfig('docs');
    await fs.mkdir(path.join(projectRoot, 'docs', 'openspec'), { recursive: true });
    const initialization = await assertClassicLayoutInitializationSafe(projectRoot, 'docs');
    const configPath = path.join(projectRoot, '.comet', 'config.yaml');
    await fs.appendFile(configPath, 'extension: changed\n', 'utf8');

    await expect(
      assertClassicLayoutInitializationSafe(
        projectRoot,
        'docs',
        initialization.initializationPermit,
      ),
    ).rejects.toThrow(/project config changed during Classic layout initialization/iu);
  });

  it('allows a Native-only project to initialize its first explicit Classic layout', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs'));

    await expect(assertClassicLayoutInitializationSafe(projectRoot, 'docs')).resolves.toMatchObject(
      {
        artifactLayout: 'docs',
        openSpecRoot: path.join(projectRoot, 'docs', 'openspec'),
      },
    );
  });

  it('rejects an initialization permit after the protected project config changes', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs'));
    const initialization = await assertClassicLayoutInitializationSafe(projectRoot, 'docs');
    await fs.mkdir(initialization.openSpecRoot, { recursive: true });
    const configPath = path.join(projectRoot, '.comet', 'config.yaml');
    const source = await fs.readFile(configPath, 'utf8');
    await fs.writeFile(
      configPath,
      source.replace('artifact_root: docs', 'artifact_root: artifacts'),
    );

    await expect(
      assertClassicLayoutInitializationSafe(
        projectRoot,
        'docs',
        initialization.initializationPermit,
      ),
    ).rejects.toThrow(/project config changed during Classic layout initialization/iu);
  });

  it('rejects a desired layout that disagrees with existing configuration', async () => {
    await writeClassicConfig('legacy');
    await fs.mkdir(path.join(projectRoot, 'openspec'), { recursive: true });

    await expect(assertClassicLayoutInitializationSafe(projectRoot, 'docs')).rejects.toThrow(
      /configured Classic layout is legacy.*requested docs/iu,
    );
  });

  it('rejects an existing configured project when only the alternate root exists', async () => {
    await writeClassicConfig('docs');
    await fs.mkdir(path.join(projectRoot, 'openspec'), { recursive: true });

    await expect(assertClassicLayoutInitializationSafe(projectRoot, 'docs')).rejects.toThrow(
      /configured Classic OpenSpec root is missing/iu,
    );
  });

  it('rejects a fresh project when either unmanaged OpenSpec root already exists', async () => {
    await fs.mkdir(path.join(projectRoot, 'openspec'), { recursive: true });

    await expect(assertClassicLayoutInitializationSafe(projectRoot, 'docs')).rejects.toThrow(
      /cannot initialize Classic layout without.*config/iu,
    );
  });

  it('rejects a fresh project when the alternate docs root is a directory link', async () => {
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-init-outside-'));
    try {
      await fs.mkdir(path.join(projectRoot, 'docs'), { recursive: true });
      try {
        await fs.symlink(
          outsideRoot,
          path.join(projectRoot, 'docs', 'openspec'),
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }

      await expect(assertClassicLayoutInitializationSafe(projectRoot, 'legacy')).rejects.toThrow(
        /symbolic link or junction/iu,
      );
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('rejects a pending root move before initializing OpenSpec artifacts', async () => {
    await writeClassicConfig('docs');
    await fs.mkdir(path.join(projectRoot, 'docs', 'openspec'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'classic-root-move.json'),
      '{"status":"prepared"}\n',
      'utf8',
    );

    await expect(assertClassicLayoutInitializationSafe(projectRoot, 'docs')).rejects.toThrow(
      /root move transaction is incomplete/iu,
    );
  });

  it('rejects a configured OpenSpec root that crosses a junction', async () => {
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-layout-outside-'));
    try {
      await writeClassicConfig('docs');
      await fs.mkdir(path.join(projectRoot, 'docs'), { recursive: true });
      try {
        await fs.symlink(
          outsideRoot,
          path.join(projectRoot, 'docs', 'openspec'),
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }

      await expect(assertClassicLayoutInitializationSafe(projectRoot, 'docs')).rejects.toThrow(
        /symbolic link or junction/iu,
      );
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  async function writeClassicConfig(artifactLayout: 'legacy' | 'docs'): Promise<void> {
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: classic',
        'workflows:',
        '  - classic',
        'classic:',
        `  artifact_layout: ${artifactLayout}`,
        '',
      ].join('\n'),
      'utf8',
    );
  }
});
