from __future__ import annotations


def stream_response(tokens: list[str]):
    buffer = ""
    for token in tokens:
        buffer += token
    yield buffer


def lookup_order(order_id: str) -> str:
    return {"A100": "shipped", "B200": "processing"}.get(order_id, "unknown")


def handle_tool_call(tool_name: str, argument: str) -> str:
    if tool_name == "lookup_order":
        lookup_order(argument)
        return "Tool call completed."
    return "Unsupported tool."
