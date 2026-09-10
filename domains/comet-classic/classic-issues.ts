import { stripVTControlCharacters } from 'node:util';

export interface ClassicIssue {
  code: string;
  message: string;
  field?: string;
  path?: string;
  actual?: unknown;
  expected?: unknown;
  remediation?: string;
}

export function classicIssue(error: unknown, fields: Partial<ClassicIssue> = {}): ClassicIssue {
  const message = stripVTControlCharacters(error instanceof Error ? error.message : String(error));
  return { code: 'CLASSIC_COMMAND_FAILED', message, ...fields };
}
