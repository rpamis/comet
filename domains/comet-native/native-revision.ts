export interface NativeRevisionedDocument {
  revision: number;
}

export interface NativeRevisionCasOptions<T extends NativeRevisionedDocument> {
  expectedRevision: number;
  next: T;
  read: () => Promise<T>;
  write: (next: T) => Promise<void>;
  equals?: (left: T, right: T) => boolean;
  conflict: (actualRevision: number) => Error;
}

function validRevision(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1;
}

/**
 * Shared revision/CAS protocol for Native runtime documents.
 *
 * The caller owns the mutation or transaction lock around this operation. The
 * idempotent branch lets journal recovery safely replay a write that reached
 * disk before the process stopped.
 */
export async function compareAndSwapNativeRevision<T extends NativeRevisionedDocument>(
  options: NativeRevisionCasOptions<T>,
): Promise<T> {
  if (!validRevision(options.expectedRevision)) {
    throw new Error('Native expected revision must be a positive integer');
  }
  if (options.next.revision !== options.expectedRevision + 1) {
    throw new Error('Native CAS next revision must increment the expected revision exactly once');
  }
  const current = await options.read();
  if (!validRevision(current.revision)) {
    throw new Error('Native current revision must be a positive integer');
  }
  const equals =
    options.equals ?? ((left, right) => JSON.stringify(left) === JSON.stringify(right));
  if (current.revision === options.next.revision && equals(current, options.next)) {
    return current;
  }
  if (current.revision !== options.expectedRevision) {
    throw options.conflict(current.revision);
  }
  await options.write(options.next);
  return options.next;
}
