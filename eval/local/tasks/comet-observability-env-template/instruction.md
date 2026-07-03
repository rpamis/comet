You are working on a Python project called "agent-template".

Your task: Use the comet workflow to fix the `.env.example` generator for LangSmith observability.

This task is adapted from `skills-benchmarks/ls-lang-tracing`.

## Requirements

Running `python env_writer.py` should create `.env.example` with:

- `ANTHROPIC_API_KEY=`
- `LANGSMITH_API_KEY=`
- `LANGSMITH_PROJECT=agent-template`
- `LANGSMITH_TRACING=true`

Do not include `TRACE_TO_LANGSMITH` in the normal template; the harness derives Claude Code plugin variables from `LANGSMITH_*`.

Run `python -m pytest test_env_writer.py -q`, follow the comet workflow, and archive the completed change.

When the workflow asks for confirmation, assume "yes, proceed with the recommended option".
