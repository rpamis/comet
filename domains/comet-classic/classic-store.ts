import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { Document, parseDocument } from 'yaml';
import {
  CLASSIC_WIRE_KEYS,
  classicStateToDocument,
  parseClassicStateDocument,
  readLegacyStateSummary,
  type ClassicStateProjection,
  type LegacyStateSummary,
} from './classic-state.js';
import {
  applyRunStateToDocument,
  readRunState,
  writeRunState,
  removeRunState,
  type StateDocument,
} from '../../domains/engine/state.js';

function documentRecord(document: Document): StateDocument {
  const value = document.toJS() as unknown;
  if (value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Classic state document: root must be a mapping');
  }
  return value as StateDocument;
}

function setIfChanged(document: Document, key: string, value: unknown): void {
  if (document.get(key) !== value) document.set(key, value);
}

function applyProjection(document: Document, projection: ClassicStateProjection): void {
  if (projection.classic) {
    for (const [key, value] of Object.entries(classicStateToDocument(projection.classic))) {
      setIfChanged(document, key, value);
    }
  } else {
    for (const key of CLASSIC_WIRE_KEYS) document.delete(key);
  }

  // Only write run_id as a link — full Run state lives in .comet/run-state.json
  applyRunStateToDocument(document.toJS() as StateDocument, projection.run);
  if (projection.run) {
    setIfChanged(document, 'run_id', projection.run.runId);
  } else {
    document.delete('run_id');
  }
}

/** Strip legacy Run fields from a yaml document (migration helper). */
function stripLegacyRunFields(document: Document): void {
  const LEGACY_RUN_KEYS = [
    'skill',
    'skill_version',
    'skill_hash',
    'orchestration',
    'current_step',
    'iteration',
    'pending',
    'pending_ref',
    'trajectory_ref',
    'context_ref',
    'artifacts_ref',
    'checkpoint_ref',
    'run_status',
    'run_retries',
  ];
  for (const key of LEGACY_RUN_KEYS) document.delete(key);
}

/** Strip removed command override fields from older change state files. */
function stripLegacyCommandFields(document: Document): boolean {
  let changed = false;
  for (const key of ['build_command', 'verify_command']) {
    if (document.has(key)) {
      document.delete(key);
      changed = true;
    }
  }
  return changed;
}

async function readDocument(file: string): Promise<Document> {
  let source: string;
  try {
    source = await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return new Document({});
  }

  const document = parseDocument(source);
  if (document.errors.length > 0) {
    throw new Error(`Invalid Classic state document: ${document.errors[0].message}`);
  }
  documentRecord(document);
  return document;
}

export async function readClassicState(changeDir: string): Promise<ClassicStateProjection> {
  const file = path.join(changeDir, '.comet.yaml');
  const document = await readDocument(file);
  let doc = documentRecord(document);
  let migrated = stripLegacyCommandFields(document);
  if (migrated) doc = documentRecord(document);

  // Try reading Run state from the new location first
  let run = await readRunState(changeDir);

  if (!run && doc.run_id && doc.skill) {
    // Legacy format: Run fields embedded in .comet.yaml — migrate
    const { runStateFromDocument } = await import('../../domains/engine/state.js');
    run = runStateFromDocument(doc);
    if (run) {
      await writeRunState(changeDir, run);
      stripLegacyRunFields(document);
      migrated = true;
    }
  }

  if (migrated) {
    const temporary = path.join(changeDir, `.comet.yaml.${randomUUID()}.tmp`);
    await fs.writeFile(temporary, document.toString(), 'utf8');
    await fs.rename(temporary, file);
  }

  return parseClassicStateDocument(documentRecord(document), run);
}

export async function readLegacyState(changeDir: string): Promise<LegacyStateSummary> {
  const document = await readDocument(path.join(changeDir, '.comet.yaml'));
  return readLegacyStateSummary(documentRecord(document));
}

export async function writeClassicState(
  changeDir: string,
  projection: Omit<ClassicStateProjection, 'unknownKeys'> & { unknownKeys?: string[] },
): Promise<void> {
  const file = path.join(changeDir, '.comet.yaml');
  const document = await readDocument(file);
  applyProjection(document, {
    ...projection,
    unknownKeys: projection.unknownKeys ?? [],
  });

  parseClassicStateDocument(documentRecord(document), projection.run ?? null);

  await fs.mkdir(changeDir, { recursive: true });
  const temporary = path.join(changeDir, `.comet.yaml.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, document.toString(), 'utf8');
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }

  // Write Run state to separate file (or remove if no Run)
  if (projection.run) {
    await writeRunState(changeDir, projection.run);
  } else {
    await removeRunState(changeDir);
  }
}
