#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';

import { PLATFORMS, getPlatformSkillsDir } from '../../dist/platform/install/platforms.js';

const repositoryRoot = path.resolve('.');
const requiredPackageFiles = [
  'assets/manifest.json',
  'assets/skills/comet/SKILL.md',
  'assets/skills/comet/scripts/comet-entry-runtime.mjs',
  'assets/skills/comet/scripts/comet-hook-router.mjs',
  'assets/skills/comet/scripts/comet-runtime.mjs',
  'assets/skills/comet/scripts/comet-state.mjs',
  'assets/skills/comet-native/SKILL.md',
  'assets/skills/comet-native/scripts/comet-native-runtime.mjs',
  'assets/skills/comet-native/scripts/comet-native-new.mjs',
  'assets/skills/comet-native/scripts/comet-native-status.mjs',
  'bin/comet.js',
  'bin/comet-daemon-route.js',
  'bin/comet-daemon-router.js',
  'bin/fast-runtime-router.js',
  'dist/app/cli/index.js',
  'dist/domains/engine/runtime.js',
  'dist/domains/engine/runtime.d.ts',
  'dist/domains/workflow-generation/index.js',
  'dist/domains/workflow-generation/index.d.ts',
  'dist/domains/comet-plugin/sdk.js',
  'dist/domains/comet-plugin/sdk.d.ts',
  'dist/domains/comet-plugin/comet.js',
  'dist/domains/comet-plugin/comet.d.ts',
  'dist/platform/install/platforms.js',
  'eval/schemas/comet.eval/v1alpha1.schema.json',
  'scripts/install/postinstall.js',
];
const requiredNativeInstallFiles = [
  'comet/SKILL.md',
  'comet/scripts/comet-entry-runtime.mjs',
  'comet/scripts/comet-hook-router.mjs',
  'comet-native/SKILL.md',
  'comet-native/scripts/comet-native-runtime.mjs',
  'comet-native/scripts/comet-native-new.mjs',
  'comet-native/scripts/comet-native-status.mjs',
];
const packageTestPlatform = 'codex';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: 'utf8',
    env: options.env ?? process.env,
    shell: process.platform === 'win32' && command === 'npm',
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed (${String(result.status)})\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout;
}

