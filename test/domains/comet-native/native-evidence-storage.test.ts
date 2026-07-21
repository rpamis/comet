import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createNativeChange,
  nativeChangeDir,
} from '../../../domains/comet-native/native-change.js';
import {
  MAX_NATIVE_EVIDENCE_DOCUMENT_BYTES,
  readNativeImplementationScope,
  readNativePartialAllowance,
  readNativeVerificationEvidence,
  writeNativeImplementationScope,
  writeNativePartialAllowance,
  writeNativeVerificationReportSnapshot,
  writeNativeVerificationEvidence,
} from '../../../domains/comet-native/native-evidence-storage.js';
import { canonicalHash } from '../../../domains/comet-native/native-canonical-hash.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import type {
  NativeContentSnapshotManifest,
  NativeProjectPaths,
} from '../../../domains/comet-native/native-types.js';
import {
  buildNativeImplementationScopeBundle,
  NATIVE_IMPLEMENTATION_SCOPE_SCHEMA,
} from '../../../domains/comet-native/native-verification-scope.js';
import {
  buildNativeAcceptanceEvidenceTrace,
  buildNativePartialAllowance,
  buildNativeVerificationEvidenceEnvelope,
} from '../../../domains/comet-native/native-verification-evidence.js';
import { buildNativeContractSnapshot } from '../../../domains/comet-native/native-contract.js';

function snapshot(
  entries: NativeContentSnapshotManifest['entries'],
): NativeContentSnapshotManifest {
  return {
    schema: 'comet.native.content-snapshot.v1',
    origin: 'explicit',
    createdAt: '2026-07-17T00:00:00.000Z',
    complete: true,
    limits: {
      maxFiles: 10,
      maxFileBytes: 1024,
      maxTotalBytes: 4096,
      maxManifestBytes: 4096,
    },
    entries,
    omitted: [],
    omittedCount: 0,
  };
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value, null, 2) + '\n', 'utf8');
}

