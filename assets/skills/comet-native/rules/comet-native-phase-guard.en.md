# Comet Native Phase Guard

This rule applies only when the project enables the `native` workflow in `.comet/config.yaml`. Native is a lightweight Comet-owned workflow and does not depend on external skills.

- When starting or resuming work, read `.comet/config.yaml`, then the state under the configured `<artifact_root>/comet/changes/` directory.
- Shape clarifies goals, boundaries, constraints, and acceptance conditions. Do not edit implementation code.
- Build allows implementation writes while keeping change artifacts and checkpoints current.
- Verify runs checks, records evidence, and fixes issues exposed by verification. If more implementation is needed, transition through the Native state machine first.
- Archive only archives a verified change and must not modify implementation code.
- Pause automatic progression for product decisions that require the user; otherwise let the same Native skill continue from state.

The Hook blocks ordinary code writes during Shape, Verify, and Archive. Do not bypass it; resume `/comet-native` so runtime state and actual work stay aligned.
