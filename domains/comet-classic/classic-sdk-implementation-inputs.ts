import path from 'node:path';
import { readWorkflowProjectConfigDocument } from '../workflow-contract/project-config-reader.js';
import { parseCheckManifest } from './classic-check-manifest.js';
import { resolveClassicLayout } from './classic-layout.js';

export async function classicForeignChangeRoots(root: string): Promise<string[]> {
  const config = await readWorkflowProjectConfigDocument(root, {
    allowPartialProject: true,
    allowMissingNativeFields: true,
  });
  // 检查可以依赖其他 change 的草稿，但检查覆盖不代表获准交付这些草稿。
  return config?.native ? [path.posix.join(config.native.artifact_root, 'comet', 'changes')] : [];
}

export function isClassicInputUnderRoot(ref: string, roots: string[]) {
  return roots.some((root) => ref === root || ref.startsWith(`${root}/`));
}

export async function collectClassicSdkImplementationInputs(
  root: string,
  manifest: string,
  foreignRoots?: string[],
): Promise<Record<string, string>> {
  const layout = await resolveClassicLayout(root);
  const roots = [
    '.comet',
    layout.openSpecRoot,
    layout.superpowersRoot,
    ...(foreignRoots ?? (await classicForeignChangeRoots(root))),
  ].map((ref) => (path.isAbsolute(ref) ? path.relative(root, ref).replaceAll('\\', '/') : ref));
  return Object.fromEntries(
    parseCheckManifest(manifest)
      .filter(
        ({ p }) =>
          !p.includes('\0') &&
          !p.split('/').includes('node_modules') &&
          !isClassicInputUnderRoot(p, roots),
      )
      .map(({ p, h }) => [p, h]),
  );
}
