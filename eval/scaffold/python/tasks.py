"""Task loader for self-contained benchmark tasks.

Each task is a directory containing:
- instruction.md: Task prompt with {variable} placeholders
- task.toml: Task metadata, validation config (test_scripts, target_artifacts)
- environment/: Docker context (Dockerfile, source code)
- validation/: Validator implementations
- data/: Test data and ground truth (optional)

Usage:
    from scaffold.python.tasks import load_task, list_tasks

    task = load_task("ls-evaluator")
    prompt = task.render_prompt(py_dataset="ds-py", ts_dataset="ds-ts", run_id="abc123")
    validators = task.load_validators()
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

try:
    import tomllib
except ImportError:
    import tomli as tomllib  # Python < 3.11


from scaffold.python.paths import get_tasks_dir


COMET_WORKFLOW_INVOCATION_CONTRACT = """\
## Eval harness requirement

You must begin by invoking the `/comet` Skill/slash command with this task request.
Do not simulate the Comet workflow in plain prose. The run is invalid unless the
Comet Skill is invoked and leaves real OpenSpec/Comet workflow artifacts.
"""


@dataclass
class DataHandler:
    """A data handler triggered by file pattern match."""

    pattern: str  # Glob pattern relative to task data dir (e.g., "trace_*.jsonl")
    handler: str  # Handler name (e.g., "upload_traces")
    args: dict = field(default_factory=dict)  # Handler-specific arguments


@dataclass
class SetupConfig:
    """Setup configuration for a task.

    Defines data handlers and template variables that are computed at test time.
    """

    # Data handlers triggered by pattern matches
    data_handlers: list[DataHandler] = field(default_factory=list)

    # Template variables with format strings (can use {run_id})
    template_vars: dict[str, str] = field(default_factory=dict)


@dataclass
class ValidationConfig:
    """Validation configuration from [validation] in task.toml.

    Defines what to check and how. The framework auto-builds a validator
    from this config — no validators.py needed for most tasks.
    """

    # Test script(s) to run in Docker (e.g., "test_agent.py")
    test_scripts: str | list[str] = ""

    # File(s) or dir(s) Claude should produce — existence is checked before
    # running test scripts. Names are available via runner.artifacts.
    target_artifacts: str | list[str] = field(default_factory=list)

    # Docker execution timeout in seconds
    timeout: int = 120


@dataclass
class EvaluationConfig:
    """Skill-agnostic evaluation contract for a task."""

    profile: str | None = None
    required_skills: list[str] = field(default_factory=list)
    expected_artifacts: list[str] = field(default_factory=list)
    require_skill_invocation: bool = False
    rubric_criteria: list[str] = field(default_factory=list)
    native_terminal: str = "archive"


@dataclass
class InteractionConfig:
    """Controls whether the runner should simulate user replies."""

    mode: str = "none"
    max_turns: int = 12
    simulator_prompt: str | None = None
    decision_patterns: list[str] = field(default_factory=list)
    decision_reply: str | None = None
    decision_replies: list[str] = field(default_factory=list)
    continue_prompt: str = "Please continue with the next phase of the workflow."
    fresh_resume_marker: str | None = None


@dataclass
class TaskConfig:
    """Configuration loaded from task.toml."""

    name: str
    description: str
    difficulty: str = "medium"
    category: str = ""
    tags: list[str] = field(default_factory=list)

    # Description of what Claude has access to in this task environment
    environment_description: str = ""

    # Default treatments to test with this task
    default_treatments: list[str] = field(default_factory=list)

    # Template variables required for instruction.md
    template_required: list[str] = field(default_factory=list)

    # Environment settings
    dockerfile: str = "Dockerfile"
    timeout_sec: int = 900

    # Validation configuration
    validation: ValidationConfig = field(default_factory=ValidationConfig)

    # Setup configuration
    setup: SetupConfig = field(default_factory=SetupConfig)

    # Skill-agnostic evaluation contract
    evaluation: EvaluationConfig = field(default_factory=EvaluationConfig)

    # Interaction / user-simulator configuration
    interaction: InteractionConfig = field(default_factory=InteractionConfig)


@dataclass
class Task:
    """A self-contained benchmark task."""

    path: Path
    config: TaskConfig
    instruction_template: str

    @property
    def name(self) -> str:
        return self.config.name

    @property
    def environment_dir(self) -> Path:
        return self.path / "environment"

    @property
    def validation_dir(self) -> Path:
        return self.path / "validation"

    @property
    def data_dir(self) -> Path:
        return self.path / "data"

    @property
    def default_treatments(self) -> list[str]:
        return self.config.default_treatments

    def render_prompt(self, **kwargs: Any) -> str:
        """Render the instruction template with provided variables.

        Args:
            **kwargs: Template variables (e.g., run_id, py_dataset, ts_dataset)

        Returns:
            Rendered prompt string

        Raises:
            KeyError: If a required template variable is missing
        """
        missing = set(self.config.template_required) - set(kwargs.keys())
        if missing:
            raise KeyError(f"Missing required template variables: {missing}")
        prompt = self.instruction_template.format(**kwargs)
        if self.config.evaluation.profile == "comet-workflow":
            return f"{COMET_WORKFLOW_INVOCATION_CONTRACT}\n\n{prompt}"
        return prompt

    def load_validators(self) -> list:
        """Build validator from task.toml [validation] config.

        The config specifies test_scripts and target_artifacts. The framework
        auto-builds an execution validator that runs the scripts in Docker.
        """
        vc = self.config.validation
        if vc.test_scripts:
            from scaffold.python.utils import make_execution_validator

            return [
                make_execution_validator(
                    validation_dir=self.validation_dir,
                    test_scripts=vc.test_scripts,
                    target_artifacts=vc.target_artifacts,
                    timeout=vc.timeout,
                    data_dir=self.data_dir if self.data_dir.exists() else None,
                )
            ]

        return []


def load_task(name: str, tasks_dir: Path | None = None) -> Task:
    """Load a task by name.

    Args:
        name: Task directory name (e.g., "ls-evaluator")
        tasks_dir: Optional custom tasks directory

    Returns:
        Task object with config and instruction template
    """
    tasks_dir = tasks_dir or get_tasks_dir()
    task_path = tasks_dir / name

    if not task_path.exists():
        raise FileNotFoundError(f"Task not found: {name} (looked in {tasks_dir})")

    # Load task.toml
    toml_path = task_path / "task.toml"
    if not toml_path.exists():
        raise FileNotFoundError(f"task.toml not found in {task_path}")

    with open(toml_path, "rb") as f:
        toml_data = tomllib.load(f)

    metadata = toml_data.get("metadata", {})
    template = toml_data.get("template", {})
    environment = toml_data.get("environment", {})
    validation = toml_data.get("validation", {})
    evaluation = toml_data.get("evaluation", {})
    interaction = toml_data.get("interaction", {})
    setup_data = toml_data.get("setup", {})

    # Parse setup config
    data_handlers = [
        DataHandler(pattern=d["pattern"], handler=d["handler"], args=d.get("args", {}))
        for d in setup_data.get("data", [])
    ]
    setup = SetupConfig(
        data_handlers=data_handlers,
        template_vars=setup_data.get("template_vars", {}),
    )

    validation_config = ValidationConfig(
        test_scripts=validation.get("test_scripts", ""),
        target_artifacts=validation.get("target_artifacts", []),
        timeout=validation.get("timeout", 120),
    )

    task_name = metadata.get("name", name)
    inferred_profile = evaluation.get("profile")
    if not inferred_profile and (
        metadata.get("category") == "comet" or str(task_name).startswith("comet-")
    ):
        inferred_profile = "comet-workflow"

    evaluation_config = EvaluationConfig(
        profile=inferred_profile,
        required_skills=evaluation.get("required_skills", []),
        expected_artifacts=evaluation.get("expected_artifacts", []),
        require_skill_invocation=bool(evaluation.get("require_skill_invocation", False)),
        rubric_criteria=evaluation.get("rubric_criteria", []),
        native_terminal=evaluation.get("native_terminal", "archive"),
    )
    if evaluation_config.native_terminal not in {"archive", "active", "active-blocked"}:
        raise ValueError(
            f"Task {task_name} has invalid evaluation.native_terminal: "
            f"{evaluation_config.native_terminal}"
        )

    default_interaction_mode = "auto_user" if inferred_profile == "comet-workflow" else "none"
    interaction_config = InteractionConfig(
        mode=interaction.get("mode", default_interaction_mode),
        max_turns=int(interaction.get("max_turns", 12)),
        simulator_prompt=interaction.get("simulator_prompt"),
        decision_patterns=interaction.get("decision_patterns", []),
        decision_reply=interaction.get("decision_reply"),
        decision_replies=interaction.get("decision_replies", []),
        continue_prompt=interaction.get(
            "continue_prompt",
            "Please continue with the next phase of the workflow.",
        ),
        fresh_resume_marker=interaction.get("fresh_resume_marker"),
    )

    config = TaskConfig(
        name=task_name,
        description=metadata.get("description", ""),
        difficulty=metadata.get("difficulty", "medium"),
        category=metadata.get("category", ""),
        tags=metadata.get("tags", []),
        environment_description=environment.get("description", ""),
        default_treatments=metadata.get("default_treatments", []),
        template_required=template.get("required", []),
        dockerfile=environment.get("dockerfile", "Dockerfile"),
        timeout_sec=environment.get("timeout_sec", 900),
        validation=validation_config,
        setup=setup,
        evaluation=evaluation_config,
        interaction=interaction_config,
    )

    # Load instruction.md
    instruction_path = task_path / "instruction.md"
    if not instruction_path.exists():
        raise FileNotFoundError(f"instruction.md not found in {task_path}")

    instruction_template = instruction_path.read_text(encoding="utf-8")

    return Task(path=task_path, config=config, instruction_template=instruction_template)


def list_tasks(tasks_dir: Path | None = None) -> list[str]:
    """List available task names.

    Args:
        tasks_dir: Optional custom tasks directory

    Returns:
        List of task directory names
    """
    tasks_dir = tasks_dir or get_tasks_dir()
    if not tasks_dir.exists():
        return []

    return sorted(
        d.name
        for d in tasks_dir.iterdir()
        if d.is_dir() and (d / "task.toml").exists() and (d / "instruction.md").exists()
    )
