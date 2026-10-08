# Frozen DSH hook contract

These pure functions are copied verbatim from official npm release artifacts, with only export declarations added. They run the host contract against actual Comet installation outputs without starting DSH or a model.

- `hook-protocol.mjs`: matcher and codec from `@deepseek-ai/dsh-hook-protocol@0.2.0-rc.2/lib/index.js`.
- `entry-patches.mjs`: `applyEntryPatches` from `@deepseek-ai/cordis-plugin-include@1.0.9/lib/index.js`; the same function is bundled in `@deepseek-ai/dsh-app-boot@0.2.0-rc.2`.
- Upstream: https://github.com/deepseek-ai/deepseek-harness, MIT license (included).

This fixture verifies loader, matcher and output compatibility. It does not establish Electron activation or live tool execution.