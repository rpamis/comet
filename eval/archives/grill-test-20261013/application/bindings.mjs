import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readWorkflowApplicationRun } from '@rpamis/comet/applications';

const refs = {
  spec: '.scratch/grill-test/spec.md',
  tickets: '.scratch/grill-test/tickets.json',
  implement: '.scratch/grill-test/implementation.json',
  verify: '.scratch/grill-test/verification.json',
};
const safe = (root, ref) => {
  const target = path.resolve(root, ref);
  const relative = path.relative(root, target);
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep)) throw new Error('Artifact must stay within the project');
  return target;
};
const inputOf = action => { let value = action.input; while (value && typeof value === 'object' && !Array.isArray(value.acceptance) && value.input) value = value.input; return value; };
const cleanEnvironment = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !/key|token|secret|password|auth/i.test(key)));
function runTests(root, input) {
  const args = input.testCommand;
  if (!Array.isArray(args) || args.length < 2 || args.some(item => typeof item !== 'string' || !item.trim())) throw new Error('A real test command is required');
  if (!['python', 'python3', 'pytest', 'npm', 'pnpm', 'node'].includes(path.basename(args[0]).replace(/\.exe$/i,''))) throw new Error('Unsupported verification command');
  const result = spawnSync(args[0], args.slice(1), { cwd: root, encoding: 'utf8', env: cleanEnvironment(), timeout: 120000, shell: false });
  if (result.error || result.status !== 0) throw new Error('Actual tests failed: ' + (result.stderr || result.stdout || String(result.error)).slice(-1800));
  return { command: args, exitCode: result.status, stdout: result.stdout, stderr: result.stderr, status: 'passed' };
}
export function createBindings(context) {
  const read = ref => fs.readFile(safe(context.projectRoot, ref), 'utf8');
  const json = async ref => JSON.parse(await read(ref));
  const validate = step => async ({action}) => {
    try {
      const input = inputOf(action);
      const ids = input.acceptance.map(item => item.id);
      if (!ids.length || new Set(ids).size !== ids.length) throw new Error('Acceptance IDs must be explicit and unique');
      if (step === 'spec') {
        const text = await read(refs.spec);
        if (ids.some(id => !text.includes(id))) throw new Error('The Spec omits a confirmed acceptance ID');
      } else if (step === 'tickets') {
        const data = await json(refs.tickets);
        const seen = new Set(), covered = new Set();
        for (const ticket of data.tickets) {
          if (seen.has(ticket.id) || ticket.blockedBy.some(id => !seen.has(id))) throw new Error('Ticket dependencies are not acyclic and ordered');
          if (!ticket.file.startsWith('.scratch/grill-test/issues/')) throw new Error('Tickets must use the configured local tracker');
          const text = await read(ticket.file);
          if (!text.includes('**Blocked by:**') || !text.includes('**Status:** ready-for-agent') || !text.includes('- [ ]')) throw new Error('Ticket file is incomplete');
          for (const id of ticket.acceptanceIds) covered.add(id);
          seen.add(ticket.id);
        }
        if (ids.some(id => !covered.has(id))) throw new Error('Tickets do not cover all confirmed acceptance');
      } else if (step === 'implement') {
        const data = await json(refs.implement);
        const tickets = await json(refs.tickets);
        if (tickets.tickets.some(t => !data.completedTickets.includes(t.id))) throw new Error('Implementation leaves tickets unfinished');
        if (!data.filesTouched.length) throw new Error('Implementation must identify actual files');
        for (const file of data.filesTouched) await read(file);
        if (!data.reviewSummary.trim()) throw new Error('The implementation review result is missing');
      } else {
        const report = await json(refs.verify);
        if (report.status !== 'passed' || report.exitCode !== 0 || JSON.stringify(report.command) !== JSON.stringify(input.testCommand)) throw new Error('Verification report does not match the current test command');
        if (typeof report.stdout !== 'string') throw new Error('Verification output is missing');
      }
      return { accepted: true };
    } catch (error) { return { accepted: false, reason: error.message }; }
  };
  const directHost = context.createSkillExecutor({
    id: 'grill-test-host', capabilities: ['skill-load','handoff','local-tracker','local-commit'],
    authorize: async () => true,
    invokeSkill: async () => { throw new Error('This port requires the actual Agent to claim the Action, load its pinned Skill, and report the original outcome; no embedded model executor is configured'); },
  });
  const host = {...directHost, supports: action => (action.type === 'handoff' && ['grill-me','to-spec','to-tickets','implement'].includes(action.ref)) || directHost.supports(action), preflight: async (action, invocation, run) => { if (action.type !== 'handoff') return directHost.preflight(action, invocation, run); const skill = context.skills.get(action.ref); if (!skill || skill.adapter.kind !== 'subworkflow') throw new Error('An isolated pinned Skill is required'); skill.validateInput(action.input); } };
  const local = {
    id: 'grill-test-local', capabilities: ['local-test'],
    supports: action => action.type === 'call_tool' && ['verify','reject','complete'].includes(action.ref),
    execute: async (action, invocation, run) => {
      if (action.ref === 'complete') {
        if (!run.waits.some(wait => wait.stepId.startsWith('confirm-') && wait.decision?.choice === 'approved')) throw new Error('Actual child approval is required');
        return {status:'succeeded',output:{summary:'Original Skill stage completed after actual understanding or document approval'}};
      }
      if (action.ref === 'reject') return {status:'failed',output:null,summary:'The user rejected this child proposal; downstream work is blocked'};
      const report = runTests(context.projectRoot, inputOf(action));
      const ref = refs.verify;
      await fs.mkdir(path.dirname(safe(context.projectRoot, ref)), {recursive: true});
      await fs.writeFile(safe(context.projectRoot, ref), JSON.stringify(report,null,2));
      const bytes = await fs.readFile(safe(context.projectRoot, ref));
      return {status:'succeeded',output:{summary:'Actual verification command passed'},artifacts:[{uri:ref,sha256:createHash('sha256').update(bytes).digest('hex')}]};
    },
  };
  return {
    executors: [host, local],
    validators: Object.keys(refs).map(step => ({id:'grill-test-'+step,version:'1',validate:validate(step)})),
    inspectHook: async (run, request) => {
      if (request.intent !== 'write') return {allowed:true,reason:'Non-write event'};
      const requestOnly = request.targets.every(target => path.relative(context.projectRoot,path.resolve(target)).replaceAll('\\','/').startsWith('.scratch/grill-test/requests/'));
      if (requestOnly) return {allowed:true,reason:'Caller request files do not advance Runtime state'};
      const runs = [run];
      for (const candidate of [...runs]) { for (const child of candidate.children ?? []) { if (!child.runId) continue; const nested = await readWorkflowApplicationRun(context.projectRoot, context.manifest.id, child.runId); if (nested) runs.push(nested); } }
      const action = runs.flatMap(value => value.actions).find(a => a.status === 'running' && a.claim && ['handoff','invoke_skill','call_tool'].includes(a.type) && ['grill','spec','tickets','implement','verify'].includes(a.stepId));
      if (!action) return {allowed:false,reason:'A current claimed Action is required before writing'};
      for (const target of request.targets) {
        const rel = path.relative(context.projectRoot,path.resolve(target)).replaceAll('\\','/');
        if (!rel || rel.startsWith('../') || path.isAbsolute(rel) || /^(?:\.git|\.comet|\.claude|\.agents|\.codex)(?:\/|$)/.test(rel)) return {allowed:false,reason:'Control or outside-project writes are forbidden'};
        if (action.stepId === 'implement') {
          if ([refs.spec,refs.tickets].includes(rel) || rel.startsWith('.scratch/grill-test/issues/')) return {allowed:false,reason:'Confirmed upstream artifacts are immutable'};
        } else if (action.stepId === 'grill') {
          return {allowed:false,reason:'Grilling is conversation-only and has no business file output'};
        } else if (action.stepId === 'tickets') {
          if (rel !== refs.tickets && !rel.startsWith('.scratch/grill-test/issues/')) return {allowed:false,reason:'This Action can only write local ticket artifacts'};
        } else if (rel !== refs[action.stepId]) return {allowed:false,reason:'Write is outside the current stage artifact scope'};
      }
      return {allowed:true,reason:'Write belongs to the claimed Action scope'};
    },
  };
}
