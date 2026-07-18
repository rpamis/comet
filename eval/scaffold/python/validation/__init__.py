"""Validation helpers for test scripts."""
from scaffold.python.validation.core import (
    ValidatorFn,
    check_file_exists,
    check_no_pattern,
    check_pattern,
    check_skill_invoked,
    compose_validators,
    run_validators,
)

_DOCKER_EXPORTS = {
    "check_code_execution",
    "check_python_execution",
    "check_typescript_execution",
}


def __getattr__(name: str):
    """Load host-only Docker helpers only when callers explicitly request them."""
    if name not in _DOCKER_EXPORTS:
        raise AttributeError(name)
    from scaffold.python.validation import docker

    return getattr(docker, name)

__all__ = [
    "ValidatorFn", "compose_validators", "run_validators",
    "check_file_exists", "check_pattern", "check_no_pattern", "check_skill_invoked",
    "check_code_execution", "check_python_execution", "check_typescript_execution",
]
