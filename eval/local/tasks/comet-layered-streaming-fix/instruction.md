You are working on a Python project called "chat-stream".

Your task: Use the comet workflow to fix two related chat application bugs.

This task is adapted from `skills-benchmarks/oss-fix-lc-streaming`.

## Bugs

1. `stream_response()` buffers all tokens and emits one combined string instead of streaming token chunks.
2. `handle_tool_call()` ignores the tool result and returns a placeholder response.

Run `python -m pytest test_chat_app.py -q` first, then follow the comet workflow through archive. Keep the public function names unchanged.

When the workflow asks for confirmation, assume "yes, proceed with the recommended option".
