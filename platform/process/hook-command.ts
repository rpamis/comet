/** 将路径作为编码后的 argv 传递；宿主 shell 不解释参数中的字符。 */
export function buildNodeHookCommand(args: readonly string[]): string {
  const encoded = Buffer.from(JSON.stringify(args)).toString('base64');
  return `node -e "const r=require('node:child_process').spawnSync(process.execPath,JSON.parse(Buffer.from('${encoded}','base64').toString()),{stdio:'inherit'});process.exit(r.status??1)"`;
}

/** 只识别完整的托管命令，不能把附带其他命令的用户配置误认为 Comet 所有。 */
export function readNodeHookArguments(command: unknown): string[] | null {
  if (typeof command !== 'string') return null;
  const encoded = /Buffer\.from\('([A-Za-z0-9+/=]+)','base64'\)/u.exec(command)?.[1];
  if (!encoded) return null;
  try {
    const args: unknown = JSON.parse(Buffer.from(encoded, 'base64').toString());
    if (!Array.isArray(args) || !args.every((arg) => typeof arg === 'string')) return null;
    return buildNodeHookCommand(args) === command ? args : null;
  } catch {
    return null;
  }
}
