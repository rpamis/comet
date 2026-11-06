import path from 'path';
import { writeChangeWalkthrough } from '../../domains/workflow-contract/change-walkthrough.js';

export async function walkthroughCommand(
  workflow: string,
  change: string,
  options: { projectRoot?: string; file: string; verificationOnly?: boolean },
): Promise<void> {
  try {
    if (workflow !== 'native' && workflow !== 'classic')
      throw new Error('workflow must be native or classic');
    const result = await writeChangeWalkthrough(
      path.resolve(options.projectRoot ?? process.cwd()),
      workflow,
      change,
      options.file,
      options.verificationOnly,
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(
      `变更说明未生成：${error instanceof Error ? error.message : String(error)}。可修正内容后重新运行；原工作流可继续。\n`,
    );
    process.exitCode = 1;
  }
}
