# SDK release contract

This contract applies to `@rpamis/comet/runtime`, `@rpamis/comet/plugins`, and `@rpamis/comet/plugins/comet`. Native, Classic, and their existing state-file workflows remain unchanged.

## Support and upgrades

- These three public entrypoints follow the Comet package version. Existing deep imports remain compatible; new applications should not depend on the file layout under `domains/`.
- Patch versions preserve public parameters, return values, and the meaning of existing error codes. Hosts must handle unfamiliar content conservatively when optional fields, interfaces, or error codes are added; do not assume the error-code set is closed. Breaking changes require an explicit version and upgrade guidance.
- The npm package version, a Run's `protocolVersion` / `schemaVersion`, and a Workflow's `id` / `version` are separate contracts. Updating the npm package does not automatically update definitions pinned by active Runs or migrate old changes.
- Register the original Workflow and validator versions when recovering. Use a new version for changed workflow content and retain old definitions needed by active Runs. Do not rewrite a definition under the same version or alter checkpoint hashes to force recovery.
- The SDK currently targets Node.js ESM. See `package.json`'s `engines` for supported Node versions; CI package verification covers the minimum Node 22.16 and Node 24. TypeScript consumer checks use 5.9.3 with `NodeNext` and `Bundler` resolution, including referenced declaration files. Earlier TypeScript versions, CommonJS `require`, and browser execution are not guaranteed. Passing `Bundler` type resolution does not establish browser support.

## Public interface change checks

Build first, then check the public declaration reports for all three entrypoints:

```bash
pnpm build
pnpm check:sdk-api
```

To accept an intentional interface change, run:

```bash
pnpm update:sdk-api
```

Reports live in `config/sdk-api/*.api.md`. Ordinary checks do not overwrite accepted reports; missing declarations, missing reports, or declaration changes fail the check. CI runs it before package verification. Updating a report does not establish compatibility: review parameters, return values, recovery semantics, and existing consumers. Declaration reports do not replace behavioral tests.

## Errors and recovery

`RuntimeProtocolError` retains its existing `name`, `code`, and message format and adds a read-only `recovery` suggestion. The public types are `RuntimeErrorCode` and `RuntimeErrorRecovery`. Its constructor still accepts host-defined or future error codes; unknown codes return `manual-review`. Existing CLI error output remains unchanged. Do not parse message text to decide whether to retry.

| `recovery`            | Host action                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `inspect-run`         | Read the Run again, inspect its revision, Actions, Waits, or terminal state, and determine whether the original request still applies                                                |
| `review-proposal`     | Show the current proposal and obtain a user decision bound to its current hash; do not reuse an old approval                                                                         |
| `reconcile-execution` | Stop or contact the original executor and inspect external side effects; an unknown result does not mean the action was never executed                                               |
| `inspect-outcome`     | Read the saved result and rejection reason; submit corrections under the original claim and outcome-identity rules without repeating the external action                             |
| `correct-input`       | Check the request, configuration, or validation requirements; stop to diagnose invalid persisted state rather than editing the Run directly                                          |
| `restore-definition`  | Supply the original definitions, validators, or a compatible Runtime, and correct host registrations; do not reinterpret old state with a replacement definition                     |
| `repair-storage`      | Inspect directories, the filesystem, and original records; preserve evidence before repairing the adapter or restoring a valid backup, and never delete history to bypass validation |
| `manual-review`       | Preserve state and error details, then diagnose; do not retry automatically                                                                                                          |

These values are starting points for diagnosis, not execution authorization or a `retryable` switch. Even after cancellation or a revision conflict, inspect committed state before deciding to continue. Retry an external action only after confirming it was not executed and submitting reconciliation evidence. Do not use a “not executed” retry to conceal side effects when the original result was rejected.

```ts
import { RuntimeProtocolError } from '@rpamis/comet/runtime';

try {
  await runtime.execute(command);
} catch (error) {
  if (error instanceof RuntimeProtocolError) {
    // Show guidance to the host; do not retry or repeat tool execution here.
    showRecovery({ code: error.code, recovery: error.recovery });
  }
  throw error;
}
```

The host supplies `runtime`, `command`, and `showRecovery` in this example. Plugin error behavior remains as described in the [plugin guide](./plugin-sdk.md): use `{ throwOnError: true }` for critical `invoke` calls and do not treat the default `null` return as success.

## Consumer and recovery verification

`pnpm test:package-e2e` installs a real npm tarball into an isolated project and verifies public JavaScript imports, TypeScript consumption, declaration files, the existing CLI, and Native/Classic integration. Type checks do not use `skipLibCheck` and cover both `NodeNext` and `Bundler`.

The frozen recovery fixture in `test/fixtures/runtime-sdk-v1-045/` was generated from isolated source at commit `5990e5c3b8e27dc7e11ed99f0d49f5a90e5159f0`. It checks approval recovery, preservation of original Actions, rejection of stale approvals and definition drift, and prevention of automatic redispatch when execution is unknown. The same consumer script also runs against the installed package.

This fixture comes from the first public SDK's unreleased 0.4.5 candidate. It is not proof of compatibility between released SDK versions: current master has no such public Runtime entrypoint. Future versions must add fixtures generated by actual released packages and record the package version or commit. Do not overwrite old fixtures or recompute their hashes with current code. Old Native/Classic changes continue through the `compat` path; this SDK fixture does not replace their compatibility acceptance.
