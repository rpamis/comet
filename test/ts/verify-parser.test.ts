import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { resolveVerify } from '../../src/dashboard/verify-parser.js';

describe('resolveVerify', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-verify-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns unknown when nothing is on disk and yaml has no verify_result', async () => {
    const result = await resolveVerify({ changeDir: tmpDir, yaml: {} });

    expect(result).toEqual({ result: 'unknown', reportExists: false });
  });

  it('reads the yaml verify_result when no report file exists', async () => {
    const result = await resolveVerify({
      changeDir: tmpDir,
      yaml: { verify_result: 'pass' },
    });

    expect(result).toEqual({ result: 'pass', reportExists: false });
  });

  it('treats unrecognized yaml values as unknown', async () => {
    const result = await resolveVerify({
      changeDir: tmpDir,
      yaml: { verify_result: 'maybe' },
    });

    expect(result.result).toBe('unknown');
  });

  it('detects a verify report at .comet/verify-result.md and extracts a summary', async () => {
    const reportPath = path.join(tmpDir, '.comet', 'verify-result.md');
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(
      reportPath,
      ['# Verify Report', '', 'Status: pass', 'All checks passed before archive.'].join('\n'),
    );

    const result = await resolveVerify({
      changeDir: tmpDir,
      yaml: { verify_result: 'pass' },
    });

    expect(result.result).toBe('pass');
    expect(result.reportExists).toBe(true);
    expect(result.summary).toContain('Status: pass');
  });

  it('honours an explicit verification_report path from yaml', async () => {
    const reportPath = path.join(tmpDir, 'docs', 'reports', 'change.md');
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, 'Regression failure: auth flow returns 500.\nSee #42.');

    const result = await resolveVerify({
      changeDir: tmpDir,
      yaml: {
        verify_result: 'fail',
        verification_report: 'docs/reports/change.md',
      },
    });

    expect(result).toMatchObject({ result: 'fail', reportExists: true });
    expect(result.summary).toContain('Regression failure');
  });

  it('ignores yaml verification_report when the file is missing', async () => {
    const result = await resolveVerify({
      changeDir: tmpDir,
      yaml: {
        verify_result: 'fail',
        verification_report: 'docs/reports/missing.md',
      },
    });

    expect(result.reportExists).toBe(false);
    expect(result.summary).toBeUndefined();
  });

  it('falls back to "fail" when only the report exists and yaml has nothing', async () => {
    const reportPath = path.join(tmpDir, '.comet', 'verify-result.md');
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, 'FAILED: 2 regressions detected.');

    const result = await resolveVerify({ changeDir: tmpDir, yaml: {} });

    expect(result.result).toBe('fail');
    expect(result.reportExists).toBe(true);
    expect(result.summary).toContain('FAILED');
  });
});
