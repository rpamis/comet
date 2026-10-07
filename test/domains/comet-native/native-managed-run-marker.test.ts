import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasNativeManagedRunMarker } from '../../../domains/comet-native/native-sdk-state-store.js';
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
describe('Native managed Run marker discovery', () => {
  it.each([true, false])(
    'reads only the marker prefix from a large artifact (managed=%s)',
    async (managed) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-marker-prefix-'));
      roots.push(root);
      const file = path.join(root, 'comet-state.yaml');
      await fs.writeFile(
        file,
        (managed ? '# comet-execution: managed-run\n' : 'schema: comet.native.v4\n') +
          'x'.repeat(2 * 1024 * 1024),
      );
      const read = vi.spyOn(fs, 'readFile');
      expect(await hasNativeManagedRunMarker(file)).toBe(managed);
      expect(read).not.toHaveBeenCalled();
    },
  );
});
