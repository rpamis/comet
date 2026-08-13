import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const moduleRoot = path.resolve(moduleDirectory, '../..');
const packageRoot = path.basename(moduleRoot) === 'dist' ? path.dirname(moduleRoot) : moduleRoot;

export interface UserEvalEnvironmentStatus {
  path: string;
  created: boolean;
}

function parseValue(raw: string): string {
  const trimmed = raw.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed.replace(/\s+#.*$/u, '').trim();
}

function parseDotenv(source: string): Array<[string, string]> {
  const values: Array<[string, string]> = [];
  for (const line of source.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const name = trimmed.slice(0, separator).trim();
    if (!ENV_NAME_RE.test(name)) continue;
    const value = parseValue(trimmed.slice(separator + 1));
    if (value) values.push([name, value]);
  }
  return values;
}

function readEvalEnvironmentTemplate(): string {
  const templatePath = path.join(packageRoot, 'eval', '.env.example');
  try {
    return readFileSync(templatePath, 'utf8');
  } catch (error) {
    throw new Error(`Eval environment template is missing at ${templatePath}.`, { cause: error });
  }
}

export function loadUserEvalEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory: string = os.homedir(),
): UserEvalEnvironmentStatus {
  const envPath = path.join(homeDirectory, '.comet', 'eval', '.env');
  let source: string;
  let created = false;
  try {
    source = readFileSync(envPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;

    source = readEvalEnvironmentTemplate();
    mkdirSync(path.dirname(envPath), { recursive: true, mode: 0o700 });
    try {
      writeFileSync(envPath, source, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      created = true;
    } catch (writeError) {
      if ((writeError as NodeJS.ErrnoException).code !== 'EEXIST') throw writeError;
      source = readFileSync(envPath, 'utf8');
    }
  }

  for (const [name, value] of parseDotenv(source)) {
    if (!environment[name]?.trim()) environment[name] = value;
  }
  return { path: envPath, created };
}
