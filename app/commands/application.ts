import path from 'node:path';
import {
  previewWorkflowApplicationInstall,
  installWorkflowApplication,
  exportWorkflowApplication,
  uninstallWorkflowApplication,
  type ApplicationDeliveryOptions,
} from '../../domains/workflow-application/index.js';

interface ApplicationCommandOptions {
  project?: string;
  scope?: 'project' | 'user';
  userRoot?: string;
  upgrade?: boolean;
  confirmationHash?: string;
  host?: 'codex' | 'claude-code';
  json?: boolean;
}
function deliveryOptions(options: ApplicationCommandOptions): ApplicationDeliveryOptions {
  if (options.scope && !['project', 'user'].includes(options.scope))
    throw new Error('scope 必须为 project 或 user');
  return {
    projectRoot: path.resolve(options.project ?? '.'),
    scope: options.scope ?? 'project',
    ...(options.userRoot ? { userRoot: path.resolve(options.userRoot) } : {}),
    ...(options.host ? { host: options.host } : {}),
  };
}
export async function applicationInstallCommand(
  file: string,
  options: ApplicationCommandOptions = {},
) {
  const input = { ...deliveryOptions(options), file: path.resolve(file), upgrade: options.upgrade };
  const result = options.confirmationHash
    ? await installWorkflowApplication({ ...input, confirmationHash: options.confirmationHash })
    : await previewWorkflowApplicationInstall(input);
  console.log(JSON.stringify(result, null, 2));
}
export async function applicationExportCommand(
  file: string,
  destination: string,
  options: ApplicationCommandOptions = {},
) {
  console.log(
    JSON.stringify(
      await exportWorkflowApplication({
        file: path.resolve(file),
        destination: path.resolve(destination),
        projectRoot: deliveryOptions(options).projectRoot,
      }),
      null,
      2,
    ),
  );
}
export async function applicationUninstallCommand(
  id: string,
  options: ApplicationCommandOptions = {},
) {
  console.log(
    JSON.stringify(
      await uninstallWorkflowApplication({
        ...deliveryOptions(options),
        id,
        confirmationHash: options.confirmationHash,
      }),
      null,
      2,
    ),
  );
}
