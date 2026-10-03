import type { PluginRuntime } from './plugin-runtime.js';
import type {
  PluginContext,
  PluginDescriptor,
  PluginModule,
  PluginScopeContext,
  PluginScope,
} from './types.js';

export interface PluginCapability<Input = unknown, Output = unknown> {
  parseInput(value: unknown): Input;
  invoke(value: unknown): Promise<Output>;
}

export interface PluginCapabilityOptions<Input, Output> {
  parseInput(value: unknown): Input;
  invoke(input: Input): Output | Promise<Output>;
}

export type PluginCapabilities = Readonly<Record<string, PluginCapability>>;

export type PluginCapabilityModule<Capabilities extends PluginCapabilities> = Omit<
  PluginModule,
  'invoke'
> & { readonly capabilities: Capabilities };

export interface DefinePluginOptions<Capabilities extends PluginCapabilities> extends Omit<
  PluginDescriptor,
  'create'
> {
  create(
    context: PluginContext,
  ): PluginCapabilityModule<Capabilities> | Promise<PluginCapabilityModule<Capabilities>>;
}

export interface TypedPluginDescriptor<
  Capabilities extends PluginCapabilities,
> extends PluginDescriptor {
  create(context: PluginContext): Promise<PluginModule & PluginCapabilityModule<Capabilities>>;
}

export interface PluginClient<Capabilities extends PluginCapabilities> {
  invoke<Name extends keyof Capabilities & string>(
    name: Name,
    input: ReturnType<Capabilities[Name]['parseInput']>,
  ): Promise<Awaited<ReturnType<Capabilities[Name]['invoke']>>>;
}

export function definePluginCapability<Input, Output>(
  options: PluginCapabilityOptions<Input, Output>,
): PluginCapability<Input, Output> {
  return {
    parseInput: (value) => options.parseInput(value),
    async invoke(value) {
      return options.invoke(options.parseInput(value));
    },
  };
}

/** 与普通描述符使用相同生命周期，只增加具名能力路由和输入校验。 */
export function definePlugin<Capabilities extends PluginCapabilities>(
  options: DefinePluginOptions<Capabilities>,
): TypedPluginDescriptor<Capabilities> {
  return {
    ...options,
    async create(context) {
      const module = await options.create(context);
      const capabilities = new Map(Object.entries(module.capabilities));
      return {
        capabilities: module.capabilities,
        events: module.events,
        dashboard: module.dashboard,
        reflect: module.reflect?.bind(module),
        consolidate: module.consolidate?.bind(module),
        onEvent: module.onEvent?.bind(module),
        provideContext: module.provideContext?.bind(module),
        resolveContext: module.resolveContext?.bind(module),
        dispose: module.dispose?.bind(module),
        async invoke(name, input) {
          const capability = capabilities.get(name);
          if (!capability) throw new Error(`Unsupported plugin capability: ${name}`);
          return capability.invoke(input);
        },
      };
    },
  };
}

/** 显式调用使用严格错误处理；不会安装、启用插件或创建额外实例。 */
export function createPluginClient<Capabilities extends PluginCapabilities>(
  runtime: PluginRuntime,
  descriptor: TypedPluginDescriptor<Capabilities>,
  scope: PluginScope | PluginScopeContext = 'user',
): PluginClient<Capabilities> {
  return {
    invoke<Name extends keyof Capabilities & string>(
      name: Name,
      input: ReturnType<Capabilities[Name]['parseInput']>,
    ): Promise<Awaited<ReturnType<Capabilities[Name]['invoke']>>> {
      return runtime.invoke(descriptor.id, name, input, scope, { throwOnError: true }) as Promise<
        Awaited<ReturnType<Capabilities[Name]['invoke']>>
      >;
    },
  };
}
