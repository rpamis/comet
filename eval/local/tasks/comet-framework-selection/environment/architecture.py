def select_framework(requirements):
    return "single-tool-agent"


def build_document_assistant():
    return {
        "orchestrator": "create_react_agent",
        "memory": "short_term_only",
        "tools": ["edit_document", "extract_fields"],
        "subworkflow": None,
        "retry_policy": 0,
    }