function parseJsonPayload(raw) {
  const sanitized = raw.replace(/\u001b\[[0-9;]*m/g, '').trim();
  const starts = [...sanitized.matchAll(/[\[{]/g)].map((match) => match.index).reverse();
  for (const start of starts) {
    try {
      return JSON.parse(sanitized.slice(start));
    } catch {
      // Lifecycle scripts may write non-JSON output before npm's final payload.
    }
  }
  throw new Error(`No JSON payload found in output:\n${raw}`);
}

async function assertFile(filePath, description) {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`${description} is missing: ${filePath}`);
  }
}

async function disableCliFallback(packageRoot, relativePath) {
  const source = path.join(packageRoot, ...relativePath.split('/'));
  const disabled = `${source}.package-e2e-disabled`;
  await fs.rename(source, disabled);
}

async function main() {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-package-e2e-'));
  try {
    const packageDir = path.join(temporaryRoot, 'package');
    const consumerDir = path.join(temporaryRoot, 'consumer');
    const projectDir = path.join(temporaryRoot, 'project');
    const sdkNativeProjectDir = path.join(temporaryRoot, 'sdk-native-project');
    const classicProjectDir = path.join(temporaryRoot, 'classic-project');
    const homeDir = path.join(temporaryRoot, 'home');
    const npmCache = path.join(temporaryRoot, 'npm-cache');
    await Promise.all(
      [
        packageDir,
        consumerDir,
        projectDir,
        sdkNativeProjectDir,
        classicProjectDir,
        homeDir,
        npmCache,
      ].map((directory) => fs.mkdir(directory, { recursive: true })),
    );

    // npm pack runs with --ignore-scripts, so drive the npm README transform
    // manually around it to exercise the exact tarball npm publish would ship.
    run(process.execPath, ['scripts/release/npm-readme.mjs', 'apply']);
    let packOutput;
    try {
      packOutput = run(
        'npm',
        ['pack', '--json', '--ignore-scripts=true', '--pack-destination', packageDir],
        { env: { ...process.env, npm_config_ignore_scripts: 'true' } },
      );
    } finally {
      run(process.execPath, ['scripts/release/npm-readme.mjs', 'restore']);
    }
    const [packed] = parseJsonPayload(packOutput);
    if (!packed?.filename || !Array.isArray(packed.files)) {
      throw new Error(`npm pack returned an unexpected payload:\n${packOutput}`);
    }
    const packageFiles = new Set(packed.files.map((entry) => entry.path));
    for (const required of requiredPackageFiles) {
      if (!packageFiles.has(required)) {
        throw new Error(`Published tarball is missing required file: ${required}`);
      }
    }

    const tarball = path.join(packageDir, packed.filename);
    const packageJson = JSON.parse(await fs.readFile('package.json', 'utf8'));
    const packageName = packageJson.name;
    const packageRoot = path.join(consumerDir, 'node_modules', ...packageName.split('/'));
    const cli = path.join(packageRoot, 'bin', 'comet.js');
    const environment = {
      ...process.env,
      CI: 'true',
      COMET_NO_HINTS: '1',
      HOME: homeDir,
      USERPROFILE: homeDir,
      LOCALAPPDATA: path.join(homeDir, 'AppData', 'Local'),
      XDG_CACHE_HOME: path.join(homeDir, '.cache'),
      NPM_CONFIG_CACHE: npmCache,
      npm_config_cache: npmCache,
    };

    run('npm', ['init', '--yes'], { cwd: consumerDir, env: environment });
    run('npm', ['install', '--no-audit', '--no-fund', tarball], {
      cwd: consumerDir,
      env: environment,
    });
    await assertFile(cli, 'Installed Comet CLI');

    const packedReadme = await fs.readFile(path.join(packageRoot, 'README.md'), 'utf8');
    if (/!\[[^\]]*\]\(img\/[a-z0-9-]+\.mp4\)/u.test(packedReadme)) {
      throw new Error(
        'Packed README still embeds relative mp4 videos; npmjs.com would render them as broken images.',
      );
    }
    for (const preview of ['supervisor-codex-preview.png', 'supervisor-claude-code-preview.png']) {
      if (!packedReadme.includes(preview)) {
        throw new Error(`Packed README is missing the npm preview image: ${preview}`);
      }
    }

    const version = run(process.execPath, [cli, '--version'], {
      cwd: consumerDir,
      env: environment,
    }).trim();
    if (version !== packageJson.version) {
      throw new Error(
        `Installed CLI version mismatch: expected ${packageJson.version}, got ${version}`,
      );
    }

    const runtimeImport = `${packageName}/runtime`;
    const compilerExample = path.join(consumerDir, 'workflow-application-compiler-example.mjs');
    const compilerProject = path.join(consumerDir, 'compiler-project');
    await fs.copyFile(
      path.join(repositoryRoot, 'scripts/lib/workflow-application-compiler-example.mjs'),
      compilerExample,
    );
    const waitingReport = parseJsonPayload(
      run(process.execPath, [compilerExample, compilerProject], {
        cwd: consumerDir,
        env: environment,
      }),
    );
    if (waitingReport.status !== 'waiting' || waitingReport.published)
      throw new Error('Compiled report published before its approval');
    const completedReport = parseJsonPayload(
      run(process.execPath, [compilerExample, compilerProject, '--approve'], {
        cwd: consumerDir,
        env: environment,
      }),
    );
    if (
      completedReport.status !== 'completed' ||
      !completedReport.published ||
      completedReport.runId !== waitingReport.runId
    )
      throw new Error('Compiled report did not resume and publish the same approved Run');
    const applicationFile = path.join(compilerProject, 'compiled-application/application.json');
    const distributeArgs = [
      'application',
      'distribute',
      applicationFile,
      '--project',
      compilerProject,
      '--platform',
      'all',
      '--json',
    ];
    const applicationCli = (args) =>
      parseJsonPayload(
        run(process.execPath, [cli, ...args], {
          cwd: consumerDir,
          env: environment,
        }),
      );
    const distribution = applicationCli(distributeArgs);
    const evalPreview = applicationCli([
      'eval',
      applicationFile,
      '--project',
      compilerProject,
      '--agent',
      'codex',
      '--model',
      'fixture-model',
      '--collect',
    ]);
    if (
      !evalPreview.noModelsStarted ||
      evalPreview.application.id !== distribution.id ||
      !evalPreview.workflows.length ||
      evalPreview.taskCount.max !== 4
    )
      throw new Error('Packaged SDK application Eval did not preview actual workflows');
    if (distribution.evaluation.status !== 'not-evaluated')
      throw new Error('An unevaluated package was shown as evaluated');
    if (!distribution.noFilesWritten || distribution.platforms.length !== PLATFORMS.length)
      throw new Error('Packaged application distribution did not preview every Comet platform');
    const distributed = applicationCli([
      ...distributeArgs,
      '--confirmation-hash',
      distribution.confirmationHash,
    ]);
    for (const platform of distribution.platforms) {
      const entry = path.join(platform.skillsRoot, 'compiler-report/SKILL.md');
      await assertFile(entry, `Distributed application entry for ${platform.id}`);
      if (!(await fs.readFile(entry, 'utf8')).includes(path.dirname(distributed.file)))
        throw new Error(`Application entry for ${platform.id} lost its fixed package location`);
    }
    const distributionRequest = path.join(consumerDir, 'distributed-application-request.json');
    await fs.writeFile(
      distributionRequest,
      JSON.stringify({
        operation: 'start',
        runId: 'distributed-from-tarball',
        workflow: { id: 'report-publishing', version: '1' },
        input: {
          title: 'Tarball distribution',
          body: 'Fixed application package',
          sources: ['package consumer'],
        },
      }),
    );
    const applicationRunArgs = [
      'runtime',
      'dispatch',
      '--application',
      'compiler-report',
      '--project-root',
      compilerProject,
      '--request',
      distributionRequest,
      '--details',
      '--json',
    ];
    const startedDistribution = applicationCli(applicationRunArgs);
    if (
      startedDistribution.status !== 'succeeded' ||
      startedDistribution.application?.packageRoot !==
        (await fs.realpath(path.dirname(distributed.file)))
    )
      throw new Error('Packaged CLI could not start the distributed immutable application');
    const uninstallArgs = [
      'application',
      'uninstall',
      'compiler-report',
      '--project',
      compilerProject,
      '--json',
    ];
    const removal = applicationCli(uninstallArgs);
    applicationCli([...uninstallArgs, '--confirmation-hash', removal.confirmationHash]);
    await fs.writeFile(
      distributionRequest,
      JSON.stringify({ operation: 'inspect', runId: 'distributed-from-tarball' }),
    );
    const restoredDistribution = applicationCli(applicationRunArgs);
    if (
      restoredDistribution.status !== 'succeeded' ||
      restoredDistribution.application?.packageRoot !==
        (await fs.realpath(path.dirname(distributed.file)))
    )
      throw new Error('Uninstall lost an existing distributed application Run');
    const pluginsImport = `${packageName}/plugins`;
    const cometPluginsImport = `${packageName}/plugins/comet`;
    for (const [name, flags, reason] of [
      ['runtime-sdk-example', '--approve', 'approval-required'],
      ['runtime-sdk-recovery-example', '--reconcile', 'execution-unknown'],
    ]) {
      const exampleFile = path.join(consumerDir, `${name}.mjs`);
      const exampleRoot = path.join(temporaryRoot, name);
      await fs.copyFile(path.join(repositoryRoot, `scripts/lib/${name}.mjs`), exampleFile);
      const first = JSON.parse(
        run(process.execPath, [exampleFile, '--root-dir', exampleRoot], {
          cwd: consumerDir,
          env: environment,
        }),
      );
      if (first.reason !== reason)
        throw new Error(`Packaged ${name} did not stop safely: ${JSON.stringify(first)}`);
      const completed = JSON.parse(
        run(
          process.execPath,
          [
            exampleFile,
            '--root-dir',
            exampleRoot,
            flags,
            ...(flags === '--reconcile' ? ['--confirmed-stopped'] : []),
          ],
          { cwd: consumerDir, env: environment },
        ),
      );
      if (completed.reason !== 'completed')
        throw new Error(`Packaged ${name} did not resume: ${JSON.stringify(completed)}`);
    }
    const pluginExample = path.join(consumerDir, 'plugin-example.mjs');
    await fs.writeFile(
      pluginExample,
      await fs.readFile(path.join(repositoryRoot, 'scripts/lib/plugin-sdk-example.mjs'), 'utf8'),
    );
    const pluginExampleResult = JSON.parse(
      run(process.execPath, [pluginExample], { cwd: consumerDir, env: environment }),
    );
    if (
      pluginExampleResult.value?.note !== 'Keep changes scoped.' ||
      pluginExampleResult.context?.[0]?.owner !== 'example.notes' ||
      pluginExampleResult.disabledContext?.length !== 0
    ) {
      throw new Error(
        'Installed plugin SDK did not preserve storage, context, and disable behavior',
      );
    }

    const pluginAssembly = JSON.parse(
      run(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
            import { createDefaultCometPluginBridge } from ${JSON.stringify(cometPluginsImport)};
            const bridge = await createDefaultCometPluginBridge({
              projectRoot: ${JSON.stringify(projectDir)}, projectId: 'package-plugin-project',
              homeDirectory: ${JSON.stringify(homeDir)},
              config: { 'example.packaged': { answer: 42 } },
              descriptors: [{
                id: 'example.packaged', kind: 'third-party', version: '1', scopes: ['project'],
                compatible: () => true,
                create: ({ config }) => ({ invoke: () => config.answer }),
              }],
            });
            const runtime = bridge.pluginRuntime;
            const before = await runtime.get('example.packaged');
            await runtime.install('example.packaged');
            const answer = await runtime.invoke('example.packaged', 'answer', null, {
              scope: 'project', projectId: 'package-plugin-project',
            }, { throwOnError: true });
            console.log(JSON.stringify({ before: before.status, answer, plugins: (await runtime.list()).map(item => item.id) }));
          `,
        ],
        { cwd: consumerDir, env: environment },
      ),
    );
    if (
      pluginAssembly.before !== 'uninstalled' ||
      pluginAssembly.answer !== 42 ||
      !pluginAssembly.plugins.includes('comet.personal-memory') ||
      !pluginAssembly.plugins.includes('comet.project-knowledge')
    ) {
      throw new Error(
        'Installed Comet plugin assembly did not retain built-ins and explicit installation',
      );
    }
    const runtimeRoot = path.join(projectDir, '.comet', 'runtime-sdk-store');
    const runtimeRunId = 'package-e2e-sdk-run';
    const sdkStart = run(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
          import { createFileRuntimeStore, createRuntime } from ${JSON.stringify(runtimeImport)};
          await import(${JSON.stringify(`${packageName}/dist/platform/install/platforms.js`)});
          const runtime = createRuntime({
            store: createFileRuntimeStore({ rootDir: ${JSON.stringify(runtimeRoot)} }),
            workflows: [{
              id: 'package-sdk', version: '1', entry: 'collect',
              initialState: { phase: 'collect' },
              stateSchema: { type: 'object', required: ['phase'], properties: { phase: { const: 'collect' } } },
              transitionHandler: { id: 'package-transition', version: '1' },
              steps: { collect: { type: 'invoke_skill', ref: 'research.collect' } },
            }],
            transitionHandlers: [{
              id: 'package-transition', version: '1',
              apply: () => ({ state: { phase: 'collect' }, next: [] }),
            }],
          });
          const run = await runtime.start({
            runId: ${JSON.stringify(runtimeRunId)},
            workflow: { id: 'package-sdk', version: '1' },
            input: { topic: 'tarball consumer' },
          });
          if (run.status !== 'running' || run.actions[0]?.type !== 'invoke_skill' || run.state?.phase !== 'collect') {
            throw new Error('Runtime SDK did not persist its initial Skill action');
          }
          process.stdout.write(JSON.stringify({ runId: run.runId, revision: run.revision }));
        `,
      ],
      { cwd: consumerDir, env: environment },
    );
    const sdkStarted = JSON.parse(sdkStart);
    if (sdkStarted.runId !== runtimeRunId || sdkStarted.revision !== 1) {
      throw new Error(`Installed JavaScript SDK returned an invalid Run: ${sdkStart}`);
    }

    const integrationRunId = 'package-e2e-sdk-integration';
    const publishedReport = path.join(projectDir, 'sdk-report.md');
    const integrationSetup = `
      import { writeFileSync } from 'node:fs';
      import { createFileRuntimeStore, createRuntime } from ${JSON.stringify(runtimeImport)};
      const runId = ${JSON.stringify(integrationRunId)};
      const runtime = createRuntime({
        store: createFileRuntimeStore({ rootDir: ${JSON.stringify(runtimeRoot)} }),
        workflows: [{
          id: 'package-sdk-integration', version: '1', entry: 'collect',
          steps: {
            collect: { type: 'invoke_skill', ref: 'research.collect' },
            approve: { type: 'ask_user', proposalFrom: 'collect' },
            publish: { type: 'call_tool', ref: 'reports.write' },
          },
          transitions: [
            { from: 'collect', to: 'approve' },
            { from: 'approve', to: 'publish', on: 'approved' },
          ],
        }],
        executors: [{
          id: 'consumer-host', capabilities: [],
          supports: (action) => ['invoke_skill', 'call_tool'].includes(action.type),
          async execute(action) {
            if (action.ref === 'research.collect') {
              return { status: 'succeeded', output: { report: 'Packaged SDK resumed across processes' } };
            }
            if (action.ref === 'reports.write') {
              if (action.input.outputs.approve?.choice !== 'approved') {
                throw new Error('The package consumer did not approve this report');
              }
              writeFileSync(${JSON.stringify(publishedReport)}, action.input.outputs.collect.report);
              return { status: 'succeeded', output: { published: true } };
            }
            throw new Error('Unsupported package consumer action');
          },
        }],
      });
    `;
    function runIntegration(operation) {
      return JSON.parse(
        run(process.execPath, ['--input-type=module', '-e', `${integrationSetup}\n${operation}`], {
          cwd: consumerDir,
          env: environment,
        }),
      );
    }
    const integrationStarted = runIntegration(`
      const result = await runtime.start({
        runId, workflow: { id: 'package-sdk-integration', version: '1' }, input: null,
      });
      process.stdout.write(JSON.stringify({ status: result.status, action: result.actions.at(-1) }));
    `);
    if (
      integrationStarted.status !== 'running' ||
      integrationStarted.action?.stepId !== 'collect'
    ) {
      throw new Error('Installed SDK did not create the initial Skill action');
    }
    const integrationWaiting = runIntegration(`
      const current = await runtime.inspect(runId);
      const result = await runtime.execute({
        runId, actionId: current.actions.at(-1).id, executorId: 'consumer-host',
      });
      process.stdout.write(JSON.stringify({
        status: result.status,
        wait: result.waits.at(-1),
        pendingActions: result.actions.filter((action) => action.status === 'pending').length,
      }));
    `);
    if (
      integrationWaiting.status !== 'waiting' ||
      integrationWaiting.wait?.stepId !== 'approve' ||
      integrationWaiting.wait?.status !== 'pending' ||
      integrationWaiting.pendingActions !== 0 ||
      (await fs.stat(publishedReport).then(
        () => true,
        (error) => {
          if (error.code === 'ENOENT') return false;
          throw error;
        },
      ))
    ) {
      throw new Error(
        `Installed SDK did not persist an approval Wait before publishing: ${JSON.stringify(integrationWaiting)}`,
      );
    }
    const integrationApproved = runIntegration(`
      const current = await runtime.inspect(runId);
      const wait = current.waits.at(-1);
      const result = await runtime.resolveWait({
        runId, waitId: wait.id, proposalHash: wait.proposalHash,
        decisionId: 'package-consumer-approval', choice: 'approved',
      });
      process.stdout.write(JSON.stringify({ status: result.status, action: result.actions.at(-1) }));
    `);
    if (
      integrationApproved.status !== 'running' ||
      integrationApproved.action?.stepId !== 'publish'
    ) {
      throw new Error('Installed SDK did not resume the approved Tool action');
    }
    const integrationPublished = runIntegration(`
      const current = await runtime.inspect(runId);
      const result = await runtime.execute({
        runId, actionId: current.actions.at(-1).id, executorId: 'consumer-host',
      });
      process.stdout.write(JSON.stringify({ status: result.status }));
    `);
    if (integrationPublished.status !== 'completed') {
      throw new Error('Installed SDK did not complete the approved workflow');
    }
    const integrationRecovered = runIntegration(`
      const result = await runtime.inspect(runId);
      process.stdout.write(JSON.stringify({ status: result.status, published: result.outputs.publish?.value }));
    `);
    if (
      integrationRecovered.status !== 'completed' ||
      integrationRecovered.published?.published !== true ||
      (await fs.readFile(publishedReport, 'utf8')) !== 'Packaged SDK resumed across processes'
    ) {
      throw new Error('Installed SDK did not preserve the completed Run and published report');
    }

    const sdkTypeScript = path.join(consumerDir, 'runtime-consumer.ts');
    const pluginsTypeScript = path.join(consumerDir, 'plugin-consumer.ts');
    const ergonomicsTypeScript = path.join(consumerDir, 'sdk-ergonomics-consumer.mts');
    await fs.copyFile(
      path.join(repositoryRoot, 'test/helpers/sdk-ergonomics-consumer.ts'),
      ergonomicsTypeScript,
    );
    await fs.writeFile(
      pluginsTypeScript,
      `import { PluginRuntime, MemoryPluginStateStore, AGENT_EXPERIENCE_SCHEMA, type AgentContextCandidate, type AgentExperienceEvent, type PluginDescriptor, type PluginStorageStore } from ${JSON.stringify(pluginsImport)};
       import { createDefaultCometPluginBridge, type CometPluginBridgeOptions } from ${JSON.stringify(cometPluginsImport)};
       const descriptor: PluginDescriptor = {
         id: 'typed-plugin', kind: 'third-party', version: '1', scopes: ['project'], compatible: () => true,
         create: (context) => ({
           invoke: async (_capability, input) => { await context.storage.write(input); return context.storage.read(); },
           provideContext: (): AgentContextCandidate => ({
             id: 'note', owner: context.pluginId, scope: 'project', memoryType: 'project-policy',
             kind: 'note', state: 'proven', authority: 'user', title: 'Note', summary: 'Use scoped changes',
             selectors: {}, sources: [{ type: 'user' }], verification: [],
           }),
           onEvent: (event: AgentExperienceEvent) => { const schema: typeof AGENT_EXPERIENCE_SCHEMA = event.schema; void schema; },
         }),
       };
       const storage: PluginStorageStore = { open: async () => ({ read: async () => null, write: async () => {} }) };
       const runtime = new PluginRuntime({ cometVersion: '0.4.5', store: new MemoryPluginStateStore(), storage, descriptors: [descriptor] });
       const options: CometPluginBridgeOptions = { projectRoot: '.', projectId: 'typed-project', descriptors: [descriptor], config: { 'typed-plugin': { enabled: true } } };
       void runtime; void createDefaultCometPluginBridge(options);
      `,
    );
    await fs.writeFile(
      sdkTypeScript,
      `import { approval, evidence, tool, createMemoryRuntimeStore, createRuntime, defineWorkflow, skill, RuntimeProtocolError, type RuntimeErrorCode, type RuntimeErrorRecovery, type RuntimeEvidenceValidator, type RuntimeExecutor, type WorkflowRun, type WorkflowTransitionHandler } from ${JSON.stringify(runtimeImport)};\n` +
        `const workflow = defineWorkflow({\n` +
        `  id: 'typed', version: '1', entry: 'collect',\n` +
        `  steps: { collect: skill({ ref: 'research.collect' }), approve: approval({ proposalFrom: 'collect' }), publish: tool({ ref: 'reports.write' }) },\n` +
        `  transitions: [{ from: 'collect', to: 'approve' }, { from: 'approve', to: 'publish', on: 'approved' }],\n` +
        `});\n` +
        `const executor: RuntimeExecutor = { id: 'host', capabilities: [], supports: () => true, async execute() { return { status: 'succeeded', output: null }; } };\n` +
        `const transition: WorkflowTransitionHandler = { id: 'transition', version: '1', apply: () => ({ state: { phase: 'done' }, next: [] }) };\n` +
        `const evidenceValidator: RuntimeEvidenceValidator = { id: 'evidence', version: '1', validate: () => ({ accepted: true, actualHash: 'a'.repeat(64) }) };\n` +
        `const evidenceStep = evidence({ kind: 'check-receipt', validator: { id: 'evidence', version: '1' } });\n` +
        `void transition; void evidenceValidator; void evidenceStep;\n` +
        `const runtime = createRuntime({ store: createMemoryRuntimeStore<WorkflowRun>(), workflows: [workflow], executors: [executor] });\n` +
        `const request: Parameters<typeof runtime.start>[0] = { runId: 'typed-run', workflow: { id: 'typed', version: '1' }, input: null };\n` +
        `void runtime.start(request).then((run) => { const revision: number = run.revision; void revision; });\n` +
        `const knownCode: RuntimeErrorCode = 'REVISION_CONFLICT';\n` +
        `const recovery: RuntimeErrorRecovery = new RuntimeProtocolError(knownCode, 'conflict').recovery;\n` +
        `new RuntimeProtocolError('FUTURE_HOST_ERROR', 'unknown'); void recovery;\n` +
        `// @ts-expect-error Unknown names are not declared core error codes.\n` +
        `const invalidCode: RuntimeErrorCode = 'TYPO_ERROR'; void invalidCode;\n`,
    );
    for (const [module, moduleResolution] of [
      ['NodeNext', 'NodeNext'],
      ['ESNext', 'Bundler'],
    ]) {
      run(
        process.execPath,
        [
          path.join(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
          '--module',
          module,
          '--moduleResolution',
          moduleResolution,
          '--target',
          'ES2022',
          '--strict',
          '--noEmit',
          sdkTypeScript,
          pluginsTypeScript,
          ergonomicsTypeScript,
        ],
        { cwd: consumerDir, env: environment },
      );
    }

    const ergonomicsJavaScript = path.join(consumerDir, 'sdk-ergonomics-consumer.mjs');
    const { outputText: ergonomicsOutput } = ts.transpileModule(
      await fs.readFile(ergonomicsTypeScript, 'utf8'),
      { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
    );
    await fs.writeFile(ergonomicsJavaScript, ergonomicsOutput);
    run(process.execPath, [ergonomicsJavaScript], { cwd: consumerDir, env: environment });

    const compatConsumer = path.join(consumerDir, 'sdk-compat-consumer.mjs');
    const compatFixture = path.join(consumerDir, 'sdk-compat-run.json');
    await fs.copyFile(
      path.join(repositoryRoot, 'test/helpers/runtime-sdk-compat-consumer.mjs'),
      compatConsumer,
    );
    await fs.copyFile(
      path.join(repositoryRoot, 'test/fixtures/runtime-sdk-v1-045/run.json'),
      compatFixture,
    );
    const compatibility = JSON.parse(
      run(process.execPath, [compatConsumer, compatFixture, packageName], {
        cwd: consumerDir,
        env: environment,
      }),
    );
    if (
      compatibility.approval !== 'completed' ||
      compatibility.unknown !== 'unknown' ||
      compatibility.executions !== 1 ||
      !compatibility.staleApprovalRejected ||
      !compatibility.definitionDriftRejected ||
      !compatibility.unsafeRetryRejected
    ) {
      throw new Error(
        `Published SDK failed the frozen Run compatibility contract: ${JSON.stringify(compatibility)}`,
      );
    }

    const runtimeInspectRequest = path.join(consumerDir, 'runtime-inspect.json');
    await fs.writeFile(
      runtimeInspectRequest,
      JSON.stringify({ operation: 'inspect', requestId: 'inspect-from-cli', runId: runtimeRunId }),
    );
    const inspected = parseJsonPayload(
      run(
        process.execPath,
        [
          cli,
          'runtime',
          'dispatch',
          '--request',
          runtimeInspectRequest,
          '--root-dir',
          runtimeRoot,
          '--json',
        ],
        { cwd: consumerDir, env: environment },
      ),
    );
    if (
      inspected.status !== 'succeeded' ||
      inspected.data?.runId !== runtimeRunId ||
      inspected.data?.actions?.[0]?.ref !== 'research.collect'
    ) {
      throw new Error(
        `Packaged CLI could not reopen the JavaScript SDK Run: ${JSON.stringify(inspected)}`,
      );
    }

    const init = parseJsonPayload(
      run(
        process.execPath,
        [
          cli,
          'init',
          projectDir,
          '--yes',
          '--workflow',
          'native',
          '--platform',
          packageTestPlatform,
          '--json',
        ],
        {
          cwd: consumerDir,
          env: environment,
        },
      ),
    );
    if (init.status !== 'complete' || !Array.isArray(init.results) || init.failures.length > 0) {
      throw new Error(
        `Packaged Native init did not complete successfully: ${JSON.stringify(init)}`,
      );
    }
    if (init.results.length !== 1 || init.results[0]?.platform !== packageTestPlatform) {
      throw new Error(
        `Packaged Native init covered ${init.results.length} platforms; expected ${packageTestPlatform}`,
      );
    }

    for (const result of init.results) {
      if (!['installed', 'skipped'].includes(result.comet)) {
        throw new Error(`${result.platform}: packaged Comet install status was ${result.comet}`);
      }
      const platform = PLATFORMS.find((candidate) => candidate.id === result.platform);
      if (!platform) throw new Error(`Unknown platform in init output: ${result.platform}`);
      const skillsRoot = path.join(projectDir, getPlatformSkillsDir(platform, 'project'), 'skills');
      for (const relative of requiredNativeInstallFiles) {
        await assertFile(path.join(skillsRoot, relative), `${platform.name} packaged Native asset`);
      }
    }

    const resolution = parseJsonPayload(
      run(process.execPath, [cli, 'workflow', 'resolve', projectDir, '--json'], {
        cwd: consumerDir,
        env: environment,
      }),
    );
    if (resolution.workflow !== 'native' || resolution.skill !== 'comet-native') {
      throw new Error(`Packaged workflow resolution failed: ${JSON.stringify(resolution)}`);
    }

    const doctor = parseJsonPayload(
      run(process.execPath, [cli, 'doctor', projectDir, '--scope', 'project', '--json'], {
        cwd: consumerDir,
        env: environment,
      }),
    );
    if (doctor.status === 'failed' || doctor.healthy === false) {
      throw new Error(`Packaged doctor reported an unhealthy install: ${JSON.stringify(doctor)}`);
    }

    const installedSkills = path.join(projectDir, '.agents', 'skills');
    const knowledge = parseJsonPayload(
      run(process.execPath, [cli, 'knowledge', 'status', projectDir, '--json'], {
        cwd: consumerDir,
        env: environment,
      }),
    );
    if (!knowledge.status?.healthy || !knowledge.status?.writable) {
      throw new Error(`Packaged knowledge storage is unavailable: ${JSON.stringify(knowledge)}`);
    }
    const knowledgeSource = 'docs/comet/specs/package-verification.md';
    await fs.mkdir(path.dirname(path.join(projectDir, knowledgeSource)), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, knowledgeSource),
      '# Ledger recovery\n\nLedger transactions support rollback recovery.\n',
    );
    const knowledgeQuery = parseJsonPayload(
      run(
        process.execPath,
        [cli, 'knowledge', 'query', projectDir, '--task', 'ledger rollback', '--json'],
        { cwd: consumerDir, env: environment },
      ),
    );
    const knowledgeDiagnostics = [
      ...(knowledgeQuery.diagnostics ?? []),
      ...(knowledgeQuery.result?.diagnostics ?? []),
    ];
    if (
      !knowledgeQuery.result?.results?.some((result) => result.source === knowledgeSource) ||
      knowledgeDiagnostics.some((diagnostic) => diagnostic.code === 'index-unavailable')
    ) {
      throw new Error(
        `Packaged knowledge search is unavailable: ${JSON.stringify(knowledgeQuery)}`,
      );
    }
    const installedNativeNew = path.join(
      installedSkills,
      'comet-native',
      'scripts',
      'comet-native-new.mjs',
    );
    const installedNativeStatus = path.join(
      installedSkills,
      'comet-native',
      'scripts',
      'comet-native-status.mjs',
    );
    const installedEntryRuntime = path.join(
      installedSkills,
      'comet',
      'scripts',
      'comet-entry-runtime.mjs',
    );
    const installedHookRouter = path.join(
      installedSkills,
      'comet',
      'scripts',
      'comet-hook-router.mjs',
    );
    for (const [script, description] of [
      [installedNativeNew, 'Installed Native new runtime'],
      [installedNativeStatus, 'Installed Native status runtime'],
      [installedEntryRuntime, 'Installed Entry runtime'],
      [installedHookRouter, 'Installed Hook Router runtime'],
    ]) {
      await assertFile(script, description);
    }

    const createdChange = parseJsonPayload(
      run(
        process.execPath,
        [
          installedNativeNew,
          'package-runtime-change',
          '--runtime',
          'compat',
          '--project-root',
          projectDir,
          '--json',
        ],
        { cwd: projectDir, env: environment },
      ),
    );
    if (
      createdChange.command !== 'new' ||
      createdChange.exitCode !== 0 ||
      createdChange.data?.name !== 'package-runtime-change' ||
      createdChange.data?.run !== undefined
    ) {
      throw new Error(
        `Installed Native runtime could not create a change: ${JSON.stringify(createdChange)}`,
      );
    }

    const nativeStatus = parseJsonPayload(
      run(
        process.execPath,
        [installedNativeStatus, 'package-runtime-change', '--project-root', projectDir, '--json'],
        {
          cwd: projectDir,
          env: environment,
        },
      ),
    );
    if (
      nativeStatus.command !== 'status' ||
      nativeStatus.exitCode !== 0 ||
      nativeStatus.data?.name !== 'package-runtime-change' ||
      nativeStatus.data?.phase !== 'shape'
    ) {
      throw new Error(
        `Installed Native runtime returned an invalid status: ${JSON.stringify(nativeStatus)}`,
      );
    }

    const sdkNativeInit = parseJsonPayload(
      run(
        process.execPath,
        [
          cli,
          'init',
          sdkNativeProjectDir,
          '--yes',
          '--workflow',
          'native',
          '--platform',
          packageTestPlatform,
          '--json',
        ],
        { cwd: consumerDir, env: environment },
      ),
    );
    if (sdkNativeInit.status !== 'complete') {
      throw new Error(`Packaged Native SDK project init failed: ${JSON.stringify(sdkNativeInit)}`);
    }
    const nativeSdkChange = 'package-native-sdk';
    const nativeSdkCreated = parseJsonPayload(
      run(
        process.execPath,
        [cli, 'native', 'new', nativeSdkChange, '--project-root', sdkNativeProjectDir, '--json'],
        { cwd: sdkNativeProjectDir, env: environment },
      ),
    );
    if (
      nativeSdkCreated.exitCode !== 0 ||
      nativeSdkCreated.data?.run?.id !== nativeSdkChange ||
      nativeSdkCreated.data?.run?.actions?.[0]?.stepId !== 'shape.prepare'
    ) {
      throw new Error(
        `Packaged Native SDK new did not create its Run: ${JSON.stringify(nativeSdkCreated)}`,
      );
    }
    const nativeState = await fs.readFile(
      path.join(
        sdkNativeProjectDir,
        'docs',
        'comet',
        'changes',
        nativeSdkChange,
        'comet-state.yaml',
      ),
      'utf8',
    );
    if (!nativeState.includes('schema: comet.native.v4') || !nativeState.includes('phase: shape')) {
      throw new Error('Packaged Native SDK new did not retain comet-state.yaml');
    }
    const nativeSdkInspectFile = path.join(consumerDir, 'native-sdk-inspect.json');
    await fs.writeFile(
      nativeSdkInspectFile,
      JSON.stringify({
        operation: 'inspect',
        requestId: 'native-sdk-cold-inspect',
        runId: nativeSdkChange,
      }),
    );
    const nativeSdkReopened = parseJsonPayload(
      run(
        process.execPath,
        [
          cli,
          'runtime',
          'dispatch',
          '--application',
          'native',
          '--request',
          nativeSdkInspectFile,
          '--project-root',
          sdkNativeProjectDir,
          '--json',
        ],
        { cwd: consumerDir, env: environment },
      ),
    );
    if (
      nativeSdkReopened.status !== 'succeeded' ||
      nativeSdkReopened.data?.runId !== nativeSdkChange ||
      nativeSdkReopened.data?.state?.phase !== 'shape' ||
      nativeSdkReopened.data?.actions?.[0]?.stepId !== 'shape.prepare'
    ) {
      throw new Error(
        `Packaged Native SDK Run did not cold-reopen: ${JSON.stringify(nativeSdkReopened)}`,
      );
    }
    const nativeSdkHookDecision = parseJsonPayload(
      run(
        process.execPath,
        [
          installedHookRouter,
          '--platform',
          'github-copilot',
          '--project-root',
          sdkNativeProjectDir,
        ],
        {
          cwd: sdkNativeProjectDir,
          env: { ...environment, FILE_PATH: 'src/index.ts' },
        },
      ),
    );
    if (
      nativeSdkHookDecision.permissionDecision !== 'deny' ||
      !String(nativeSdkHookDecision.permissionDecisionReason).includes(nativeSdkChange)
    ) {
      throw new Error(
        `Packaged Native SDK Hook did not guard Shape: ${JSON.stringify(nativeSdkHookDecision)}`,
      );
    }

    const installedResolution = parseJsonPayload(
      run(process.execPath, [installedEntryRuntime, projectDir, '--json'], {
        cwd: projectDir,
        env: environment,
      }),
    );
    if (installedResolution.workflow !== 'native' || installedResolution.skill !== 'comet-native') {
      throw new Error(
        `Installed Entry runtime resolution failed: ${JSON.stringify(installedResolution)}`,
      );
    }

    const hookDecision = parseJsonPayload(
      run(
        process.execPath,
        [installedHookRouter, '--platform', 'github-copilot', '--project-root', projectDir],
        {
          cwd: projectDir,
          env: { ...environment, FILE_PATH: 'src/index.ts' },
        },
      ),
    );
    if (
      hookDecision.permissionDecision !== 'deny' ||
      !String(hookDecision.permissionDecisionReason).toLowerCase().includes('only allowed in build')
    ) {
      throw new Error(
        `Installed Hook Router did not block a Shape write: ${JSON.stringify(hookDecision)}`,
      );
    }

    await fs.mkdir(path.join(classicProjectDir, '.comet'), { recursive: true });
    await fs.mkdir(path.join(classicProjectDir, 'openspec'), { recursive: true });
    await fs.writeFile(
      path.join(classicProjectDir, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: classic',
        'workflows: [classic]',
        'classic:',
        '  artifact_layout: legacy',
        '',
      ].join('\n'),
    );
    await fs.writeFile(
      path.join(classicProjectDir, 'openspec', 'config.yaml'),
      'schema: spec-driven\n',
    );

    await Promise.all([
      disableCliFallback(packageRoot, 'dist/domains/comet-native/native-cli.js'),
      disableCliFallback(packageRoot, 'dist/domains/comet-entry/workflow-resolution.js'),
      disableCliFallback(packageRoot, 'dist/domains/comet-classic/classic-cli.js'),
    ]);

    const fastNativeStatus = parseJsonPayload(
      run(
        process.execPath,
        [cli, 'native', 'status', 'package-runtime-change', '--project-root', projectDir, '--json'],
        {
          cwd: consumerDir,
          env: environment,
        },
      ),
    );
    if (fastNativeStatus.command !== 'status' || fastNativeStatus.exitCode !== 0) {
      throw new Error(
        `CLI did not use the packaged Native fast runtime: ${JSON.stringify(fastNativeStatus)}`,
      );
    }

    const fastResolution = parseJsonPayload(
      run(process.execPath, [cli, 'workflow', 'resolve', projectDir, '--json'], {
        cwd: consumerDir,
        env: environment,
      }),
    );
    if (fastResolution.workflow !== 'native' || fastResolution.skill !== 'comet-native') {
      throw new Error(
        `CLI did not use the packaged Entry fast runtime: ${JSON.stringify(fastResolution)}`,
      );
    }

    const classicState = parseJsonPayload(
      run(
        process.execPath,
        [cli, 'state', 'init', 'package-classic-change', 'full', '--runtime', 'compat', '--json'],
        {
          cwd: classicProjectDir,
          env: environment,
        },
      ),
    );
    if (
      classicState.command !== 'state' ||
      classicState.exitCode !== 0 ||
      classicState.data?.run !== undefined
    ) {
      throw new Error(
        `CLI did not use the packaged Classic fast runtime: ${JSON.stringify(classicState)}`,
      );
    }

    const classicDocumentChange = parseJsonPayload(
      run(process.execPath, [cli, 'state', 'init', 'package-classic-documents', 'full', '--json'], {
        cwd: classicProjectDir,
        env: environment,
      }),
    );
    if (classicDocumentChange.exitCode !== 0 || classicDocumentChange.data?.run !== undefined) {
      throw new Error(
        `Packaged Classic non-Git init did not select compatible document delivery: ${JSON.stringify(classicDocumentChange)}`,
      );
    }
    run('git', ['init', '-b', 'main'], { cwd: classicProjectDir, env: environment });

    const classicSdkChange = 'package-classic-sdk';
    const classicSdkCreated = parseJsonPayload(
      run(process.execPath, [cli, 'state', 'init', classicSdkChange, 'full', '--json'], {
        cwd: classicProjectDir,
        env: environment,
      }),
    );
    if (
      classicSdkCreated.exitCode !== 0 ||
      classicSdkCreated.data?.run?.id !== classicSdkChange ||
      classicSdkCreated.data?.run?.actions?.[0]?.stepId !== 'full.open'
    ) {
      throw new Error(
        `Packaged Classic SDK init did not create its Run: ${JSON.stringify(classicSdkCreated)}`,
      );
    }
    const classicStateFile = await fs.readFile(
      path.join(classicProjectDir, 'openspec', 'changes', classicSdkChange, '.comet.yaml'),
      'utf8',
    );
    if (!classicStateFile.includes('workflow: full') || !classicStateFile.includes('phase: open')) {
      throw new Error('Packaged Classic SDK init did not retain .comet.yaml');
    }
    const classicSdkInspectFile = path.join(consumerDir, 'classic-sdk-inspect.json');
    await fs.writeFile(
      classicSdkInspectFile,
      JSON.stringify({
        operation: 'inspect',
        requestId: 'classic-sdk-cold-inspect',
        runId: classicSdkChange,
      }),
    );
    const classicSdkReopened = parseJsonPayload(
      run(
        process.execPath,
        [
          cli,
          'runtime',
          'dispatch',
          '--application',
          'classic-full',
          '--request',
          classicSdkInspectFile,
          '--project-root',
          classicProjectDir,
          '--json',
        ],
        { cwd: consumerDir, env: environment },
      ),
    );
    if (
      classicSdkReopened.status !== 'succeeded' ||
      classicSdkReopened.data?.runId !== classicSdkChange ||
      classicSdkReopened.data?.state?.phase !== 'open' ||
      classicSdkReopened.data?.actions?.[0]?.stepId !== 'full.open'
    ) {
      throw new Error(
        `Packaged Classic SDK Run did not cold-reopen: ${JSON.stringify(classicSdkReopened)}`,
      );
    }
    const classicSdkSelected = parseJsonPayload(
      run(process.execPath, [cli, 'state', 'select', classicSdkChange, '--json'], {
        cwd: classicProjectDir,
        env: environment,
      }),
    );
    if (classicSdkSelected.exitCode !== 0) {
      throw new Error(
        `Packaged Classic SDK change could not be selected: ${JSON.stringify(classicSdkSelected)}`,
      );
    }
    const classicSdkHookDecision = parseJsonPayload(
      run(
        process.execPath,
        [installedHookRouter, '--platform', 'github-copilot', '--project-root', classicProjectDir],
        {
          cwd: classicProjectDir,
          env: { ...environment, FILE_PATH: 'src/index.ts' },
        },
      ),
    );
    if (
      classicSdkHookDecision.permissionDecision !== 'deny' ||
      !String(classicSdkHookDecision.permissionDecisionReason).includes(classicSdkChange)
    ) {
      throw new Error(
        `Packaged Classic SDK Hook did not guard Open: ${JSON.stringify(classicSdkHookDecision)}`,
      );
    }

    for (const profile of ['hotfix', 'tweak']) {
      const change = `package-classic-${profile}`;
      const created = parseJsonPayload(
        run(process.execPath, [cli, 'state', 'init', change, profile, '--json'], {
          cwd: classicProjectDir,
          env: environment,
        }),
      );
      if (
        created.exitCode !== 0 ||
        created.data?.run?.id !== change ||
        created.data?.run?.actions?.[0]?.stepId !== `${profile}.open`
      ) {
        throw new Error(
          `Packaged Classic ${profile} did not create its SDK Run: ${JSON.stringify(created)}`,
        );
      }
      const requestFile = path.join(consumerDir, `classic-${profile}-sdk-inspect.json`);
      await fs.writeFile(
        requestFile,
        JSON.stringify({
          operation: 'inspect',
          requestId: `classic-${profile}-cold-inspect`,
          runId: change,
        }),
      );
      const reopened = parseJsonPayload(
        run(
          process.execPath,
          [
            cli,
            'runtime',
            'dispatch',
            '--application',
            `classic-${profile}`,
            '--request',
            requestFile,
            '--project-root',
            classicProjectDir,
            '--json',
          ],
          { cwd: consumerDir, env: environment },
        ),
      );
      if (
        reopened.status !== 'succeeded' ||
        reopened.data?.runId !== change ||
        reopened.data?.state?.phase !== 'open' ||
        reopened.data?.actions?.[0]?.stepId !== `${profile}.open`
      ) {
        throw new Error(
          `Packaged Classic ${profile} SDK Run did not cold-reopen: ${JSON.stringify(reopened)}`,
        );
      }
    }

    console.log(
      `Packaged Comet ${version} installed, routed, and verified for the ${packageTestPlatform} Native platform target.`,
    );
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

await main();
