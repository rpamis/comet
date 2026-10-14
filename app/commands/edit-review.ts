import path from 'node:path';

export async function editReviewCommand(
  operation: string,
  workflow: string,
  name: string,
  options: {
    projectRoot?: string;
    file?: string;
    confirmed?: boolean;
  },
) {
  try {
    const input = {
      ...options,
      projectRoot: path.resolve(options.projectRoot ?? process.cwd()),
      name,
      operation,
    };
    const data =
      workflow === 'native'
        ? await (
            await import('../../domains/comet-native/native-edit-review-command.js')
          ).runNativeEditReviewCommand(input)
        : workflow === 'classic'
          ? await (
              await import('../../domains/comet-classic/classic-edit-review-command.js')
            ).runClassicEditReviewCommand(input)
          : (() => {
              throw new Error('工作流必须是 native 或 classic');
            })();
    process.stdout.write(JSON.stringify({ ok: true, data }) + '\n');
  } catch (error) {
    process.stdout.write(
      JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }) +
        '\n',
    );
    process.exitCode = 1;
  }
}
