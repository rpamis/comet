import agent_system


def test_preferences_route_to_persistent_backend():
    config = agent_system.create_agent_config()
    backend = agent_system.resolve_backend(
        config["backend_routes"],
        "/memory/preferences/theme",
    )

    assert backend is not None
    assert backend.persistent is True


def test_researcher_subagent_has_explicit_doc_skill():
    config = agent_system.create_agent_config()
    researcher = next(sub for sub in config["subagents"] if sub["name"] == "researcher")

    assert "skills" in researcher
    assert "project-docs" in researcher["skills"]


def test_deployment_interrupt_has_checkpointer():
    config = agent_system.create_agent_config()
    deployer = next(sub for sub in config["subagents"] if sub["name"] == "deployer")

    assert config["checkpointer"] is not None
    assert "interrupt_on" in deployer
    assert "deploy_production" in deployer["interrupt_on"]
