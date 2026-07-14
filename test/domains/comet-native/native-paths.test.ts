import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import {
  normalizeArtifactRootRef,
  resolveArtifactRoot,
} from '../../../domains/comet-native/native-paths.js';

describe('Native artifact root safety', () => {
  let projectRoot: string;
  let outside: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-paths-'));
    outside = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-outside-'));
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  it.each([
    ['.', '.'],
    ['docs', 'docs'],
    ['docs\\specs', 'docs/specs'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeArtifactRootRef(input)).toBe(expected);
  });

  it.each(['../docs', '/tmp/docs', 'C:\\docs', '~/.docs', ''])('rejects %s', (input) => {
    expect(() => normalizeArtifactRootRef(input)).toThrow();
  });

  it('accepts an in-project directory junction', async () => {
    const actual = path.join(projectRoot, 'actual');
    const link = path.join(projectRoot, 'linked');
    await fs.mkdir(actual);
    await fs.symlink(actual, link, process.platform === 'win32' ? 'junction' : 'dir');

    expect(await resolveArtifactRoot(projectRoot, 'linked')).toBe(link);
  });

  it('rejects a junction that escapes the project', async () => {
    const link = path.join(projectRoot, 'escaped');
    await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');

    await expect(resolveArtifactRoot(projectRoot, 'escaped')).rejects.toThrow(
      'resolves outside the project root',
    );
  });
});
