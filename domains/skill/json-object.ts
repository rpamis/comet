import { readFile } from 'fs/promises';

export type JsonObjectReadResult =
  | { status: 'missing' }
  | { status: 'error'; kind: 'read' | 'invalid'; error: Error }
  | { status: 'present'; value: Record<string, unknown> };

/** Read a JSON object without ever creating or rewriting the source file. */
export async function readJsonObjectFile(filePath: string): Promise<JsonObjectReadResult> {
  let source: string;
  try {
    source = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' };
    return { status: 'error', kind: 'read', error: error as Error };
  }

  try {
    const parsed = JSON.parse(source) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('expected a JSON object');
    }
    return { status: 'present', value: parsed as Record<string, unknown> };
  } catch (error) {
    return { status: 'error', kind: 'invalid', error: error as Error };
  }
}
