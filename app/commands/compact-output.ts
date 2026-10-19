/** facade 先记录完整结果，再投影 stdout；子进程分隔符后的参数保持原样。 */
export function splitCompactOutputArgs(
  args: readonly string[],
  enabled = true,
): { args: readonly string[]; compact: boolean } {
  const boundary = args.indexOf('--');
  const own = boundary < 0 ? args : args.slice(0, boundary);
  const compact = enabled && own.includes('--json') && own.includes('--compact');
  return {
    args: compact
      ? args.filter((arg, index) => arg !== '--compact' || (boundary >= 0 && index > boundary))
      : args,
    compact,
  };
}
