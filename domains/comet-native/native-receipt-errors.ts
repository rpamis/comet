export interface NativeReceiptFenceChangedPath {
  path: string;
  kind: 'added' | 'modified' | 'removed';
}

export interface NativeReceiptScopeRecovery {
  reason: 'implementation-scope-stale' | 'implementation-changed-during-command';
  commandExecuted: boolean;
  expectedScopeHash: string;
  actualScopeHash: string;
  expectedSnapshotHash: string;
  actualSnapshotHash: string;
  changedPaths: NativeReceiptFenceChangedPath[];
  changedPathCount: number;
  changedPathsTruncated: boolean;
  requiredAction: 'return-to-build-and-refresh-implementation-scope';
  nextCommand: string;
  requiresUserDecision: false;
}

export class NativeReceiptScopeStaleError extends Error {
  readonly recovery: NativeReceiptScopeRecovery;

  constructor(message: string, recovery: NativeReceiptScopeRecovery) {
    super(message);
    this.name = 'NativeReceiptScopeStaleError';
    this.recovery = recovery;
  }
}
