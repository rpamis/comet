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

    expect(source).toContain('NATIVE_CHANGE_PAGE_SIZE = 5');
    expect(source).toContain('sourceChanges.slice(0, visibleChangeCount)');
    expect(source).toContain('serverPaged');
    expect(source).toContain('onLoadMore');
    expect(source).toContain('native-change-list');
    expect(source).toContain('onScroll={handleListScroll}');

    for (const field of [
      'native?.changes',
      'change.name',
      'change.phase',
      'change.loop',
      'change.loop.iteration',
      'change.loop.attempt',
      'change.loop.actor',
      'change.verificationResult',
      'change.specs',
      'change.acceptance',
      'change.acceptanceItems',
      'change.checks',
      'change.blockers',
      'change.history',
      'change.historyOverflow',
      'change.localExecution',
      'change.migration',
    ]) {
      expect(source).toContain(field);
    }

    for (const forbiddenField of [
      '.nextCommand',
      '.preflightHash',
      '.operationCount',
      '.command',
      '.requiredInputs',
      '.workspaceRelationship',
      '.signalCount',
      '.report',
      '.evidenceRefs',
      '.operations',
      '.verificationFreshness',
      '.archiveReady',
      '.continuation',
      '.findings',
      '.conflicts',
      '.implementation',
      '.repair',
      '.checkpoint',
      '.preflight',
      '.argvDisplay',
      '.cwdRef',
      '.operationId',
    ]) {
      expect(source).not.toContain(forbiddenField);
    }
  });

  it('keeps Native as a read-only optional panel in the existing dashboard', async () => {
    const [source, nativeSource] = await Promise.all([
      fs.readFile(path.resolve('domains', 'dashboard', 'web', 'src', 'main.jsx'), 'utf8'),
      readNativePanelSource(),
    ]);

    expect(source).toContain("from './native-workflow-panel.jsx'");
    expect(source).toContain("useState('classic')");
    expect(source).toContain("workflow === 'native'");
    expect(source).toContain('native={snapshot.native}');
    expect(source).toContain('git={snapshot.git}');
    expect(source).toContain('onPreview={setArtifact}');
    expect(source).toContain("from './workspace-layout.jsx'");
    expect(source).toContain('<DashboardWorkspaceRegion');
    expect(nativeSource).toContain('native-changes-explorer');
    expect(nativeSource).toContain('native-change-detail');
    expect(nativeSource).toContain('无法完成完整验证，只完成了自动检查');
    expect(nativeSource).toContain('你已确认接受不完整验证结果');
    expect(nativeSource).toContain('已完成检查，验证结果已确认');
    expect(source).not.toContain('<NativeWorkflowPanel native={snapshot.native} />');
  });

  it('renders an intentional full-width workspace state when the selected Native view is empty', async () => {
    const [source, styles] = await Promise.all([
      readNativePanelSource(),
      fs.readFile(path.resolve('domains', 'dashboard', 'web', 'src', 'styles.css'), 'utf8'),
    ]);

    expect(source).toContain('const isEmptyView = !pageLoading && visibleChanges.length === 0');
    expect(source).toContain('<NativeWorkspaceEmptyState native={native} emptyProject />');
    expect(source).toContain(
      '<NativeWorkspaceLoadingState native={native} tab={tab} onTab={onTab} />',
    );
    expect(source).toContain('role="tablist" aria-label="Native 变更范围"');
    expect(source).toContain('当前工作区没有进行中的变更');
    expect(styles).toContain('.native-workspace-empty-header');
    expect(styles).toContain('.native-workspace-empty-body');
  });

  it('renders Native parent children as an accessible expandable explorer tree', async () => {
    const [source, styles] = await Promise.all([
      readNativePanelSource(),
      fs.readFile(path.resolve('domains', 'dashboard', 'web', 'src', 'styles.css'), 'utf8'),
    ]);

    expect(source).toContain('childChangeReference');
    expect(source).toContain('childrenProgress(change)');
    expect(source).toContain('native-change-disclosure');
    expect(source).toContain('aria-expanded={expanded}');
    expect(source).toContain('aria-controls={childrenId}');
    expect(source).toContain('native-child-change-list');
    expect(source).toContain('native-child-change-row');
    expect(source).toContain('child.workspace.label');
    expect(styles).toContain('.native-child-change-list');
    expect(styles).toContain('.dashboard-workspace-label');
  });
});
