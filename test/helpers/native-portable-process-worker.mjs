import path from 'node:path';
import { pathToFileURL } from 'node:url';

const payload = JSON.parse(Buffer.from(process.argv[2], 'base64url').toString('utf8'));
const runtime = await import(
  pathToFileURL(
    path.join(
      payload.repositoryRoot,
      'dist',
      'domains',
      'comet-native',
      'native-portable-runtime.js',
    ),
  ).href
);

if (payload.action === 'execute-checks') {
  await runtime.executeNativePortableCheckPlan({
    paths: payload.paths,
    name: payload.name,
    plans: payload.plans,
  });
} else if (payload.action === 'dispatch-verifier') {
  await runtime.dispatchNativePortableVerifier({
    paths: payload.paths,
    name: payload.name,
    checks: payload.checks,
    verifierExecutionId: payload.verifierExecutionId,
  });
} else {
  throw new Error(`Unknown Native portable process worker action: ${payload.action}`);
}
