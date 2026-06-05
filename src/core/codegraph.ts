import { execFileSync } from 'child_process';
import { isCommandAvailable, getNpmExecutable } from './openspec.js';
import { printCommandErrorDetails } from './command-error.js';

import type { InstallScope } from './types.js';

const CODEGRAPH_SUPPORTED_TARGETS: Record<string, string> = {
  claude: 'claude',
  cursor: 'cursor',
  codex: 'codex',
  opencode: 'opencode',
  gemini: 'gemini',
  kiro: 'kiro',
  antigravity: 'antigravity',
};

function filterSupportedPlatforms(platformIds: string[]): {
  supported: string[];
  unsupported: string[];
} {
  const supported: string[] = [];
  const unsupported: string[] = [];

  for (const id of platformIds) {
    if (CODEGRAPH_SUPPORTED_TARGETS[id]) {
      supported.push(CODEGRAPH_SUPPORTED_TARGETS[id]);
    } else {
      unsupported.push(id);
    }
  }

  return { supported, unsupported };
}

async function ensureCodegraphCli(projectPath: string): Promise<boolean> {
  if (isCommandAvailable('codegraph')) {
    return true;
  }

  console.log('    Installing CodeGraph CLI...');
  try {
    execFileSync(getNpmExecutable(), ['install', '-g', '@colbymchenry/codegraph'], {
      cwd: projectPath,
      stdio: 'inherit',
      timeout: 180_000,
      shell: process.platform === 'win32',
    });
    return isCommandAvailable('codegraph');
  } catch (error) {
    console.error(`    Failed to install CodeGraph CLI: ${(error as Error).message}`);
    printCommandErrorDetails(error);
    return false;
  }
}

async function installCodegraph(
  projectPath: string,
  platformIds: string[],
  scope: InstallScope,
): Promise<'installed' | 'failed' | 'skipped'> {
  const { supported, unsupported } = filterSupportedPlatforms(platformIds);

  if (supported.length === 0) {
    if (unsupported.length > 0) {
      console.log(
        `    CodeGraph: no supported platforms among selected (${unsupported.join(', ')}). Skipping.`,
      );
    }
    return 'skipped';
  }

  if (unsupported.length > 0) {
    console.log(`    CodeGraph: skipping unsupported platforms: ${unsupported.join(', ')}`);
  }

  const cliReady = await ensureCodegraphCli(projectPath);
  if (!cliReady) {
    console.error(
      '    CodeGraph CLI not available. Install manually: npm install -g @colbymchenry/codegraph',
    );
    return 'failed';
  }

  const location = scope === 'global' ? 'global' : 'local';

  try {
    console.log(
      `    Running: codegraph install --target=${supported.join(',')} --location=${location} --yes`,
    );
    execFileSync(
      'codegraph',
      ['install', `--target=${supported.join(',')}`, `--location=${location}`, '--yes'],
      {
        cwd: projectPath,
        stdio: 'inherit',
        timeout: 120_000,
        shell: process.platform === 'win32',
      },
    );
  } catch (error) {
    console.error(`    CodeGraph install failed: ${(error as Error).message}`);
    printCommandErrorDetails(error);
    return 'failed';
  }

  if (scope === 'project') {
    try {
      console.log('    Running: codegraph init -i');
      execFileSync('codegraph', ['init', '-i'], {
        cwd: projectPath,
        stdio: 'inherit',
        timeout: 300_000,
        shell: process.platform === 'win32',
      });
    } catch (error) {
      console.error(`    CodeGraph init failed: ${(error as Error).message}`);
      printCommandErrorDetails(error);
      return 'failed';
    }
  }

  return 'installed';
}

export { installCodegraph, filterSupportedPlatforms, CODEGRAPH_SUPPORTED_TARGETS };
