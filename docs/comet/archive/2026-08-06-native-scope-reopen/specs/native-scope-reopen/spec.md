# native-scope-reopen

## 目标

Native 在 Verify 或 Archive 阶段必须保持项目实现写入保护，同时为用户主动提出的继续实现请求提供可审计的返回 Build 机制。返回 Build 后，旧验证证据必须失效，新的实现范围必须重新封存并重新验证。

## Requirements

### Requirement: 显式返回 Build

Runtime MUST extend the existing `comet native next <change-name>` command with an explicit `--return-to-build` option. The option MUST be accepted only when the current phase is `verify` or `archive`, and MUST require a non-empty summary explaining why implementation must continue.

#### Scenario: Verify 中用户要求继续实现

- **WHEN** 当前 change 处于 Verify，且用户明确要求继续修改项目实现
- **THEN** Agent MUST NOT attempt the project write while the phase remains Verify
- **AND** Runtime MUST accept `comet native next <change-name> --summary <summary> --return-to-build`
- **AND** the change MUST enter Build through the normal mutation lock and transition journal

#### Scenario: Build 中错误使用返回参数

- **WHEN** 当前 change 处于 Shape 或 Build，且调用方提供 `--return-to-build`
- **THEN** Runtime MUST reject the command with a structured usage error
- **AND** MUST NOT modify phase, revision, Run state, or evidence

### Requirement: 返回 Build 的状态清理

Returning to Build MUST invalidate the prior completion evidence while preserving the change identity and workspace boundary.

#### Scenario: 清理 Verify/Archive 证据

- **WHEN** Verify 或 Archive change successfully returns to Build
- **THEN** Runtime MUST set `phase: build` and increment revision
- **AND** MUST clear `verification_result`, `verification_report`, `implementation_scope`, `verification_evidence`, and `partial_allowance`
- **AND** MUST preserve the baseline, workspace binding, change branch, current selection, and approved contract hash
- **AND** MUST NOT increment Verify failure or repair failure counters

#### Scenario: 返回后重新建立 scope

- **WHEN** Agent modifies the project after returning to Build
- **THEN** the next Build transition MUST derive a new content-addressed implementation scope
- **AND** the next Verify MUST use only the new scope and new receipts
- **AND** old Verify or Archive evidence MUST NOT be reusable

### Requirement: 需求归属与契约变化

Native MUST distinguish an implementation extension of the current change from a user-visible contract change and an unrelated request.

#### Scenario: 当前 change 的实现扩展

- **WHEN** the requested file change is necessary for the already confirmed behavior but changes no user-visible contract
- **THEN** Agent MAY keep the request in the current change
- **AND** MUST return to Build before writing when the phase is Verify or Archive
- **AND** MUST include the new file or directory in the next Build artifact references

#### Scenario: 用户可见范围变化

- **WHEN** the requested work changes the outcome, scope, acceptance criteria, or non-goals
- **THEN** Agent MUST update the brief and complete target specification before implementation
- **AND** the changed contract MUST require the Native confirmation boundary before leaving Build
- **AND** the old implementation and verification evidence MUST NOT be presented as current

#### Scenario: 无关请求

- **WHEN** the requested work is unrelated to the active change
- **THEN** Agent MUST NOT attribute it to the active change or mutate its implementation scope
- **AND** Agent MUST preserve the active change's recoverable state and guide the user to a separate Native change/worktree

### Requirement: Hook Guard 恢复提示

Native Hook Guard MUST continue to deny ordinary project writes outside Build, but its denial MUST identify the current phase and the supported recovery direction.

#### Scenario: Verify 项目写入被阻止

- **WHEN** a write target is inside the guarded project but outside Native control artifacts and the selected change is in Verify or Archive
- **THEN** Guard MUST return `allowed: false`
- **AND** the reason MUST state that implementation writes are allowed only in Build
- **AND** the reason MUST instruct the Agent to decide current-change versus separate-change ownership and use the Native return-to-Build recovery path when applicable

#### Scenario: Build 中项目写入

- **WHEN** the selected change is in Build and the write target is inside the guarded project
- **THEN** Guard MUST preserve the existing allowed behavior
- **AND** Build evidence MUST remain responsible for detecting undeclared or unattributed changes at the phase boundary

### Requirement: 参数与状态安全

The explicit return operation MUST fail closed when combined with evidence inputs or when its persisted transition cannot be proven safe.

#### Scenario: 参数互斥

- **WHEN** `--return-to-build` is combined with `--result`, `--report`, `--artifact`, `--no-code-reason`, partial-scope options, or Verify receipt options
- **THEN** Runtime MUST reject the command before writing state or evidence

#### Scenario: 事务中断恢复

- **WHEN** the return transition is interrupted after its journal is prepared
- **THEN** Native status/doctor MUST report the pending transition
- **AND** explicit recovery MUST preserve or complete the same transition without silently rewriting user-authored artifacts

### Requirement: 双语 Skill 与 Runtime 资产一致

The Chinese and English Native Skill and command reference MUST describe the same scope-change behavior, and generated Native runtime assets MUST be rebuilt from source.

#### Scenario: Skill 恢复流程

- **WHEN** a user asks for a project write during Verify or Archive
- **THEN** the Skill MUST instruct the Agent to inspect ownership, avoid a direct project edit, return the current change to Build when applicable, and re-read status before continuing

#### Scenario: 生成资产

- **WHEN** Native Runtime source or CLI entry changes
- **THEN** `pnpm build:native-runtime` MUST regenerate the self-contained Native runtime and command bundles
- **AND** repository asset and runtime tests MUST verify the generated outputs

## 非目标

- 不改变 Classic workflow。
- 不移除 Verify/Archive 的 fail-closed 项目写入保护。
- 不新增独立 Native phase、外部 Skill 依赖或手工状态编辑能力。
