import type { NativeWorkspaceBinding } from './native-workspace.js';
import type { NativeWorkspacePreparation } from './native-workspace-preparation.js';

export class NativeChangeRevisionConflictError extends Error {
  readonly code = 'native-change-revision-conflict';

  constructor(
    readonly change: string,
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(
      `Native change ${change} revision conflict: expected ${expectedRevision}, actual ${actualRevision}`,
    );
    this.name = 'NativeChangeRevisionConflictError';
  }
}

export class NativeWorkspaceIsolationRequiredError extends Error {
  readonly code = 'native-workspace-isolation-required';

  constructor(
    readonly requestedIsolation: NativeWorkspaceBinding['isolation'],
    readonly activeChanges: string[],
  ) {
    super(
      `Native working directory already contains active change${activeChanges.length === 1 ? '' : 's'} ${activeChanges.join(', ')}; create the new change in a separate worktree`,
    );
    this.name = 'NativeWorkspaceIsolationRequiredError';
  }
}

export class NativeSpecConflictError extends Error {
  readonly code = 'native-spec-conflict';

  constructor(
    readonly capability: string,
    readonly expectedHash: string | null,
    readonly actualHash: string | null,
    readonly canonicalPath: string,
  ) {
    super(
      `Canonical spec conflict for ${capability}: expected ${expectedHash ?? '(missing)'}, actual ${actualHash ?? '(missing)'}`,
    );
    this.name = 'NativeSpecConflictError';
  }
}

export class NativeWorkspacePreparationError extends Error {
  constructor(
    message: string,
    readonly preparation: NativeWorkspacePreparation,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'NativeWorkspacePreparationError';
  }
}
