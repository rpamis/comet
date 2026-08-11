import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { PLATFORMS } from '../../platform/install/platforms.js';

/**
 * Strip the double quotes cmd.exe adds to arguments containing spaces or
 * special characters (see platform/process/shell-quote.ts). Tests that parse
 * `openspec init` targets from mocked execFileSync arguments use this so the
 * same mock works on Windows and Unix.
 */
export function unquoteWindowsArg(value: unknown): string {
  return String(value).replace(/^"|"$/gu, '');
}

/**
 * Stage a synthetic OpenSpec tool output for every requested tool id under
 * targetPath, mirroring what the real OpenSpec CLI writes: each platform's
 * skillsDir gets `skills/openspec-propose/SKILL.md`.
 */
export function stageOpenSpecSkills(targetPath: string, tools: string): void {
  for (const toolId of tools.split(',')) {
    const platform = PLATFORMS.find((candidate) => candidate.openspecToolId === toolId);
    const generated = path.join(
      targetPath,
      platform?.skillsDir ?? `.${toolId}`,
      'skills',
      'openspec-propose',
    );
    mkdirSync(generated, { recursive: true });
    writeFileSync(path.join(generated, 'SKILL.md'), '# staged\n');
  }
}
