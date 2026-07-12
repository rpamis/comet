import os from 'os';
import { promises as fs } from 'fs';
import path from 'path';
import { parseDocument } from 'yaml';
import { fileExists } from '../../platform/fs/file-system.js';

type ClassicConfigValue = {
  value: string;
  source: string;
};

type ClassicConfigOptions = {
  cwd?: string;
  homeDir?: string;
};

function configCandidates(options: ClassicConfigOptions = {}): Array<{
  file: string;
  source: string;
}> {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();
  const candidates = [
    { file: path.resolve(cwd, '.comet', 'config.yaml'), source: '.comet/config.yaml' },
    {
      file: path.resolve(homeDir, '.comet', 'config.yaml'),
      source: '~/.comet/config.yaml',
    },
  ];

  return candidates.filter(
    (candidate, index) => candidates.findIndex((entry) => entry.file === candidate.file) === index,
  );
}

async function readClassicConfigValue(
  field: string,
  options: ClassicConfigOptions = {},
): Promise<ClassicConfigValue | null> {
  for (const candidate of configCandidates(options)) {
    if (!(await fileExists(candidate.file))) continue;
    // parseDocument recovers from unrelated syntax errors elsewhere in the file (yaml's
    // error-tolerant parser still builds a usable tree), so a broken field this call isn't
    // reading about must not block every other field lookup. Errors only matter when they
    // land on the field actually being read, and that already surfaces naturally: `get()`
    // returns a best-effort value for a malformed field, which downstream enum/type
    // validation (validateLanguage, contextCompression, etc.) rejects with its own
    // properly-formatted error instead of a raw throw from this shared helper.
    const document = parseDocument(await fs.readFile(candidate.file, 'utf8'), {
      uniqueKeys: false,
    });
    const value = document.get(field);
    if (value === null || value === undefined) continue;
    return { value: String(value), source: candidate.source };
  }
  return null;
}

export { configCandidates, readClassicConfigValue };
export type { ClassicConfigOptions, ClassicConfigValue };
