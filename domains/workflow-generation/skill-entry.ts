/** 包内入口只解析宿主输入；进度、批准与结果检查仍交给公开的应用 SDK。 */
export function applicationSkillEntryScript(): string {
  return `import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { invokeWorkflowApplicationSkill } from '@rpamis/comet/applications';

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    'project-root': { type: 'string' }, 'run-id': { type: 'string' },
    'input-file': { type: 'string' }, 'result-file': { type: 'string' },
    'initial-state-file': { type: 'string' },
    'workflow-id': { type: 'string' }, 'action-id': { type: 'string' },
    'session-id': { type: 'string' }, 'executor-id': { type: 'string' },
    capability: { type: 'string', multiple: true }, receipt: { type: 'string' },
    choice: { type: 'string' }, 'decision-id': { type: 'string' }
  } });
  const operation = positionals[0];
  const required = key => { if (!values[key]) throw new Error('缺少 --'+key); return values[key]; };
  const jsonFile = async key => JSON.parse(await readFile(required(key), 'utf8'));
  const receipt = () => JSON.parse(Buffer.from(required('receipt'), 'base64url').toString('utf8'));
  let request;
  if (operation === 'start') request = { operation, input: await jsonFile('input-file'), ...(values['run-id'] ? {runId:values['run-id']} : {}), ...(values['workflow-id'] ? {workflowId:values['workflow-id']} : {}), ...(values['initial-state-file'] ? {initialState:await jsonFile('initial-state-file')} : {}) };
  else if (['inspect', 'resume'].includes(operation)) request = { operation, ...(values['run-id'] ? {runId:values['run-id']} : {}) };
  else if (operation === 'next') request = { operation, runId: required('run-id') };
  else if (operation === 'claim') request = { operation, runId: required('run-id'), actionId: required('action-id'), executorId: values['executor-id'], sessionId: values['session-id'], capabilities: values.capability ?? [] };
  else if (operation === 'execute') request = { operation, runId: required('run-id'), actionId: required('action-id'), executorId: required('executor-id') };
  else if (operation === 'record-outcome') request = { operation, receipt: receipt(), result: await jsonFile('result-file') };
  else if (operation === 'resolve-wait') request = { operation, receipt: receipt(), choice: required('choice'), decisionId: required('decision-id') };
  else throw new Error('操作为 start、resume、inspect、next、claim、execute、record-outcome 或 resolve-wait');
  const result = await invokeWorkflowApplicationSkill({ file: fileURLToPath(new URL('../application.json', import.meta.url)), projectRoot: values['project-root'] ?? process.cwd(), request, context: { environment: Object.fromEntries(Object.entries(process.env).filter(([,value])=>typeof value==='string')) } });
  const script = fileURLToPath(import.meta.url);
  const base = [process.execPath, script, '--project-root', result.run.projectRoot];
  result.commands = {
    inspect: [...base, 'inspect', '--run-id', result.run.runId],
    resume: [...base, 'resume', '--run-id', result.run.runId],
    next: [...base, 'next', '--run-id', result.run.runId],
    actions: result.run.current.actions.map(action => ({
      actionId: action.id,
      ...(action.status === 'pending' && action.claimRequest ? { claim: [...base, 'claim', '--run-id', result.run.runId, '--action-id', action.id, '--executor-id', action.claimRequest.executorId, ...action.requiredCapabilities.flatMap(value => ['--capability',value])] } : {}),
      execute: (action.executeRequests ?? []).map(request => [...base, 'execute', '--run-id', result.run.runId, '--action-id', action.id, '--executor-id', request.executorId]),
      ...(result.receipts.actions.find(value => JSON.parse(Buffer.from(value,'base64url').toString('utf8')).actionId === action.id) ? { recordOutcome: [...base, 'record-outcome', '--receipt', result.receipts.actions.find(value => JSON.parse(Buffer.from(value,'base64url').toString('utf8')).actionId === action.id), '--result-file', '<实际结果JSON文件>'] } : {})
    })),
    waits: result.receipts.waits.map(value => ({ receipt: value, resolve: [...base, 'resolve-wait', '--receipt', value, '--choice', '<用户本次选择>', '--decision-id', '<用户决定来源>'] })),
    children: result.run.current.children.map(child => [...base, 'inspect', '--run-id', child.runId])
  };
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.log(JSON.stringify({ status: 'failed', error: { code: error.code ?? 'INVALID_REQUEST', message: error.message } }));
  process.exitCode = 1;
}
`;
}

export function applicationSkillEntryProtocol(): string {
  return `## 在 Agent 中启动和继续

加载本 Skill 后先执行本节，再根据 Runtime 当前步骤使用后面的业务说明。用户始终在 Agent 对话中使用 Skill；Dashboard 自动读取运行记录。

1. 新任务：按业务说明与已声明的输入要求整理真实输入，写入项目的临时 JSON 文件，执行 \`node "<本目录>/scripts/comet-run.mjs" start --project-root "<用户项目>" --input-file "<输入JSON文件>"\`。入口定义见[流程定义](workflow.json)，可执行脚本见[运行入口](scripts/comet-run.mjs)。存在多个入口时明确 --workflow-id。
   流程需要初始状态时，沿业务说明中的原领域初始化接口取得真实状态，追加 --initial-state-file "<初始状态JSON文件>"；不能把评估样例状态用于真实任务，也不由通用入口猜测 Native/Classic 的状态或批准。
2. 继续已有任务：使用对话中原 Run ID 执行 \`node "<本目录>/scripts/comet-run.mjs" resume --project-root "<用户项目>" --run-id "<原Run ID>"\`。新会话没有 Run ID 时，执行同一 resume 命令并省略 --run-id；唯一未结束任务会被定位，多项任务需向用户确认后选择。resume 会恢复当前应用归属，保留原领取；只读查看用 inspect。恢复不另建 Run，不重复已完成的工作。
3. 响应的 run.current 列出当前工作，commands 提供完整参数。先沿 next 调度就绪步骤和子流程。由注册执行器完成的工作使用 execute；需要当前 Agent 执行的工作先用 claim，只有响应确认 running 后才执行。capability 仅声明当前宿主实际具备的能力。
4. 读取该 Action 的实际 input、outputSchema、skillWork 和业务说明，执行实际工作。固定 Skill 的加载沿下方 SDK 协议。把真实结果写成 {"status":"succeeded","output":<该步骤实际结果>}，再使用该 Action 的 commands.recordOutcome，仅替换实际结果文件路径。入口会读取已声明产物的真实文件并收集摘要；额外产物在 artifacts 中填写 uri、sha256。失败按实际 status 回报；Schema 或工件检查拒绝后修正同一次尝试。
5. run.current.waits 中的提案与 choices 必须完整展示给用户；在当前 Agent 对话中取得用户决定后，使用对应 commands.waits.resolve，填写实际选择和决定来源。等待用户时停止，后续继续原 Run。
6. 子流程沿 commands.children 查询和执行，子流程结束后继续父 Run 的 next。running/unknown 表示原执行仍需回报或核对，不重新领取。run.status 为 completed 时再交付真实产物；新任务使用新的 Run。

入口保存的 Run、Action 和 Wait 是 Dashboard 的进度来源。业务文字、文件存在或一条完成消息都不能代替步骤回报和实际验收。
`;
}