describe('Native evidence storage', () => {
  let projectRoot: string;
  let paths: NativeProjectPaths;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-evidence-'));
    paths = await nativeProjectPaths(projectRoot, '.');
    await createNativeChange({ paths, name: 'secure-login', language: 'en' });
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  function fixtures() {
    const contract = buildNativeContractSnapshot({
      briefMarkdown: '# Acceptance examples\n- Login succeeds.\n',
      specs: [],
    });
    const bundle = buildNativeImplementationScopeBundle({
      baseline: snapshot([]),
      current: snapshot([{ path: 'src/login.ts', hash: 'a'.repeat(64), size: 10, type: 'file' }]),
      contractHash: contract.contractHash,
      declaredArtifacts: [],
    });
    const { scope } = bundle;
    const trace = buildNativeAcceptanceEvidenceTrace(
      contract.acceptance,
      [{ acceptance_id: contract.acceptance[0].id, evidence_refs: ['test/login.test.ts'] }],
      { nativeRootRef: 'comet' },
    );
    return { bundle, contract, scope, trace };
  }

  it('round-trips content-addressed scope, allowance, and verification documents', async () => {
    const { bundle, contract, scope, trace } = fixtures();
    const scopeRef = await writeNativeImplementationScope({
      paths,
      name: 'secure-login',
      bundle,
    });
    const scopeIds = scope.unresolvedScopes.map((entry) => entry.id);
    const allowance = buildNativePartialAllowance({
      change: 'secure-login',
      scopeBundle: bundle,
      allowedScopeIds: scopeIds,
      reason: 'Known fixture boundary',
      confirmedSummary: 'Accepted the exact partial boundary',
      sourceRevision: 2,
      now: new Date('2026-07-17T00:00:00.000Z'),
    });
    const allowanceRef = await writeNativePartialAllowance({
      paths,
      name: 'secure-login',
      allowance,
    });
    const evidence = buildNativeVerificationEvidenceEnvelope({
      change: 'secure-login',
      sourceRevision: 3,
      result: 'pass',
      contractHash: contract.contractHash,
      acceptanceHash: contract.acceptanceHash,
      implementationScope: { ref: scopeRef, bundle },
      reportRef: 'verification.md',
      reportHash: createHash('sha256').update('Verification passed.').digest('hex'),
      acceptanceTrace: trace,
      partialAllowance: { ref: allowanceRef, allowance },
      now: new Date('2026-07-17T00:00:00.000Z'),
    });
    await writeNativeVerificationReportSnapshot({
      paths,
      name: 'secure-login',
      hash: evidence.reportHash,
      text: 'Verification passed.',
    });
    const evidenceRef = await writeNativeVerificationEvidence({
      paths,
      name: 'secure-login',
      evidence,
    });

    expect(await readNativeImplementationScope(paths, 'secure-login', scopeRef)).toEqual(scope);
    expect(await readNativePartialAllowance(paths, 'secure-login', allowanceRef)).toEqual(
      allowance,
    );
    expect(await readNativeVerificationEvidence(paths, 'secure-login', evidenceRef)).toEqual(
      evidence,
    );
  });

  it('rejects tampering and a ref whose filename does not match the content hash', async () => {
    const { bundle } = fixtures();
    const ref = await writeNativeImplementationScope({
      paths,
      name: 'secure-login',
      bundle,
    });
    const file = path.join(nativeChangeDir(paths, 'secure-login'), ...ref.split('/'));
    const value = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
    value.complete = true;
    await fs.writeFile(file, JSON.stringify(value));

    await expect(readNativeImplementationScope(paths, 'secure-login', ref)).rejects.toThrow(
      /unresolved scopes|content hash mismatch/iu,
    );
    await expect(
      readNativeImplementationScope(
        paths,
        'secure-login',
        `runtime/evidence/scopes/${'f'.repeat(64)}.json`,
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a deeply invalid document even when its content address is refreshed', async () => {
    const { scope } = fixtures();
    const malformed = structuredClone(scope) as typeof scope & {
      changes: Array<(typeof scope.changes)[number] & { after: { trusted?: boolean } }>;
    };
    malformed.changes[0].after!.trusted = true;
    const content = { ...malformed } as Partial<typeof malformed>;
    delete content.scopeHash;
    malformed.scopeHash = canonicalHash(NATIVE_IMPLEMENTATION_SCOPE_SCHEMA, content);
    const ref = `runtime/evidence/scopes/${malformed.scopeHash}.json`;
    const file = path.join(nativeChangeDir(paths, 'secure-login'), ...ref.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(malformed));

    await expect(readNativeImplementationScope(paths, 'secure-login', ref)).rejects.toThrow(
      'unknown field',
    );
  });

  it('rebuilds persisted snapshot omissions instead of trusting a self-rehashed scope', async () => {
    const { contract } = fixtures();
    const baseline = {
      ...snapshot([]),
      complete: false,
      omitted: [
        { path: 'secret.ts', size: 1, type: 'file' as const, reason: 'file-size' as const },
      ],
      omittedCount: 1,
    };
    const bundle = buildNativeImplementationScopeBundle({
      baseline,
      current: snapshot([]),
      contractHash: contract.contractHash,
      declaredArtifacts: [],
      noCodeReason: 'No visible content changed.',
    });
    await writeNativeImplementationScope({ paths, name: 'secure-login', bundle });

    const forged = structuredClone(bundle.scope);
    forged.complete = true;
    forged.unresolvedScopes = [];
    const content = { ...forged } as Partial<typeof forged>;
    delete content.scopeHash;
    forged.scopeHash = canonicalHash(NATIVE_IMPLEMENTATION_SCOPE_SCHEMA, content);
    const ref = `runtime/evidence/scopes/${forged.scopeHash}.json`;
    const file = path.join(nativeChangeDir(paths, 'secure-login'), ...ref.split('/'));
    await fs.writeFile(file, JSON.stringify(forged));

    await expect(readNativeImplementationScope(paths, 'secure-login', ref)).rejects.toThrow(
      'does not match its authoritative bundle',
    );
  });

  it('does not persist a caller-rewritten scope outside its build authority', async () => {
    const { bundle } = fixtures();
    const forged = structuredClone(bundle);
    const declaration = { path: 'src/login.ts', kind: 'file' as const };
    forged.scope.declaredArtifacts = [declaration];
    forged.scope.changes[0].attributedTo = [declaration];
    forged.scope.unattributed = [];
    forged.scope.unresolvedScopes = [];
    forged.scope.complete = true;
    const content = { ...forged.scope } as Partial<typeof forged.scope>;
    delete content.scopeHash;
    forged.scope.scopeHash = canonicalHash(NATIVE_IMPLEMENTATION_SCOPE_SCHEMA, content);

    await expect(
      writeNativeImplementationScope({ paths, name: 'secure-login', bundle: forged }),
    ).rejects.toThrow('does not match its authoritative bundle');
    const file = path.join(
      nativeChangeDir(paths, 'secure-login'),
      ...`runtime/evidence/scopes/${forged.scope.scopeHash}.json`.split('/'),
    );
    await expect(fs.lstat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects snapshot projection content tampering and ref/hash rebinding', async () => {
    const { bundle } = fixtures();
    await writeNativeImplementationScope({ paths, name: 'secure-login', bundle });
    const baselineFile = path.join(
      nativeChangeDir(paths, 'secure-login'),
      ...bundle.scope.baselineProjectionRef.split('/'),
    );
    await fs.writeFile(baselineFile, JSON.stringify(bundle.current));
    await expect(
      readNativeImplementationScope(
        paths,
        'secure-login',
        `runtime/evidence/scopes/${bundle.scope.scopeHash}.json`,
      ),
    ).rejects.toThrow('content hash mismatch');

    await fs.writeFile(baselineFile, JSON.stringify(bundle.baseline));
    const rebound = structuredClone(bundle.scope);
    rebound.baselineProjectionRef = rebound.currentProjectionRef;
    rebound.baselineProjectionHash = rebound.currentProjectionHash;
    const reboundContent = { ...rebound } as Partial<typeof rebound>;
    delete reboundContent.scopeHash;
    rebound.scopeHash = canonicalHash(NATIVE_IMPLEMENTATION_SCOPE_SCHEMA, reboundContent);
    const reboundRef = `runtime/evidence/scopes/${rebound.scopeHash}.json`;
    const reboundFile = path.join(nativeChangeDir(paths, 'secure-login'), ...reboundRef.split('/'));
    await fs.writeFile(reboundFile, JSON.stringify(rebound));

    await expect(readNativeImplementationScope(paths, 'secure-login', reboundRef)).rejects.toThrow(
      'does not match its authoritative bundle',
    );
  });

  it('drops oversized Git-only advisory detail before returning a persistable scope', async () => {
    const { contract } = fixtures();
    const largeBundle = buildNativeImplementationScopeBundle({
      baseline: snapshot([]),
      current: snapshot([{ path: 'src/login.ts', hash: 'a'.repeat(64), size: 10, type: 'file' }]),
      contractHash: contract.contractHash,
      declaredArtifacts: [{ path: 'src/login.ts', kind: 'file' }],
      gitChangedPaths: Array.from(
        { length: 15_000 },
        (_, index) => `external/${String(index).padStart(5, '0')}-${'x'.repeat(32)}.ts`,
      ),
    });
    const { scope: largeScope } = largeBundle;
    expect(serializedBytes(largeScope)).toBeLessThanOrEqual(MAX_NATIVE_EVIDENCE_DOCUMENT_BYTES);
    expect(largeScope.gitAdvisory).toBeUndefined();

    await expect(
      writeNativeImplementationScope({ paths, name: 'secure-login', bundle: largeBundle }),
    ).resolves.toMatch(/^runtime\/evidence\/scopes\//u);
    const file = path.join(
      nativeChangeDir(paths, 'secure-login'),
      ...`runtime/evidence/scopes/${largeScope.scopeHash}.json`.split('/'),
    );
    await expect(fs.lstat(file)).resolves.toMatchObject({ isFile: expect.any(Function) });
  });

  it('persists a scope whose oversized derived change set is represented by bounded overflow evidence', async () => {
    const { contract } = fixtures();
    const entries = Array.from({ length: 2_000 }, (_, index) => ({
      path: `generated/${String(index).padStart(5, '0')}-${'x'.repeat(80)}.ts`,
      hash: 'a'.repeat(64),
      size: 1,
      type: 'file' as const,
    }));
    const largeSnapshot: NativeContentSnapshotManifest = {
      ...snapshot([]),
      limits: {
        maxFiles: 3_000,
        maxFileBytes: 1_024,
        maxTotalBytes: 10_000,
        maxManifestBytes: MAX_NATIVE_EVIDENCE_DOCUMENT_BYTES,
      },
      entries,
    };
    const bundle = buildNativeImplementationScopeBundle({
      baseline: snapshot([]),
      current: largeSnapshot,
      contractHash: contract.contractHash,
      declaredArtifacts: [],
    });

    expect(bundle.scope.unresolvedScopes).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'scope-detail-overflow' })]),
    );
    const ref = await writeNativeImplementationScope({
      paths,
      name: 'secure-login',
      bundle,
    });
    await expect(readNativeImplementationScope(paths, 'secure-login', ref)).resolves.toEqual(
      bundle.scope,
    );
  });

  it('streams overflow for ten thousand changes owned by 128 overlapping artifacts', async () => {
    const { contract } = fixtures();
    const segments = Array.from({ length: 128 }, () => 'a');
    const artifactPaths = segments.map((_, index) => segments.slice(0, index + 1).join('/'));
    const generatedRoot = artifactPaths.at(-1)!;
    const entries = Array.from({ length: 10_000 }, (_, index) => ({
      path: `${generatedRoot}/${String(index).padStart(5, '0')}.ts`,
      hash: 'a'.repeat(64),
      size: 1,
      type: 'file' as const,
    }));
    const current: NativeContentSnapshotManifest = {
      ...snapshot([]),
      limits: {
        maxFiles: 10_000,
        maxFileBytes: 1_024,
        maxTotalBytes: 20_000,
        maxManifestBytes: 8 * 1024 * 1024,
      },
      entries,
    };
    const bundle = buildNativeImplementationScopeBundle({
      baseline: snapshot([]),
      current,
      contractHash: contract.contractHash,
      declaredArtifacts: artifactPaths.map((artifactPath) => ({
        path: artifactPath,
        kind: 'directory' as const,
      })),
    });

    expect(bundle.scope.changes.length).toBeGreaterThan(0);
    expect(bundle.scope.changes.length).toBeLessThan(128);
    expect(bundle.scope.changes[0]?.attributedTo).toHaveLength(128);
    expect(bundle.scope.unresolvedScopes).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'scope-detail-overflow' })]),
    );
    expect(
      [bundle.baseline, bundle.current, bundle.scope].every(
        (document) => serializedBytes(document) <= MAX_NATIVE_EVIDENCE_DOCUMENT_BYTES,
      ),
    ).toBe(true);

    const ref = await writeNativeImplementationScope({ paths, name: 'secure-login', bundle });
    await expect(readNativeImplementationScope(paths, 'secure-login', ref)).resolves.toEqual(
      bundle.scope,
    );
  });

  it('persists one huge unattributed change entirely as scope overflow', async () => {
    const { contract } = fixtures();
    const hugePath = `generated/${'x'.repeat(400_000)}.ts`;
    const current: NativeContentSnapshotManifest = {
      ...snapshot([]),
      limits: {
        maxFiles: 10,
        maxFileBytes: 1_024,
        maxTotalBytes: 10_000,
        maxManifestBytes: 8 * 1024 * 1024,
      },
      entries: [{ path: hugePath, hash: 'a'.repeat(64), size: 1, type: 'file' }],
    };
    const bundle = buildNativeImplementationScopeBundle({
      baseline: snapshot([]),
      current,
      contractHash: contract.contractHash,
      declaredArtifacts: [],
    });

    expect(bundle.scope.changes).toEqual([]);
    expect(bundle.scope.unattributed).toEqual([]);
    expect(bundle.scope.unresolvedScopes).toEqual([
      expect.objectContaining({
        kind: 'scope-detail-overflow',
        reason: expect.stringContaining('1 additional change details'),
      }),
    ]);
    expect(serializedBytes(bundle.scope)).toBeLessThanOrEqual(MAX_NATIVE_EVIDENCE_DOCUMENT_BYTES);

    const ref = await writeNativeImplementationScope({ paths, name: 'secure-login', bundle });
    await expect(readNativeImplementationScope(paths, 'secure-login', ref)).resolves.toEqual(
      bundle.scope,
    );
  });

  it('fits each snapshot projection to one megabyte before writing', async () => {
    const { contract } = fixtures();
    const entries = Array.from({ length: 6_500 }, (_, index) => ({
      path: `src/generated/${String(index).padStart(5, '0')}-${'x'.repeat(32)}.ts`,
      hash: 'a'.repeat(64),
      size: 1,
      type: 'file' as const,
    }));
    const largeSnapshot: NativeContentSnapshotManifest = {
      ...snapshot([]),
      limits: {
        maxFiles: 7_000,
        maxFileBytes: 1_024,
        maxTotalBytes: 10_000,
        maxManifestBytes: 4 * 1024 * 1024,
      },
      entries,
    };
    const bundle = buildNativeImplementationScopeBundle({
      baseline: largeSnapshot,
      current: { ...largeSnapshot, createdAt: '2026-07-18T00:00:00.000Z' },
      contractHash: contract.contractHash,
      declaredArtifacts: [],
      noCodeReason: 'Generated tree is unchanged.',
    });
    expect(serializedBytes(bundle.baseline)).toBeLessThanOrEqual(
      MAX_NATIVE_EVIDENCE_DOCUMENT_BYTES,
    );
    expect(bundle.baseline.omissionOverflow).toEqual(
      expect.objectContaining({
        count: expect.any(Number),
        hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );

    const ref = await writeNativeImplementationScope({
      paths,
      name: 'secure-login',
      bundle,
    });
    await expect(readNativeImplementationScope(paths, 'secure-login', ref)).resolves.toEqual(
      bundle.scope,
    );
    const file = path.join(
      nativeChangeDir(paths, 'secure-login'),
      ...bundle.scope.baselineProjectionRef.split('/'),
    );
    await expect(fs.lstat(file)).resolves.toMatchObject({ isFile: expect.any(Function) });
  });

  it('persists bounded documents even when the transient authority bundle exceeds three megabytes', async () => {
    const { contract } = fixtures();
    const entries = Array.from({ length: 4_000 }, (_, index) => ({
      path: `src/generated/${String(index).padStart(5, '0')}-${'x'.repeat(36)}.ts`,
      hash: 'a'.repeat(64),
      size: 1,
      type: 'file' as const,
    }));
    const denseSnapshot: NativeContentSnapshotManifest = {
      ...snapshot(entries),
      limits: {
        maxFiles: 10_000,
        maxFileBytes: 1_024,
        maxTotalBytes: 16 * 1024 * 1024,
        maxManifestBytes: MAX_NATIVE_EVIDENCE_DOCUMENT_BYTES,
      },
    };
    const bundle = buildNativeImplementationScopeBundle({
      baseline: denseSnapshot,
      current: { ...denseSnapshot, createdAt: '2026-07-18T00:00:00.000Z' },
      contractHash: contract.contractHash,
      declaredArtifacts: [],
      noCodeReason: 'Generated tree is unchanged.',
      gitChangedPaths: Array.from(
        { length: 7_700 },
        (_, index) => `outside/${String(index).padStart(5, '0')}-${'y'.repeat(40)}.ts`,
      ),
    });
    const documentSizes = [bundle.baseline, bundle.current, bundle.scope].map(serializedBytes);
    expect(
      documentSizes.every((size) => size <= MAX_NATIVE_EVIDENCE_DOCUMENT_BYTES),
      `document sizes: ${documentSizes.join(', ')}`,
    ).toBe(true);
    expect(serializedBytes(bundle)).toBeGreaterThan(3 * MAX_NATIVE_EVIDENCE_DOCUMENT_BYTES);

    const ref = await writeNativeImplementationScope({ paths, name: 'secure-login', bundle });
    await expect(readNativeImplementationScope(paths, 'secure-login', ref)).resolves.toEqual(
      bundle.scope,
    );
  });

  it('detects replacement of an evidence parent after its identity is captured', async () => {
    const { bundle } = fixtures();
    const ref = await writeNativeImplementationScope({
      paths,
      name: 'secure-login',
      bundle,
    });
    const file = path.join(nativeChangeDir(paths, 'secure-login'), ...ref.split('/'));
    const parent = path.dirname(file);
    const displaced = `${parent}-displaced`;
    const original = await fs.readFile(file, 'utf8');

    await expect(
      readNativeImplementationScope(paths, 'secure-login', ref, {
        afterParentChainCaptured: async () => {
          await fs.rename(parent, displaced);
          await fs.mkdir(parent);
          await fs.writeFile(path.join(parent, path.basename(file)), original);
        },
      }),
    ).rejects.toThrow('parent changed');
  });

  it.runIf(process.platform === 'win32')(
    'rejects a junction in the evidence parent chain',
    async () => {
      const { bundle } = fixtures();
      const evidenceRoot = path.join(nativeChangeDir(paths, 'secure-login'), 'runtime', 'evidence');
      const redirected = path.join(paths.specsDir, 'redirected-evidence');
      await fs.mkdir(redirected, { recursive: true });
      await fs.mkdir(path.dirname(evidenceRoot), { recursive: true });
      await fs.symlink(redirected, evidenceRoot, 'junction');

      await expect(
        writeNativeImplementationScope({ paths, name: 'secure-login', bundle }),
      ).rejects.toThrow(/real directory|symlink/iu);
      await expect(fs.readdir(redirected)).resolves.toEqual([]);
    },
  );

  it.runIf(process.platform === 'win32')(
    'does not trust an idempotent write through a replacement junction',
    async () => {
      const { bundle } = fixtures();
      const ref = await writeNativeImplementationScope({
        paths,
        name: 'secure-login',
        bundle,
      });
      const changeRoot = nativeChangeDir(paths, 'secure-login');
      const evidenceRoot = path.join(changeRoot, 'runtime', 'evidence');
      const displaced = path.join(changeRoot, 'runtime', 'evidence-displaced');
      const redirected = path.join(paths.specsDir, 'redirected-existing-evidence');
      await fs.rename(evidenceRoot, displaced);
      await fs.mkdir(redirected, { recursive: true });
      const redirectedFile = path.join(redirected, ...ref.split('/').slice(2));
      await fs.mkdir(path.dirname(redirectedFile), { recursive: true });
      await fs.copyFile(path.join(displaced, ...ref.split('/').slice(2)), redirectedFile);
      await fs.symlink(redirected, evidenceRoot, 'junction');

      await expect(
        writeNativeImplementationScope({ paths, name: 'secure-login', bundle }),
      ).rejects.toThrow(/outside|symlink|real directory/iu);
    },
  );
});
