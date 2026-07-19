import { describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';

async function readNativePanelSource(): Promise<string> {
  return fs.readFile(
    path.resolve('domains', 'dashboard', 'web', 'src', 'native-workflow-panel.jsx'),
    'utf8',
  );
}

describe('Native dashboard web source contracts', () => {
  it('renders only the bounded Native workflow summaries', async () => {
    const source = await readNativePanelSource();

    for (const field of [
      'native.changes',
      'change.name',
      'change.phase',
      'change.verificationFreshness',
      'change.archiveReady',
      'change.continuation',
      'change.findings.codes',
      'change.conflicts.peers',
      'change.progress',
      'change.specs',
      'change.acceptance',
      'change.implementation',
      'change.repair',
      'peer.change',
      'peer.classification',
    ]) {
      expect(source).toContain(field);
    }

    for (const forbiddenField of [
      '.nextCommand',
      '.revision',
      '.verificationResult',
      '.preflightHash',
      '.operationCount',
      '.command',
      '.requiredInputs',
      '.workspaceRelationship',
      '.signalCount',
      '.path',
      '.report',
      '.evidenceRefs',
      '.operations',
      '.message',
    ]) {
      expect(source).not.toContain(forbiddenField);
    }
  });

  it('keeps Native as a read-only optional panel in the existing dashboard', async () => {
    const source = await fs.readFile(
      path.resolve('domains', 'dashboard', 'web', 'src', 'main.jsx'),
      'utf8',
    );

    expect(source).toContain("from './native-workflow-panel.jsx'");
    expect(source).toContain("useState('classic')");
    expect(source).toContain("workflow === 'native'");
    expect(source).toContain('native={snapshot.native}');
    expect(source).toContain('git={snapshot.git}');
    expect(source).toContain('onPreview={setArtifact}');
    expect(source).not.toContain('<NativeWorkflowPanel native={snapshot.native} />');
  });
});
