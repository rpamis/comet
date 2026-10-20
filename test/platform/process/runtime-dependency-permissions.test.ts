import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import {
  runtimeDependencyPermissions,
  splitNodePermissionArguments,
} from '../../../platform/process/runtime-dependency-permissions.js';

const temporary: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of temporary.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'comet-dependency-permissions-'));
  temporary.push(root);
  const sdk = path.join(root, 'sdk');
  fs.mkdirSync(sdk);
  return { root, sdk };
}
function write(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
function manifest(root: string, value: Record<string, unknown>) {
  write(path.join(root, 'package.json'), JSON.stringify(value));
}
function run(sdk: string, entry: string) {
  const permission = runtimeDependencyPermissions(sdk);
  const preload = path.join(sdk, 'dependency-resolution.mjs');
  write(preload, permission.preloadSource);
  const { args, nodeOptions } = splitNodePermissionArguments(
    [sdk, ...permission.readRoots],
    ['--permission', '--import', pathToFileURL(preload).href, entry],
  );
  return spawnSync(process.execPath, args, {
    cwd: sdk,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: nodeOptions },
  });
}

it('resolves an external dependency tree with scoped exports and denies sibling secrets', () => {
  const { root, sdk } = fixture();
  const modules = path.join(root, 'store', 'node_modules');
  const dep = path.join(modules, '@sample', 'dep');
  manifest(sdk, { name: 'sdk', type: 'module', dependencies: { '@sample/dep': '1' } });
  manifest(dep, {
    name: '@sample/dep',
    type: 'module',
    dependencies: { leaf: '1' },
    exports: { '.': { import: './esm.mjs', require: './cjs.cjs' }, './sub': './sub.mjs' },
  });
  manifest(path.join(modules, 'leaf'), { name: 'leaf', type: 'module', exports: './index.mjs' });
  write(path.join(modules, 'leaf/index.mjs'), "export default 'leaf'");
  write(path.join(dep, 'esm.mjs'), "import leaf from 'leaf'; export default 'esm:' + leaf");
  write(path.join(dep, 'cjs.cjs'), "module.exports = 'cjs'");
  write(path.join(dep, 'sub.mjs'), "export default 'sub'");
  fs.symlinkSync(modules, path.join(sdk, 'node_modules'), 'junction');
  const secret = path.join(root, 'secret.txt');
  write(secret, 'private');
  const entry = path.join(sdk, 'index.mjs');
  write(
    entry,
    `import value from '@sample/dep'; import sub from '@sample/dep/sub';
import { createRequire } from 'node:module'; import fs from 'node:fs';
let denied; try { fs.readFileSync(${JSON.stringify(secret)}); } catch(e) { denied=e.code; }
console.log(JSON.stringify([value,sub,createRequire(import.meta.url)('@sample/dep'),denied]));`,
  );
  // 宿主宽许可不能传递给由明确白名单构造的子进程。
  vi.stubEnv('NODE_OPTIONS', '--allow-fs-read=*');
  const result = run(sdk, entry);
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual(['esm:leaf', 'sub', 'cjs', 'ERR_ACCESS_DENIED']);
  const roots = runtimeDependencyPermissions(sdk).readRoots;
  expect(roots).toHaveLength(2);
  expect(roots).not.toContain(modules);
});

it('keeps pnpm and nested package versions distinct', () => {
  const { root, sdk } = fixture();
  manifest(sdk, { name: 'sdk', type: 'module', dependencies: { alpha: '1', beta: '1' } });
  const modules = path.join(sdk, 'node_modules');
  fs.mkdirSync(modules);
  for (const [name, version] of [
    ['alpha', 'one'],
    ['beta', 'two'],
  ]) {
    const dep = path.join(root, 'store', '.pnpm', `${name}@1`, 'node_modules', name);
    manifest(dep, {
      name,
      type: 'module',
      exports: './index.mjs',
      dependencies: { shared: version },
    });
    const shared = path.join(dep, 'node_modules', 'shared');
    manifest(shared, { name: 'shared', type: 'module', exports: './index.mjs' });
    write(path.join(shared, 'index.mjs'), `export default '${version}'`);
    write(path.join(dep, 'index.mjs'), "import shared from 'shared'; export default shared");
    fs.symlinkSync(dep, path.join(modules, name), 'junction');
  }
  const entry = path.join(sdk, 'index.mjs');
  write(entry, "import a from 'alpha'; import b from 'beta'; console.log(JSON.stringify([a,b]))");
  const result = run(sdk, entry);
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual(['one', 'two']);
});

