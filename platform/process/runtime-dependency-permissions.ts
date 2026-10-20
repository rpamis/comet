import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

interface PackageManifest {
  name?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

/** 只授权可信 SDK 的运行依赖包，不授权提升后的整个 node_modules。 */
export function runtimeDependencyPermissions(sdkRoot: string): {
  readRoots: string[];
  preloadSource: string;
} {
  const realSdkRoot = fs.realpathSync(sdkRoot);
  const home = path.resolve(os.homedir());
  const roots = new Set<string>();
  const visited = new Set<string>();
  const packages: { root: string; dependencies: Record<string, string> }[] = [];
  const visit = (manifestFile: string) => {
    if (visited.has(manifestFile)) return;
    if (visited.size >= 4096) throw new Error('SDK 运行依赖数量超过上限');
    visited.add(manifestFile);
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as PackageManifest;
    const require = createRequire(manifestFile);
    const optional = manifest.optionalDependencies ?? {};
    const dependencies: Record<string, string> = Object.create(null);
    packages.push({ root: path.dirname(manifestFile), dependencies });
    for (const name of Object.keys({
      ...manifest.peerDependencies,
      ...manifest.dependencies,
      ...optional,
    })) {
      if (!/^(?:@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/u.test(name))
        throw new Error(`SDK 运行依赖名称无效：${name}`);
      const candidates = (require.resolve.paths(name) ?? [])
        .filter((directory) => path.basename(directory) === 'node_modules')
        .map((directory) => path.join(directory, name));
      const candidate = candidates.find((directory) => fs.existsSync(directory));
      if (!candidate) {
        if (Object.hasOwn(optional, name) || !Object.hasOwn(manifest.dependencies ?? {}, name))
          continue;
        throw new Error(`SDK 运行依赖未安装：${name}`);
      }
      const realRoot = fs.realpathSync(candidate);
      const suffix = path.join('node_modules', name);
      if (
        !realRoot.endsWith(`${path.sep}${suffix}`) ||
        [realSdkRoot, home].some(
          (protectedRoot) =>
            protectedRoot === realRoot || protectedRoot.startsWith(realRoot + path.sep),
        )
      )
        throw new Error(`SDK 运行依赖不是独立包目录：${name}`);
      const packageFile = path.join(realRoot, 'package.json');
      if (fs.realpathSync(packageFile) !== packageFile)
        throw new Error(`SDK 运行依赖清单不能是符号链接：${name}`);
      const dependency = JSON.parse(fs.readFileSync(packageFile, 'utf8')) as PackageManifest;
      if (dependency.name !== name) throw new Error(`SDK 运行依赖包名不匹配：${name}`);
      dependencies[name] = realRoot;
      roots.add(realRoot);
      visit(packageFile);
    }
  };
  visit(path.join(realSdkRoot, 'package.json'));
  // 默认解析器仍负责 exports、条件和子路径；只替换已验证依赖的查找起点。
  packages.sort((left, right) => right.root.length - left.root.length);
  return {
    readRoots: [...roots],
    preloadSource: `import { registerHooks, createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const packages = JSON.parse(${JSON.stringify(JSON.stringify(packages))});
const resolverURL = (name, target) => pathToFileURL(path.join(path.dirname(name.startsWith('@') ? path.dirname(target) : target), '__comet_dependency_resolver__.mjs')).href;
const resolverParents = new Set(packages.flatMap(entry => Object.entries(entry.dependencies).map(([name, target]) => resolverURL(name, target))));
registerHooks({ resolve(specifier, context, next) {
  if (resolverParents.has(context.parentURL)) return next(specifier, context);
  if (!context.parentURL?.startsWith('file:') || specifier.startsWith('.') || specifier.startsWith('/') || specifier.includes(':') || specifier.startsWith('#')) return next(specifier, context);
  const parent = fileURLToPath(context.parentURL);
  const owner = packages.find(entry => parent.startsWith(entry.root + path.sep));
  const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
  const target = owner && Object.hasOwn(owner.dependencies, name) ? owner.dependencies[name] : undefined;
  if (!target) return next(specifier, context);
  const parentURL = resolverURL(name, target);
  if (context.parentURL === parentURL) return next(specifier, context);
  // CommonJS 默认钩子不使用替换后的 parentURL，需在该定位点构造 require。
  if (Array.from(context.conditions).includes('require')) return { url: pathToFileURL(createRequire(parentURL).resolve(specifier)).href, shortCircuit: true };
  return next(specifier, { ...context, parentURL });
}});
`,
  };
}

/** 分摊相同单包许可，避免 Windows 命令行长度限制；不继承宿主 NODE_OPTIONS。 */
export function splitNodePermissionArguments(
  readRoots: readonly string[],
  baseArgs: readonly string[],
): { args: string[]; nodeOptions: string } {
  const budget = 30_000;
  const tooLong = () =>
    new Error('隔离验收依赖路径过长；请缩短 SDK 或依赖安装目录后重试，不能关闭权限检查。');
  const quotedLength = (value: string) => {
    if (!/[\s"]/u.test(value)) return value.length;
    let length = value.length + 2;
    let backslashes = 0;
    for (const character of value) {
      if (character === '\\') backslashes++;
      else {
        if (character === '"') length += backslashes + 1;
        backslashes = 0;
      }
    }
    return length + backslashes;
  };
  let argumentLength = [process.execPath, ...baseArgs].reduce(
    (length, value) => length + quotedLength(value) + 1,
    1,
  );
  if (argumentLength > budget) throw tooLong();
  let optionLength = 0;
  const permissionArgs: string[] = [];
  const options: string[] = [];
  for (const root of readRoots) {
    if (
      [...root].some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || character === '*',
      )
    )
      throw new Error('隔离验收依赖路径包含不支持的控制字符或通配符');
    const argument = `--allow-fs-read=${root}`;
    const option = JSON.stringify(argument);
    const argumentCost = quotedLength(argument) + 1;
    const optionCost = option.length + (options.length ? 1 : 0);
    if (
      optionLength + optionCost <= budget &&
      (optionLength <= argumentLength || argumentLength + argumentCost > budget)
    ) {
      options.push(option);
      optionLength += optionCost;
    } else if (argumentLength + argumentCost <= budget) {
      permissionArgs.push(argument);
      argumentLength += argumentCost;
    } else throw tooLong();
  }
  return { args: [...permissionArgs, ...baseArgs], nodeOptions: options.join(' ') };
}
