import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveCometEntryResumeProbe, readWorkflowProjectConfigDocument } = vi.hoisted(() => ({
  resolveCometEntryResumeProbe: vi.fn(),
  readWorkflowProjectConfigDocument: vi.fn(),
}));

vi.mock('../../domains/comet-entry/resume-probe.js', () => ({
  COMET_RESUME_PROBE_SCHEMA_VERSION: 'comet.entry.resume-probe.v1',
  resolveCometEntryResumeProbe,
}));
vi.mock('../../domains/workflow-contract/project-config-reader.js', () => ({
  readWorkflowProjectConfigDocument,
}));

import { resolveProjectLanguage, resumeProbeCommand } from '../../app/commands/resume-probe.js';

describe('resume-probe command branches', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resolveCometEntryResumeProbe.mockReset();
    readWorkflowProjectConfigDocument.mockReset();
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
  });

  it('formats every optional probe field and derives the workflow context', async () => {
    readWorkflowProjectConfigDocument.mockResolvedValue({
      config: { default_workflow: 'native' },
      native: { language: ' zh-CN ' },
      classic: { language: 'en' },
    });
    resolveCometEntryResumeProbe.mockResolvedValue({
      action: 'resume',
      confidence: 'high',
      reason: 'active change found',
      workflow: 'native',
      skill: 'comet-native',
      entrySource: 'ambient',
      changeName: 'demo-change',
      phase: 'build',
      nextCommand: 'comet native next demo-change',
    });

    await resumeProbeCommand('project', { utterance: 'continue' });

    expect(resolveCometEntryResumeProbe).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        utterance: 'continue',
        locale: 'zh-CN',
        agent_context: { non_trivial_work: true, already_in_comet_flow: false },
      }),
    );
    expect(stdoutWrite).toHaveBeenCalledWith(
      expect.stringContaining('entry_source: ambient\nchange: demo-change\nphase: build\n'),
    );
  });

  it('supports JSON output, empty utterances, and explicit non-work context', async () => {
    readWorkflowProjectConfigDocument.mockResolvedValue({
      config: { default_workflow: 'classic' },
      classic: { language: 'en' },
    });
    resolveCometEntryResumeProbe.mockResolvedValue({
      action: 'start',
      confidence: 'low',
      reason: 'no active change',
    });

    await resumeProbeCommand('project', {
      json: true,
      workflowWork: false,
      alreadyInCometFlow: true,
    });

    expect(resolveCometEntryResumeProbe).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        utterance: '',
        locale: 'en',
        agent_context: { non_trivial_work: false, already_in_comet_flow: true },
      }),
    );
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('"action": "start"'));
  });

  it.each([
    [
      'native language',
      { config: { default_workflow: 'native' }, native: { language: 'zh-CN' } },
      'zh-CN',
    ],
    [
      'classic language',
      { config: { default_workflow: 'classic' }, classic: { language: 'en' } },
      'en',
    ],
    [
      'native fallback',
      { config: { default_workflow: 'native' }, classic: { language: 'en' } },
      'en',
    ],
    ['missing config', null, 'unknown'],
    ['blank language', { native: { language: '  ' } }, 'unknown'],
  ])('resolves %s', async (_label, document, expected) => {
    readWorkflowProjectConfigDocument.mockResolvedValue(document);
    await expect(resolveProjectLanguage('project')).resolves.toBe(expected);
  });

  it('falls back to unknown when project config loading fails', async () => {
    readWorkflowProjectConfigDocument.mockRejectedValue(new Error('broken config'));
    await expect(resolveProjectLanguage('project')).resolves.toBe('unknown');
  });
});
