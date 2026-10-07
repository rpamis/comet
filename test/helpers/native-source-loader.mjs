import { registerHooks } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import process from 'node:process';
import { transformSync } from 'esbuild';

const root = new URL('../../', import.meta.url).href;

// 隔离测试直接加载候选源码；磁盘应用和 Skill 脚本继续真实执行，不写生成物。
export const sourceHooks = registerHooks({
  resolve(specifier, context, next) {
    if (
      process.env.COMET_NATIVE_TEST_PACKAGE_ROOT &&
      process.env.COMET_TEST_SOURCE_APPLICATION !== '0'
    ) {
      const packageRoot = pathToFileURL(process.env.COMET_NATIVE_TEST_PACKAGE_ROOT + '/').href;
      if (specifier === '@rpamis/comet/applications/native')
        return next(packageRoot + 'dist/domains/comet-native/native-application.js', context);
      if (specifier === '@rpamis/comet/runtime')
        return next(packageRoot + 'dist/domains/engine/runtime.js', context);
    }
    if (process.env.COMET_TEST_SOURCE_APPLICATION !== '0') {
      if (specifier === '@rpamis/comet/applications/native')
        return next(root + 'domains/comet-native/native-application.ts', context);
      if (specifier === '@rpamis/comet/runtime')
        return next(root + 'domains/engine/runtime.ts', context);
    }
    if (
      specifier.startsWith('.') &&
      specifier.endsWith('.js') &&
      context.parentURL?.startsWith(root) &&
      !context.parentURL.includes('/node_modules/')
    ) {
      const target = new URL(specifier.replace(/\.js$/u, '.ts'), context.parentURL);
      if (existsSync(fileURLToPath(target))) return next(target.href, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith(root) && url.endsWith('.ts') && !url.includes('/node_modules/')) {
      let source = readFileSync(fileURLToPath(url), 'utf8');
      if (
        process.env.COMET_TEST_LEGACY_NATIVE === '1' &&
        url === root + 'domains/comet-native/native-application.ts'
      ) {
        source =
          source.replace(
            'export function createNativeWorkflowApplication(',
            'function currentNativeWorkflowApplication(',
          ) +
          `
          export function createNativeWorkflowApplication(context, options) {
            const application = currentNativeWorkflowApplication(context, options);
            return {
              ...application,
              workflows: application.workflows.map(nativeSdkBeforeVerifierRecovery),
              transitionHandlers: application.transitionHandlers.map((handler) => ({
                ...handler,
                apply(input) {
                  if (input.event.kind === 'action-outcome' && input.event.stepId === 'supervisor.child.verifier' && input.event.outcome.status === 'failed')
                    return {state: input.run.state, next: []};
                  return handler.apply(input);
                },
              })),
            };
          }
        `;
      }
      return {
        format: 'module',
        shortCircuit: true,
        source: transformSync(source, {
          loader: 'ts',
          format: 'esm',
          target: 'node22',
        }).code,
      };
    }
    return next(url, context);
  },
});
