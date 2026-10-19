// Native 独立 Runtime 不携带 Classic 固定流程的 schema；其余 schema 仍由 AJV 校验。
export function excludeClassicRuntimeSchemas() {
  return {
    name: 'exclude-classic-runtime-schemas',
    setup(builder) {
      builder.onLoad({ filter: /[/\\]engine[/\\]runtime-schema\.generated\.ts$/ }, () => ({
        contents: 'export const precompiledRuntimeSchemas = new Map();',
        loader: 'ts',
      }));
    },
  };
}
