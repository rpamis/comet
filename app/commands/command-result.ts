export type CommandCompletionStatus = 'complete' | 'incomplete';

export interface CommandExecutionResult {
  status: CommandCompletionStatus;
}

export function exitCodeForCommandResult(result: CommandExecutionResult): number {
  return result.status === 'complete' ? 0 : 1;
}
