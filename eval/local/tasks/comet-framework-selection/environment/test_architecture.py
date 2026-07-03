from pathlib import Path

import architecture


def test_selects_hybrid_framework_for_long_session_documents():
    requirements = [
        "long_session_memory",
        "multi_document_editing",
        "deterministic_extraction",
        "retry_on_failure",
    ]

    assert architecture.select_framework(requirements) == "hybrid-deep-agent-langgraph"


def test_blueprint_uses_deep_orchestrator_and_compiled_subworkflow():
    blueprint = architecture.build_document_assistant()

    assert blueprint["orchestrator"] == "create_deep_agent"
    assert blueprint["subworkflow"] == "CompiledSubAgent"
    assert blueprint["memory"] == "persistent_session"
    assert blueprint["retry_policy"] >= 2


def test_source_contains_framework_selection_markers():
    source = Path("architecture.py").read_text(encoding="utf-8")

    assert "create_deep_agent" in source
    assert "CompiledSubAgent" in source