it('permits missing optional dependencies but rejects missing required dependencies', () => {
  const { sdk } = fixture();
  manifest(sdk, { name: 'sdk', optionalDependencies: { absent: '1' } });
  expect(runtimeDependencyPermissions(sdk).readRoots).toEqual([]);
  manifest(sdk, { name: 'sdk', dependencies: { absent: '1' } });
  expect(() => runtimeDependencyPermissions(sdk)).toThrow(/未安装/);
});

it('rejects a wide dependency symlink and a mismatched package identity', () => {
  const { root, sdk } = fixture();
  manifest(sdk, { name: 'sdk', dependencies: { dep: '1' } });
  fs.mkdirSync(path.join(sdk, 'node_modules'));
  fs.symlinkSync(root, path.join(sdk, 'node_modules/dep'), 'junction');
  expect(() => runtimeDependencyPermissions(sdk)).toThrow(/独立包目录/);
  fs.unlinkSync(path.join(sdk, 'node_modules/dep'));
  manifest(path.join(sdk, 'node_modules/dep'), { name: 'another' });
  expect(() => runtimeDependencyPermissions(sdk)).toThrow(/包名不匹配/);
});

it('rejects a dependency manifest redirected outside its package', () => {
  const { root, sdk } = fixture();
  manifest(sdk, { name: 'sdk', dependencies: { dep: '1' } });
  const dep = path.join(sdk, 'node_modules/dep');
  fs.mkdirSync(dep, { recursive: true });
  const external = path.join(root, 'manifest.json');
  write(external, '{"name":"dep"}');
  fs.symlinkSync(external, path.join(dep, 'package.json'));
  expect(() => runtimeDependencyPermissions(sdk)).toThrow(/符号链接/);
});

it('round-trips spaces, commas, quotes and Windows backslashes in NODE_OPTIONS', () => {
  const { root } = fixture();
  const file = path.join(root, 'C:\\Program Files\\odd "comma, package\\');
  write(file, 'allowed');
  const secret = path.join(root, 'secret');
  write(secret, 'denied');
  const script = `const fs=require('node:fs'); let denied;
try { fs.readFileSync(${JSON.stringify(secret)}); } catch(e) { denied=e.code; }
console.log(JSON.stringify([fs.readFileSync(${JSON.stringify(file)},'utf8'),denied]));`;
  const { args, nodeOptions } = splitNodePermissionArguments(
    [file],
    ['--permission', '-e', script],
  );
  expect(nodeOptions).not.toBe('');
  const result = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: nodeOptions },
  });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual(['allowed', 'ERR_ACCESS_DENIED']);
});

it('splits large permission lists without broadening roots and refuses excessive lengths', () => {
  const roots = Array.from({ length: 225 }, (_, index) => `/sdk/${'p'.repeat(120)}/${index}`);
  const split = splitNodePermissionArguments(roots, ['--permission', '-e', '0']);
  expect(split.args.join(' ').length).toBeLessThan(30_000);
  expect(split.nodeOptions.length).toBeLessThanOrEqual(30_000);
  expect(split.args.filter((arg) => arg.startsWith('--allow-fs-read='))).not.toHaveLength(0);
  expect(split.nodeOptions).not.toBe('');
  expect(() => splitNodePermissionArguments(['/a'.repeat(40_000)], [])).toThrow(/路径过长/);
  expect(() => splitNodePermissionArguments([], ['x'.repeat(40_000)])).toThrow(/路径过长/);
});

it('rejects wildcard and control-character permission paths', () => {
  for (const root of ['/tmp/*', '/tmp/a\nb', '/tmp/a\0b']) {
    expect(() => splitNodePermissionArguments([root], [])).toThrow(/控制字符或通配符/);
  }
});

it('rejects oversized quoted paths with long backslash runs', () => {
  for (const suffix of ['tail', '"tail', '']) {
    const value = `C:\\Program Files\\${'\\'.repeat(100_000)}${suffix}`;
    expect(() => splitNodePermissionArguments([value], [])).toThrow(/路径过长/);
    expect(() => splitNodePermissionArguments([], [value])).toThrow(/路径过长/);
  }
});
