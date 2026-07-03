class StateBackend:
    persistent = False


class StoreBackend:
    persistent = True


class MemorySaver:
    pass


def resolve_backend(routes, path):
    matches = [prefix for prefix in routes if path.startswith(prefix)]
    if not matches:
        return None
    prefix = max(matches, key=len)
    return routes[prefix]


def create_agent_config():
    routes = {
        "/memory": StoreBackend(),
        "/memory/preferences": StateBackend(),
        "/session": StateBackend(),
    }
    return {
        "backend_routes": routes,
        "checkpointer": None,
        "subagents": [
            {
                "name": "researcher",
                "description": "Research project docs",
            },
            {
                "name": "deployer",
                "description": "Deploy services",
            },
        ],
    }
