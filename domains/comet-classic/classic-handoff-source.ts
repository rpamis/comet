import { createHash } from 'node:crypto';
import { classicTaskRequirements } from './classic-tasks.js';

/** Handoff tracks task requirements; tasks.md remains the live completion ledger. */
export function handoffSourceHash(file: string, content: string): string {
  if (file.replaceAll('\\', '/').endsWith('/tasks.md')) {
    content = classicTaskRequirements(content);
  }
  return createHash('sha256').update(content).digest('hex');
}
