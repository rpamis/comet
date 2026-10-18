#!/usr/bin/env node

/**
 * Postinstall script that hints about comet init.
 *
 * The tip is suppressed when:
 * - CI=true environment variable is set
 * - COMET_NO_HINTS=1 environment variable is set
 * - dist/ directory doesn't exist (dev setup scenario)
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function shouldSkip() {
  if (process.env.CI === 'true' || process.env.CI === '1') return true;
  if (process.env.COMET_NO_HINTS === '1') return true;
  return false;
}

async function distExists() {
  try {
    const stat = await fs.stat(path.join(__dirname, '..', '..', 'dist'));
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function main() {
  try {
    if (shouldSkip()) return;
    if (!(await distExists())) return;
    console.log(`\nTip: Run 'comet init' to set up Comet workflow in your project`);
  } catch {
    // Never break npm install
  }
}

main().catch(() => process.exit(0));
