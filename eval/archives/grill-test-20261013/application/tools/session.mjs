import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {loadWorkflowApplication} from '@rpamis/comet/applications';
const [command,runId,argument]=process.argv.slice(2);
const project=process.cwd();
const packageRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const file=path.join(packageRoot,'application.json');
const cli=path.resolve(path.dirname(fileURLToPath(import.meta.resolve('@rpamis/comet/applications'))),'../../../bin/comet.js');
const loaded=await loadWorkflowApplication({file,projectRoot:project,readOnly:true});
async function dispatch(request){
 const dir=path.join(project,'.scratch/grill-test/requests');await fs.mkdir(dir,{recursive:true});
 const ref=path.join(dir,randomUUID()+'.json');await fs.writeFile(ref,JSON.stringify({protocolVersion:1,requestId:randomUUID(),...request},null,2));
 const p=spawnSync(process.execPath,[cli,'runtime','dispatch','--application-file',file,'--project-root',project,'--request',ref,'--details','--json'],{encoding:'utf8',env:process.env,timeout:120000});
 if(p.error)throw p.error;const response=JSON.parse(p.stdout);
 if(p.status||response.status!=='succeeded'){console.log(JSON.stringify(response,null,2));process.exit(p.status||1);}
 return response;
}
if(command==='skills'){
 const ids=runId?[runId]:[...loaded.skills.keys()];
 console.log(JSON.stringify(ids.map(id=>{const skill=loaded.skills.get(id);if(!skill)throw new Error('Unknown fixed Skill');return {id,root:skill.root,contentHash:skill.contentHash,verifiedBySdk:true,skillText:skill.files['SKILL.md']};}),null,2));
}else if(command==='start'){
 const input=JSON.parse(await fs.readFile(runId,'utf8'));console.log(JSON.stringify(await dispatch({operation:'start',workflow:{id:'grill-test',version:'3'},input}),null,2));
}else{
 const run=await loaded.store.read(runId);if(!run)throw new Error('Run not found');
 const request={runId,expectedRevision:run.revision};
 if(command==='inspect'){request.operation='inspect';delete request.expectedRevision;}
 else if(command==='next')request.operation='next';
 else if(command==='decide'){
  const waits=run.waits.filter(w=>w.status==='pending');if(waits.length!==1||!waits[0].choices.includes(argument))throw new Error('Current Wait or choice invalid');
  Object.assign(request,{operation:'resolve-wait',waitId:waits[0].id,proposalHash:waits[0].proposalHash,decisionId:randomUUID(),choice:argument});
 }else{
  const actions=run.actions.filter(a=>command==='record'?a.status==='running'&&a.claim:a.status==='pending');
  if(actions.length!==1)throw new Error('Expected one current Action');const a=actions[0];
  if(command==='claim')Object.assign(request,{operation:'claim',actionId:a.id,attempt:a.attempt,inputHash:a.inputHash,executorId:'grill-test-host',sessionId:'actual-host-'+randomUUID(),claimToken:randomUUID(),capabilities:['skill-load','handoff','local-tracker','local-commit']});
  else if(command==='execute')Object.assign(request,{operation:'execute',actionId:a.id,executorId:'grill-test-local'});
  else if(command==='record'){
   const output=JSON.parse(await fs.readFile(argument,'utf8'));
   const contract=loaded.manifest.artifactContracts.find(c=>c.workflowId===run.workflow.id&&c.stepId===a.stepId);
   const artifacts=[];
   for(const artifact of contract?.artifacts??[]){if(!artifact.ref)throw new Error('Dynamic artifacts require an explicit port');const bytes=await fs.readFile(path.join(project,artifact.ref));artifacts.push({uri:artifact.ref,sha256:createHash('sha256').update(bytes).digest('hex')});}
   Object.assign(request,{operation:'record-outcome',outcome:{actionId:a.id,attempt:a.attempt,inputHash:a.inputHash,claimToken:a.claim.token,outcomeId:randomUUID(),status:'succeeded',output,artifacts}});
  }else throw new Error('Use skills/start/inspect/next/claim/record/decide/execute');
 }
 let response=await dispatch(request);
 if(command==='next'){for(let n=0;n<3&&response.data.actions.some(a=>a.type==='child_workflow'&&a.status==='pending');n++)response=await dispatch({operation:'next',runId,expectedRevision:response.data.revision});}
 if(command==='decide'&&argument==='approved'){const ack=response.data.actions.find(a=>a.status==='pending'&&a.ref==='complete');if(ack)response=await dispatch({operation:'execute',runId,expectedRevision:response.data.revision,actionId:ack.id,executorId:'grill-test-local'});}
 console.log(JSON.stringify(response,null,2));
}
