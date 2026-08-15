# Outcome

Keep the English and Chinese Native Skill surfaces within the permanent context budget while preserving the language-selection rule: `comet init` follows the selected Skill language, then project `native.language` controls artifacts.

# Scope

- Compress only redundant Markdown spacing in the Native Skill references.
- Preserve the bilingual structure, language inheritance wording, and machine-facing fields.

# Non-goals

No workflow, Runtime, or user-visible artifact schema changes.

# Acceptance examples

- A1: The six permanent English and Chinese Native Markdown files remain structurally aligned and each stays within 400 lines.
- A2: The Skill states that explicit `--language` is the only artifact-language override after initialization.

# Constraints and invariants

Do not remove required commands, references, or headings; run the Native Skill contract tests.

# Decisions

The repair is documentation-only and keeps all existing English/Chinese wording semantics.

# Open questions

# Verification expectations

Run `npx vitest run test/domains/comet-native/native-skill.test.ts` and format checks for the changed Markdown.
