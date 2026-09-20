# Node Runtime Performance

## Requirement: Single process and daemon equivalence

### Scenario: Single CLI and daemon return the same result

- **WHEN** a supported Classic or Native request is executed once through the existing single process path and once through the Node daemon path with the same project root, arguments, environment binding and request payload
- **THEN** both paths MUST return the same JSON fields, exit code, error classification, state transition and continuation action
- **AND** a daemon startup, handshake or protocol failure MUST return an actionable diagnostic and allow the caller to use the single process path

## Requirement: On-demand daemon lifecycle

### Scenario: Runtime starts once and exits when idle

- **WHEN** the first request for a project, Runtime build identity and permission context arrives
- **THEN** exactly one matching Node Runtime MUST be started and acknowledged through a bounded handshake
- **AND** subsequent requests in that context MUST reuse the same Runtime process without creating another Node process
- **AND** after the configured idle timeout the Runtime MUST exit cleanly and the next request MUST start a fresh matching process
- **AND** an explicit stop operation MUST prevent new requests from reaching the stopped instance

## Requirement: Request and workspace isolation

### Scenario: Concurrent read-only projects remain isolated

- **WHEN** requests for two different projects or linked worktrees execute concurrently
- **THEN** each request MUST retain its own project root, cwd, environment, current change, authorization context and output
- **AND** no request MAY read or write the other request's locks, transactions, state, cache entries or evidence
- **AND** write, confirmation, and verification-dispatch requests MUST bypass the daemon and obey the existing mutation lock and state-version checks

## Requirement: Slow work does not block Hook decisions

### Scenario: Hook stays responsive during a slow Runtime operation

- **WHEN** a Native Git or file scan, verification preparation, or another bounded slow operation is running
- **AND** a Hook request arrives for the same or another project
- **THEN** the Hook request MUST complete within its configured bound or fail closed with a structured diagnostic
- **AND** cancellation, timeout or failure of the slow operation MUST release its resources and MUST NOT block the next Hook request

## Requirement: Bounded failure and fallback

### Scenario: Broken daemon falls back without a retry loop

- **WHEN** daemon startup races, the IPC endpoint disappears, the protocol version is incompatible, the request is malformed, or the daemon exits unexpectedly
- **THEN** the client MUST stop retrying after the configured bounded attempts
- **AND** it MUST return a structured diagnostic and run the compatible single process path when the request is safe to retry
- **AND** it MUST preserve the existing failure-closed behavior when the request cannot be safely retried

## Requirement: At-most-once write recovery

### Scenario: Write requests keep the existing at-most-once recovery boundary

- **WHEN** a write, confirmation, or verification-dispatch request is submitted
- **THEN** the client MUST bypass the read-only daemon and use the existing single-process Runtime path
- **AND** a lost response MUST continue to use the existing request identity, persisted state, recovery, or confirmation path
- **AND** daemon startup or IPC failure MUST NOT cause that write to be replayed automatically

## Requirement: Bounded Hook input

### Scenario: Hook input does not create a normal-path child Node process

- **WHEN** a supported Hook host sends a valid, closed input payload within the configured size and time limits
- **THEN** the Hook MUST read it in the current process or through a reusable bounded reader without creating a per-request Node child process
- **AND** a silent pipe, oversized payload, invalid JSON or timeout MUST finish within the configured bound and fail closed with the existing platform output contract

## Requirement: Safe action batching

### Scenario: Deterministic actions are not implicitly reordered

- **WHEN** multiple commands are listed by a Skill or caller
- **THEN** the daemon MUST NOT infer a batch, reorder commands, or combine requests across a state or authorization boundary
- **AND** explicit deterministic batching remains the caller's responsibility and keeps the existing stop-and-recover behavior
- **AND** each individual command path MUST remain available with equivalent results

## Requirement: Honest performance measurement

### Scenario: Cold, warm, fallback and idle restart are measured on valid fixtures

- **WHEN** the benchmark runs on an isolated temporary project with a successful postcondition
- **THEN** it MUST record the Node and OS versions, source and generated build identity, sample and warmup counts, process starts, Git and filesystem work, queue time, median, observed p95 and memory
- **AND** the warm path MUST show Runtime process reuse without counting fixture setup, cleanup, failed commands or invalid postconditions as performance wins
- **AND** the report MUST keep external shell, Agent and model time separate from Runtime time

## Requirement: Generated asset and safety compatibility

### Scenario: Generated and packaged entrypoints preserve existing safety contracts

- **WHEN** the source Runtime, CLI entrypoints or IPC implementation changes
- **THEN** the Classic, Native and Entry generated bundles MUST be rebuilt and checked for deterministic equality
- **AND** existing input fingerprints, mutation locks, recovery boundaries, authorization checks, plugin failure isolation and independent verification MUST continue to pass
- **AND** the package and installed Skill paths MUST expose the same supported command behavior

## Non-goals

- This capability does not combine Classic and Native state machines.
- This capability does not remove snapshots, locks, recovery, authorization, independent verification or failure-closed behavior.
- This capability does not require Rust or another native language.
- This capability does not add cross-request authorization or verification-result caching.
