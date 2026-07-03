You are working on a Python project called "doc-agent-system".

Your task: Use the comet workflow to fix a multi-agent configuration.

This task is adapted from `skills-benchmarks/oss-fix-da-memory`.

## Bug reports

1. User preferences disappear after restarting because the preferences path routes to ephemeral state.
2. The researcher subagent cannot read project documentation because it does not receive explicit skills.
3. Production deployments execute without human approval because interrupt handling is incomplete.

## What to do

1. Run `python -m pytest test_agent_system.py -q` to confirm the failures.
2. Follow the comet workflow phases from open through archive.
3. Keep the simple in-repo backend classes; do not add heavyweight external dependencies.
4. Verify that preference routing, researcher skills, and approval checkpoint configuration all pass.

When the workflow asks for confirmation, assume "yes, proceed with the recommended option".
