import path from 'path';

import { serializeNativeVerificationMachineBlock } from './native-acceptance.js';
import { MAX_NATIVE_IMPLEMENTATION_EVIDENCE_DOCUMENT_BYTES } from './native-verification-scope.js';
import {
  assertNoArguments,
  NativeUsageError,
  readBoundedEvidenceFile,
  readBoundedEvidenceStdin,
  requiredPositional,
  success,
  takeOption,
  type DispatchResult,
} from './native-cli-shared.js';

export async function nativeEvidenceCommand(
  args: string[],
  _projectRoot: string,
): Promise<DispatchResult> {
  const subcommand = requiredPositional(args, 'evidence subcommand');
  if (subcommand === 'format') {
    const entriesPath = takeOption(args, '--entries');
    assertNoArguments(args);
    let raw: string;
    if (entriesPath) {
      raw = await readBoundedEvidenceFile(
        path.resolve(entriesPath),
        MAX_NATIVE_IMPLEMENTATION_EVIDENCE_DOCUMENT_BYTES,
      );
    } else {
      if (process.stdin.isTTY) {
        throw new NativeUsageError(
          'evidence format requires acceptance evidence entries JSON on stdin, or --entries <path>',
        );
      }
      raw = await readBoundedEvidenceStdin(MAX_NATIVE_IMPLEMENTATION_EVIDENCE_DOCUMENT_BYTES);
    }
    let entries: unknown;
    try {
      entries = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `Acceptance evidence entries must be valid JSON: ${(error as Error).message}`,
        { cause: error },
      );
    }
    if (!Array.isArray(entries)) {
      throw new Error('Acceptance evidence entries must be a JSON array');
    }
    const block = serializeNativeVerificationMachineBlock(entries);
    return success('evidence format', { block }, `${block}\n`);
  }
  throw new NativeUsageError(`Unknown evidence command: ${subcommand}`);
}
