## ADDED Requirements

### Requirement: Change initializes auto transition setting

Comet MUST write an `auto_transition` boolean field into every newly initialized Change `.comet.yaml`.

#### Scenario: Project config enables manual flow

- **WHEN** `openspec/comet.yaml` exists with top-level `auto_transition: false`
- **THEN** `comet-state.sh init <change> <workflow>` MUST write `auto_transition: false` into `openspec/changes/<change>/.comet.yaml`

#### Scenario: Project config is absent

- **WHEN** `openspec/comet.yaml` does not exist
- **THEN** `comet-state.sh init <change> <workflow>` MUST write `auto_transition: true` into the Change `.comet.yaml`

#### Scenario: Project config omits the setting

- **WHEN** `openspec/comet.yaml` exists without top-level `auto_transition`
- **THEN** `comet-state.sh init <change> <workflow>` MUST write `auto_transition: true` into the Change `.comet.yaml`

#### Scenario: Project config has an invalid setting

- **WHEN** `openspec/comet.yaml` contains top-level `auto_transition` with a value other than `true` or `false`
- **THEN** `comet-state.sh init <change> <workflow>` MUST write `auto_transition: true` into the Change `.comet.yaml`

### Requirement: Change state validates auto transition

Comet MUST treat `auto_transition` as a known Change state field whose valid values are `true` and `false`.

#### Scenario: State field can be set

- **WHEN** a user runs `comet-state.sh set <change> auto_transition false`
- **THEN** the script MUST update `.comet.yaml` to `auto_transition: false`

#### Scenario: Invalid state value is rejected

- **WHEN** a user runs `comet-state.sh set <change> auto_transition maybe`
- **THEN** the script MUST fail with an enum validation error

#### Scenario: YAML validation includes the field

- **WHEN** `comet-yaml-validate.sh <change>` validates a Change `.comet.yaml`
- **THEN** it MUST require `auto_transition`
- **AND** it MUST reject values other than `true` or `false`

### Requirement: Skills respect manual transition mode

Comet Skill instructions MUST consult the current Change `.comet.yaml` before executing any non-terminal automatic transition.

#### Scenario: State advances before manual pause

- **WHEN** a Skill reaches an automatic transition node and `.comet.yaml` has `auto_transition: false`
- **THEN** the Skill MUST first run the required phase guard with `--apply`
- **AND** `.comet.yaml` MUST record the next phase before the Skill stops for manual continuation

#### Scenario: Auto transition is enabled

- **WHEN** a Skill reaches an automatic transition node and `.comet.yaml` has `auto_transition: true`
- **THEN** the Skill MUST continue to the documented next Skill after required guards and blocking user decisions are complete

#### Scenario: Auto transition is disabled

- **WHEN** a Skill reaches an automatic transition node and `.comet.yaml` has `auto_transition: false`
- **THEN** the Skill MUST NOT invoke the next Skill automatically
- **AND** it MUST print a clear prompt naming the next Skill the user may run manually

#### Scenario: Existing Change lacks the field

- **WHEN** a Skill reaches an automatic transition node and `.comet.yaml` lacks `auto_transition`
- **THEN** the Skill MUST behave as if `auto_transition: true`

### Requirement: Auto transition state is readable by Skill command

Comet MUST expose `auto_transition` through the existing `comet-state.sh get` command so Skill instructions can use a tested read path.

#### Scenario: Reading initialized auto transition value

- **WHEN** a Change `.comet.yaml` contains `auto_transition: false`
- **THEN** `comet-state.sh get <change> auto_transition` MUST print `false`

#### Scenario: Reading default auto transition value

- **WHEN** a Change is initialized without project-level `openspec/comet.yaml`
- **THEN** `comet-state.sh get <change> auto_transition` MUST print `true`
