import { createServer } from 'vite';

const projectRoot = process.argv[2];
if (!projectRoot) process.exit(64);

const server = await createServer({
  root: process.cwd(),
  logLevel: 'silent',
  appType: 'custom',
  server: { middlewareMode: true },
});
const writer = await server.ssrLoadModule('/domains/workflow-contract/project-config-writer.ts');
const config = await server.ssrLoadModule('/domains/workflow-contract/project-config.ts');

await writer.writeWorkflowProjectConfig(
  projectRoot,
  config.defaultWorkflowProjectConfig('crash-output'),
  {
    beforePublish: () => process.exit(73),
  },
);
await server.close();
