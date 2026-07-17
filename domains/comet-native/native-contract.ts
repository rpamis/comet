import path from 'node:path';

import {
  deriveBriefAcceptanceCriteria,
  deriveSpecAcceptanceCriteria,
  NATIVE_ACCEPTANCE_LIMITS,
  type NativeAcceptanceCriterion,
} from './native-acceptance.js';
import { canonicalHash } from './native-canonical-hash.js';

const CONTRACT_HASH_TAG = 'comet.native.contract.v1';
const ACCEPTANCE_SET_HASH_TAG = 'comet.native.acceptance-set.v1';
const HASH_PATTERN = /^[a-f0-9]{64}$/u;

export const NATIVE_CONTRACT_LIMITS = {
  maxAcceptanceCriteria: NATIVE_ACCEPTANCE_LIMITS.maxCriteria,
} as const;

export interface NativeContractSpecInput {
  capability: string;
  operation: 'create' | 'replace' | 'remove';
  source: string | null;
  baseHash: string | null;
  markdown: string | null;
}

export interface NativeContractSpecSnapshot {
  capability: string;
  operation: NativeContractSpecInput['operation'];
  source: string | null;
  baseHash: string | null;
  contentHash: string | null;
}

export interface NativeContractSnapshot {
  schema: 'comet.native.contract.v1';
  brief: {
    source: string;
    contentHash: string;
  };
  specs: NativeContractSpecSnapshot[];
  acceptance: NativeAcceptanceCriterion[];
  acceptanceHash: string;
  contractHash: string;
}

function portableRef(value: string, label: string): string {
  const normalized = path.posix.normalize(value);
  if (
    value.length === 0 ||
    value !== value.trim() ||
    value.includes('\\') ||
    Array.from(value).some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || code === 0x7f;
    }) ||
    path.posix.isAbsolute(normalized) ||
    /^(?:[A-Za-z]:|~)/u.test(value) ||
    value.split('/').includes('..') ||
    normalized !== value ||
    normalized === '.' ||
    value.endsWith('/')
  ) {
    throw new Error(`${label} must be a normalized project-relative ref`);
  }
  return value;
}

function contentHash(value: string): string {
  return canonicalHash('comet.native.contract-content.v1', value.replace(/\r\n?/gu, '\n'));
}

function normalizeSpec(input: NativeContractSpecInput): {
  snapshot: NativeContractSpecSnapshot;
  markdown: string | null;
} {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(input.capability)) {
    throw new Error(`Invalid Native contract capability: ${input.capability}`);
  }
  if (
    input.operation !== 'create' &&
    input.operation !== 'replace' &&
    input.operation !== 'remove'
  ) {
    throw new Error(`Invalid Native contract operation for ${input.capability}`);
  }
  if (input.operation === 'remove') {
    if (input.source !== null || input.markdown !== null || !input.baseHash?.match(HASH_PATTERN)) {
      throw new Error(`Remove contract ${input.capability} requires only a base hash`);
    }
    return {
      snapshot: {
        capability: input.capability,
        operation: 'remove',
        source: null,
        baseHash: input.baseHash,
        contentHash: null,
      },
      markdown: null,
    };
  }
  if (input.source === null || input.markdown === null) {
    throw new Error(`${input.operation} contract ${input.capability} requires source content`);
  }
  if (input.operation === 'create' && input.baseHash !== null) {
    throw new Error(`Create contract ${input.capability} requires a null base hash`);
  }
  if (input.operation === 'replace' && !input.baseHash?.match(HASH_PATTERN)) {
    throw new Error(`Replace contract ${input.capability} requires a base hash`);
  }
  const source = portableRef(input.source, `Contract source for ${input.capability}`);
  return {
    snapshot: {
      capability: input.capability,
      operation: input.operation,
      source,
      baseHash: input.baseHash,
      contentHash: contentHash(input.markdown),
    },
    markdown: input.markdown,
  };
}

function compareCriteria(
  left: NativeAcceptanceCriterion,
  right: NativeAcceptanceCriterion,
): number {
  return compareText(left.id, right.id);
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Build a deterministic contract projection from already bounded artifact contents.
 *
 * Filesystem reads deliberately stay outside this pure function so callers can apply
 * the Native path, size, symlink, and revision boundaries appropriate to their seam.
 */
export function buildNativeContractSnapshot(input: {
  briefSource?: string;
  briefMarkdown: string;
  specs: readonly NativeContractSpecInput[];
}): NativeContractSnapshot {
  const briefSource = portableRef(input.briefSource ?? 'brief.md', 'Native brief source');
  const specs = input.specs
    .map(normalizeSpec)
    .sort((left, right) => compareText(left.snapshot.capability, right.snapshot.capability));
  const capabilities = specs.map(({ snapshot }) => snapshot.capability);
  if (new Set(capabilities).size !== capabilities.length) {
    throw new Error('Native contract contains duplicate capabilities');
  }
  const sources = [
    briefSource,
    ...specs.flatMap(({ snapshot }) => (snapshot.source === null ? [] : [snapshot.source])),
  ];
  if (new Set(sources).size !== sources.length) {
    throw new Error('Native contract contains duplicate artifact sources');
  }

  const acceptance = deriveBriefAcceptanceCriteria(
    input.briefMarkdown,
    briefSource,
    NATIVE_CONTRACT_LIMITS.maxAcceptanceCriteria,
  );
  for (const { snapshot, markdown } of specs) {
    if (markdown === null || snapshot.source === null) continue;
    acceptance.push(
      ...deriveSpecAcceptanceCriteria(
        markdown,
        snapshot.source,
        NATIVE_CONTRACT_LIMITS.maxAcceptanceCriteria - acceptance.length,
      ),
    );
  }
  acceptance.sort(compareCriteria);
  if (acceptance.length === 0) {
    throw new Error('Native contract has no structured acceptance criteria');
  }
  if (acceptance.length > NATIVE_CONTRACT_LIMITS.maxAcceptanceCriteria) {
    throw new Error(
      `Native contract exceeds its ${NATIVE_CONTRACT_LIMITS.maxAcceptanceCriteria}-criterion acceptance budget`,
    );
  }
  const acceptanceIds = acceptance.map(({ id }) => id);
  if (new Set(acceptanceIds).size !== acceptanceIds.length) {
    throw new Error('Native contract contains duplicate acceptance criteria');
  }

  const brief = { source: briefSource, contentHash: contentHash(input.briefMarkdown) };
  const specSnapshots = specs.map(({ snapshot }) => snapshot);
  const acceptanceHash = canonicalHash(ACCEPTANCE_SET_HASH_TAG, acceptance);
  const contractContent = {
    schema: 'comet.native.contract.v1' as const,
    brief,
    specs: specSnapshots,
    acceptance,
    acceptanceHash,
  };
  return {
    ...contractContent,
    contractHash: canonicalHash(CONTRACT_HASH_TAG, contractContent),
  };
}
