import path from 'path';
import { promises as fs } from 'fs';
import { ensureDir, fileExists } from '../../platform/fs/file-system.js';

type LineEnding = '\n' | '\r\n';

export interface ManagedMarkdownBlockOptions {
  tagName: string;
  content: string;
}

export interface ManagedMarkdownBlockResult {
  action: 'created' | 'appended' | 'updated' | 'unchanged' | 'removed' | 'missing';
  changed: boolean;
}

interface ManagedBlockLocation {
  startLine: number;
  endLine: number;
}

function toLineEnding(value: string): LineEnding {
  return value.includes('\r\n') ? '\r\n' : '\n';
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

function trimTrailingLineEndings(value: string): string {
  return normalizeLineEndings(value).replace(/\n+$/u, '');
}

function restoreLineEndings(value: string, lineEnding: LineEnding): string {
  return lineEnding === '\r\n' ? value.replace(/\n/g, '\r\n') : value;
}

function normalizeTagLine(line: string): string {
  return line.trim();
}

function validateTagName(tagName: string): void {
  if (!/^[a-z][a-z0-9-]*$/u.test(tagName)) {
    throw new Error(`Invalid managed block tag name: ${tagName}`);
  }
}

export function renderManagedMarkdownBlock(
  tagName: string,
  content: string,
  lineEnding: LineEnding = '\n',
): string {
  validateTagName(tagName);
  const normalizedContent = trimTrailingLineEndings(content);
  return `<${tagName}>${lineEnding}${normalizedContent}${lineEnding}</${tagName}>${lineEnding}`;
}

function assertSingleCompleteBlock(lines: string[], tagName: string): ManagedBlockLocation | null {
  const openTag = `<${tagName}>`;
  const closeTag = `</${tagName}>`;
  let startLine: number | null = null;
  let endLine: number | null = null;
  let seenStart = false;
  let seenEnd = false;

  for (let i = 0; i < lines.length; i++) {
    const line = normalizeTagLine(lines[i]);
    if (line === openTag) {
      if (seenStart) {
        if (seenEnd) throw new Error(`Cannot update ${tagName}: duplicate managed block`);
        throw new Error(`Cannot update ${tagName}: malformed managed block (nested start tag)`);
      }
      seenStart = true;
      startLine = i;
      continue;
    }

    if (line === closeTag) {
      if (!seenStart || seenEnd) {
        throw new Error(`Cannot update ${tagName}: malformed managed block`);
      }
      seenEnd = true;
      endLine = i;
    }
  }

  if (!seenStart) {
    return null;
  }

  if (!seenEnd) {
    throw new Error(`Cannot update ${tagName}: incomplete managed block`);
  }

  if (!seenStart || !seenEnd || startLine === null || endLine === null) {
    throw new Error(`Cannot update ${tagName}: malformed managed block`);
  }
  if (startLine > endLine) {
    throw new Error(`Cannot update ${tagName}: malformed managed block`);
  }

  return { startLine, endLine };
}

function mergeWhitespaceForManagedRemoval(before: string[], after: string[]): string[] {
  if (before.length === 0 || after.length === 0) {
    return [...before, ...after];
  }
  if (before.at(-1) === '' && after.at(0) === '') {
    return [...before, ...after.slice(1)];
  }
  return [...before, ...after];
}

export async function mergeManagedMarkdownBlock(
  filePath: string,
  options: ManagedMarkdownBlockOptions,
): Promise<ManagedMarkdownBlockResult> {
  validateTagName(options.tagName);
  const normalizedBlock = renderManagedMarkdownBlock(options.tagName, options.content, '\n');

  if (!(await fileExists(filePath))) {
    await ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, normalizedBlock, 'utf8');
    return { action: 'created', changed: true };
  }

  const existing = await fs.readFile(filePath, 'utf8');
  const lineEnding = toLineEnding(existing);
  const normalizedExisting = normalizeLineEndings(existing);
  const lines = normalizedExisting.split('\n');
  const blockLocation = assertSingleCompleteBlock(lines, options.tagName);

  if (blockLocation === null) {
    const separator =
      normalizedExisting.length === 0 ? '' : normalizedExisting.endsWith('\n') ? '\n' : '\n\n';
    const updated = `${normalizedExisting}${separator}${normalizedBlock}`;
    await fs.writeFile(filePath, restoreLineEndings(updated, lineEnding), 'utf8');
    return { action: 'appended', changed: true };
  }

  const renderedBlock = normalizedBlock.replace(/\n$/u, '');
  const blockText = lines.slice(blockLocation.startLine, blockLocation.endLine + 1).join('\n');
  if (blockText === renderedBlock) {
    return { action: 'unchanged', changed: false };
  }

  const next = [
    ...lines.slice(0, blockLocation.startLine),
    ...renderedBlock.split('\n'),
    ...lines.slice(blockLocation.endLine + 1),
  ].join('\n');
  await fs.writeFile(filePath, restoreLineEndings(next, lineEnding), 'utf8');
  return { action: 'updated', changed: true };
}

export async function removeManagedMarkdownBlock(
  filePath: string,
  tagName: string,
): Promise<ManagedMarkdownBlockResult> {
  validateTagName(tagName);
  if (!(await fileExists(filePath))) return { action: 'missing', changed: false };
  const existing = await fs.readFile(filePath, 'utf8');
  const lineEnding = toLineEnding(existing);
  const normalizedExisting = normalizeLineEndings(existing);
  const lines = normalizedExisting.split('\n');
  const blockLocation = assertSingleCompleteBlock(lines, tagName);
  if (blockLocation === null) return { action: 'missing', changed: false };
  const next = mergeWhitespaceForManagedRemoval(
    lines.slice(0, blockLocation.startLine),
    lines.slice(blockLocation.endLine + 1),
  ).join('\n');
  await fs.writeFile(filePath, restoreLineEndings(next, lineEnding), 'utf8');
  return { action: 'removed', changed: true };
}
