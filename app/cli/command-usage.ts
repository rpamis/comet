import type { Command } from 'commander';

interface CommandUsage {
  command: string;
  requiredArguments: string[];
  requiredOptions: Array<{ flags: string; description: string; choices?: string[] }>;
  missingOptions: string[];
  helpCommand: string;
}

const failedCommands = new WeakMap<object, Command>();

/** 保留 Commander 的校验和错误，只在失败时生成可直接用于修正调用的参数说明。 */
export function configureCommandUsageErrors(command: Command): void {
  command.exitOverride((error) => {
    if (error.exitCode !== 0) failedCommands.set(error, command);
    throw error;
  });
  for (const child of command.commands) configureCommandUsageErrors(child);
}

export function commandUsageForError(error: unknown): CommandUsage | undefined {
  if (!error || typeof error !== 'object') return;
  const command = failedCommands.get(error);
  if (!command) return;
  const ancestors: Command[] = [];
  for (let current: Command | null = command; current; current = current.parent)
    ancestors.unshift(current);
  const options = ancestors.flatMap((owner) =>
    owner.options.filter((option) => option.mandatory).map((option) => ({ owner, option })),
  );
  return {
    command: command.createHelp().commandUsage(command),
    requiredArguments: command.registeredArguments
      .filter((argument) => argument.required)
      .map((argument) => `<${argument.name()}${argument.variadic ? '...' : ''}>`),
    requiredOptions: options.map(({ option }) => ({
      flags: option.flags,
      description: option.description,
      ...(option.argChoices ? { choices: option.argChoices } : {}),
    })),
    missingOptions: options
      .filter(({ owner, option }) => owner.getOptionValue(option.attributeName()) === undefined)
      .map(({ option }) => option.flags),
    helpCommand: `${ancestors.map((entry) => entry.name()).join(' ')} --help`,
  };
}
