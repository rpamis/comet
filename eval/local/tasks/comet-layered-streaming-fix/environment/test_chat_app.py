from __future__ import annotations

from chat_app import handle_tool_call, stream_response


def test_stream_response_yields_each_token():
    assert list(stream_response(["Hel", "lo", "!"])) == ["Hel", "lo", "!"]


def test_tool_result_is_included_in_response():
    assert handle_tool_call("lookup_order", "A100") == "Order A100 is shipped."


def test_unknown_order_is_reported():
    assert handle_tool_call("lookup_order", "Z999") == "Order Z999 is unknown."
