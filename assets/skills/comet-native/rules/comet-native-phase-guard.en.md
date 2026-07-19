# Comet Native Phase Guard

This rule applies only when the project enables the `native` workflow in `.comet/config.yaml`. Native is a lightweight Comet-owned workflow and does not depend on external skills.

- When starting or resuming work, read `.comet/config.yaml`, then the state under the configured `<artifact_root>/comet/changes/` directory.
- Shape clarifies goals, boundaries, constraints, and acceptance conditions. Do not edit implementation code.
- Build allows implementation writes while keeping change artifacts and checkpoints current.
- Verify runs checks and records evidence. If verification exposes an implementation issue, record the failed result and return to Build before repairing the implementation.
- Archive only archives a verified change and must not modify implementation code.
- Pause automatic progression for product decisions that require the user; otherwise let the same Native skill continue from state.

The Hook blocks ordinary project writes during Shape, Verify, and Archive, including dot-prefixed project files, and fails closed when a write target cannot be determined. Native control artifacts remain writable. Do not bypass the Hook; resume `/comet-native` so runtime state and actual work stay aligned.
