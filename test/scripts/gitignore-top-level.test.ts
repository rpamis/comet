import { describe, expect, it } from 'vitest';
import {
  readGitignoredDirectoryEntries,
  readGitignoredTopLevelEntries,
} from '../../scripts/lint/gitignore-top-level.mjs';

describe('gitignore top-level entry parsing', () => {
  it('collects plain top-level ignored names and skips nested or wildcard patterns', () => {
    const ignored = readGitignoredTopLevelEntries(process.cwd());

    expect(ignored.has('.pnpm-store')).toBe(true);
    expect(ignored.has('node_modules')).toBe(true);
    expect(ignored.has('dist')).toBe(true);
    expect(ignored.has('coverage')).toBe(true);
    expect(ignored.has('*.log')).toBe(false);
    expect(ignored.has('eval')).toBe(false);
    expect(ignored.has('**/nul')).toBe(false);
  });

  it('collects exact ignored directory paths for repository scans', () => {
    const ignored = readGitignoredDirectoryEntries(process.cwd());

    expect(ignored.has('node_modules')).toBe(true);
    expect(ignored.has('eval/.uv-cache')).toBe(true);
    expect(ignored.has('eval/.cache')).toBe(true);
    expect(ignored.has('eval/local/logs')).toBe(true);
    expect(ignored.has('*.log')).toBe(false);
    expect(ignored.has('eval/**/__pycache__')).toBe(false);
  });
});
