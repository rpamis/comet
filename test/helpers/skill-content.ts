import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Read the main Skill and its explicitly disclosed Compat recipe for legacy contracts. */
export async function readSkillWithCompat(root: string, name: string): Promise<string> {
  const main = await fs.readFile(path.join(root, name, 'SKILL.md'), 'utf8');
  if (!main.includes('](reference/compat.md)')) return main;
  return `${main}\n${await fs.readFile(path.join(root, name, 'reference/compat.md'), 'utf8')}`;
}
