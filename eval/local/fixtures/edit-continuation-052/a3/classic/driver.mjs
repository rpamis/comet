import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { here, parseArgs, readJson, assert } from './common.mjs';
const [mode, ...args] = process.argv.slice(2);
const o = parseArgs(args);
let config =
  o.config ||
  (o.evidence
    ? path.join(path.resolve(o.evidence), 'fixture.json')
    : path.join(here, 'fixture.json'));
if (
  (mode === 'negative-control' && o.file) ||
  (mode === 'prepare-edits' && !o.config && !o.evidence) ||
  mode === 'validate'
) {
  config = path.join(here, 'fixture.json');
  if (o.config) config = o.config;
  const trusted = await readJson(config);
  if (o.root)
    assert(
      path.resolve(trusted.projectRoot) === path.resolve(o.root),
      'Trusted fixture project mismatch',
    );
  if (o['cli-root'])
    assert(
      path.resolve(trusted.sourceRoot) === path.resolve(o['cli-root']),
      'Trusted fixture CLI root mismatch',
    );
  if (mode === 'negative-control')
    assert(
      trusted.cli && path.resolve(trusted.cli) === path.resolve(o['cli-root'], 'bin/comet.js'),
      'Negative control requires frozen public bin CLI',
    );
}
let file, params;
if (mode === 'validate') {
  file = 'validator.mjs';
  params = [
    '--config',
    config,
    '--baseline',
    o.baseline || path.join(here, 'baseline.json'),
    '--negative-proof',
    o['negative-proof'] || path.join(here, 'negative-control-proof.json'),
    '--edit-proof',
    o['edit-proof'] || path.join(here, 'edit-proof.json'),
    ...(o.output ? ['--output', o.output] : []),
  ];
} else {
  file = 'deterministic-driver.mjs';
  params = [mode === 'dryrun' ? 'deterministic-full' : mode];
  if (mode === 'seed' || (mode === 'dryrun' && !o.config))
    params.push(
      '--project-root',
      path.resolve(o.root),
      '--evidence-root',
      path.resolve(o.evidence),
      '--source-root',
      path.resolve(o['cli-root']),
      ...(o.dist
        ? ['--dist', path.resolve(o.dist)]
        : ['--cli', path.join(path.resolve(o['cli-root']), 'bin/comet.js')]),
      ...(o.openspec ? ['--openspec', o.openspec] : []),
    );
  else
    params.push(
      '--config',
      config,
      ...(o.file || o['execute-file'] ? ['--execute-file', o.file || o['execute-file']] : []),
    );
}
const result = spawnSync(process.execPath, [path.join(here, file), ...params], {
  stdio: 'inherit',
  windowsHide: true,
});
process.exitCode = result.status ?? 1;
