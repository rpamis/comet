# Windsurf and Devin Desktop compatibility

## Requirements

### Requirement: Keep the Windsurf platform identity stable

Comet MUST continue to accept `windsurf` as the platform ID and OpenSpec tool ID. It MUST NOT require users to rename existing Comet configuration or scripts to `devin`.

#### Scenario: Existing Windsurf selection remains valid

- **Given** a user selects `--platform windsurf`
- **When** Comet resolves platform, Superpowers, or Hook mappings
- **Then** the selection resolves to the existing Windsurf platform
- **And** no `devin` platform ID is required

### Requirement: Use Devin Desktop's current Skill root for new writes

Comet MUST use `.devin/` as the canonical project and global Skill root for the platform currently identified by `windsurf`. New Comet-managed Skills, Rules, Hooks, and OpenSpec generated copies MUST target this root according to the existing platform adapters.

#### Scenario: Current OpenSpec output is installed

- **Given** OpenSpec generates the Windsurf-compatible tool output under `.devin/`
- **When** Comet installs OpenSpec tools for a project or globally
- **Then** the generated files are available under the canonical `.devin/` root
- **And** a second canonical copy is not required under `.windsurf/`

### Requirement: Read legacy Windsurf installations

Comet MUST treat `.windsurf/` as a legacy Skill root for the same platform. Detection, managed Skill inspection, update, and uninstall MUST consider both `.devin/` and `.windsurf/`, while preserving unrelated user files.

#### Scenario: Legacy installation is detected and maintained

- **Given** a project has Comet-managed Skills under `.windsurf/` and no `.devin/` root
- **When** Comet detects, updates, or uninstalls the Windsurf installation
- **Then** it recognizes the installation as `windsurf`
- **And** it can operate on Comet-managed files under `.windsurf/`
- **And** it does not delete unrelated user files

### Requirement: Accept both OpenSpec generation layouts

The OpenSpec adapter MUST accept generated Windsurf output under either `.devin/` or `.windsurf/`, with the current root taking precedence when both are present. Project staged output MUST be copied to `.devin/`; global installation MUST remain usable with supported old and current OpenSpec CLIs.

#### Scenario: Legacy staged output is normalized for a project

- **Given** an older OpenSpec CLI stages Windsurf output under `.windsurf/`
- **When** Comet installs OpenSpec tools for a project
- **Then** the install succeeds
- **And** the staged files are copied to `<project>/.devin/`
- **And** no generated file is required to remain under `<project>/.windsurf/`

#### Scenario: Both staged layouts exist

- **Given** a staged project contains non-empty output under both `.devin/` and `.windsurf/`
- **When** Comet resolves the generated Windsurf output
- **Then** it chooses `.devin/` as the current output
- **And** it does not silently merge an ambiguous legacy tree over the current output

### Requirement: Keep Native snapshots compatible with both roots

The default Native snapshot configuration MUST exclude managed Skill files under both `.devin/skills/**` and `.windsurf/skills/**`, so upgrading or working with a legacy project does not pull platform-managed files into the baseline.

#### Scenario: Snapshot excludes current and legacy Skill roots

- **Given** a project contains managed Skills in either Windsurf root
- **When** Comet creates the default Native snapshot configuration
- **Then** both `.devin/skills/**` and `.windsurf/skills/**` are excluded
