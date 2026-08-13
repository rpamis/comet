import { readFileSync } from 'fs';
import os from 'os';
import path from 'path';

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/u;

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

export function loadUserEvalEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory: string = os.homedir(),
): string | null {
  const envPath = path.join(homeDirectory, '.comet', 'eval', '.env');
  let source: string;
  try {
    source = readFileSync(envPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  for (const [name, value] of parseDotenv(source)) {
    if (!environment[name]?.trim()) environment[name] = value;
  }
  return envPath;
}
