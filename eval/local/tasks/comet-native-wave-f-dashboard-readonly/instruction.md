You are working on a Python project named `wordcount-cli` and evaluating Dashboard's Native projection. Do not implement or archive a product feature.

Begin by invoking `/comet-native`. Initialize Native under `docs/comet/`, create one active Shape-phase change named `dashboard-visible-change`, and give it a valid brief plus target specification.

Save the exact `status dashboard-visible-change --details --json` envelope before Dashboard collection to `.cache/comet-native-eval/cli-before.json`. Save a bounded path/size/mtime manifest for `docs/comet/` as `.cache/comet-native-eval/native-tree-before.json`. Run the read-only Dashboard command and save its exact JSON output to `.cache/comet-native-eval/dashboard.json`. Then capture the same status envelope and manifest as `cli-after.json` and `native-tree-after.json`.

The validator will check Dashboard schema `comet.dashboard.native.v2`, stateVersion/phase/loop/acceptance parity with the CLI, absence of absolute paths/raw execution details, and no change to the Native tree. `.comet/config.yaml`, `.comet/current-change.json`, and `.comet/runtime/` are Runtime-owned and allowed. Do not create OpenSpec, Classic, or change-local machine artifacts. Do not compute or save Native content hashes.
