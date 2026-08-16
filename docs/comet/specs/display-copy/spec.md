## Display copy consistency

### Requirement: confirmed results use confirmed copy

The report and Dashboard MUST use a plain confirmed label after a `skill-coordinated` result is confirmed.

#### Scenario: confirmed skill-coordinated result

- **GIVEN** a skill-coordinated verification result has been confirmed
- **WHEN** the report or Dashboard is rendered
- **THEN** it MUST NOT say that confirmation is still required
- **AND** the raw assurance value MUST remain `skill-coordinated`

### Requirement: machine values remain stable

Runtime state and status JSON MUST preserve the original assurance enum values.
