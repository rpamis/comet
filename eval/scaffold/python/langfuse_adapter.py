"""Langfuse core reporting, official plugin provisioning, and trajectory adapters."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import tarfile
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from types import SimpleNamespace
from typing import Any, Callable, Iterator, Mapping
from urllib.request import Request, urlopen

from scaffold.python.pass_at_k import compute_pass_metrics


class LangfuseConfigurationError(RuntimeError):
    """The Langfuse suite cannot start safely with the current configuration."""


class LangfuseReportingError(RuntimeError):
    """A required Langfuse core trace or score could not be written."""


class TrajectoryProvisionError(RuntimeError):
    """An official trajectory plugin could not be safely provisioned."""


@dataclass(frozen=True)
class TrajectoryEvent:
    """A bounded, agent-neutral event parsed from a JSONL transcript."""

    kind: str
    name: str
    input: Any = None
    output: Any = None
    session_id: str | None = None
    truncated: bool = False


@dataclass(frozen=True)
class TrajectoryProvision:
    """The isolated plugin or hook provision selected for one eval run."""

    agent: str
    mode: str
    cache_dir: Path
    plugin_path: Path | None = None
    source_repo: str | None = None
    source_ref: str | None = None
    archive_sha256: str | None = None
    content_sha256: str | None = None


_OFFICIAL_PLUGIN_SPECS: dict[str, dict[str, str]] = {
    "claude-code": {
        "repo": "langfuse/Claude-Observability-Plugin",
        "ref": "05b7742829e0b0ad840c8760376ca737fa1eb662",
        "archive_root": ".",
    },
    "codex": {
        "repo": "langfuse/codex-observability-plugin",
        "ref": "96e997cf9c3d4aee7421e849d764b83dcb485462",
        "archive_root": "plugins/tracing",
    },
}

_RUBRIC_SCORE_RE = re.compile(r"\[RUBRIC\]\s+([A-Za-z0-9_.-]+):\s*(0(?:\.\d+)?|1(?:\.0+)?)\b")
_SUMMARY_K_VALUES = (1, 2, 5)


@dataclass(frozen=True)
class LangfuseConfig:
    public_key: str
    secret_key: str
    base_url: str | None = None
    tracing_environment: str | None = None

    @classmethod
    def from_environment(cls, environ: Mapping[str, str] | None = None) -> "LangfuseConfig":
        env = environ or os.environ
        missing = [
            name
            for name in ("LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY")
            if not env.get(name, "").strip()
        ]
        if missing:
            raise LangfuseConfigurationError(
                "Langfuse suite requires "
                + ", ".join(missing)
                + ". Set them in the process environment; they are never persisted by Comet."
            )
        return cls(
            public_key=env["LANGFUSE_PUBLIC_KEY"].strip(),
            secret_key=env["LANGFUSE_SECRET_KEY"].strip(),
            base_url=env.get("LANGFUSE_BASE_URL") or None,
            tracing_environment=env.get("LANGFUSE_TRACING_ENVIRONMENT") or None,
        )


def trajectory_mode(agent: str) -> str:
    return {
        "claude-code": "official-claude-code-plugin",
        "codex": "official-codex-plugin",
        "qoder": "qoder-stop-transcript",
        "codebuddy": "codebuddy-stop-transcript",
    }.get(agent, "best-effort-core-only")


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sha256_tree(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        relative = path.relative_to(root).as_posix()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def _download_plugin_archive(url: str, destination: Path) -> None:
    request = Request(url, headers={"User-Agent": "Comet eval Langfuse adapter"})
    try:
        with urlopen(request, timeout=90) as response, destination.open("wb") as output:
            shutil.copyfileobj(response, output)
    except Exception as exc:
        raise TrajectoryProvisionError(
            f"Langfuse trajectory plugin download failed: {exc}"
        ) from exc


@contextmanager
def _provision_lock(path: Path) -> Iterator[None]:
    """Coordinate cache writes across pytest workers and separate processes."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as lock_file:
        if os.name == "nt":
            import msvcrt

            lock_file.seek(0, os.SEEK_END)
            if lock_file.tell() == 0:
                lock_file.write(b"0")
                lock_file.flush()
            lock_file.seek(0)
            msvcrt.locking(lock_file.fileno(), msvcrt.LK_LOCK, 1)
            try:
                yield
            finally:
                lock_file.seek(0)
                msvcrt.locking(lock_file.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def _safe_extract_archive(archive_path: Path, destination: Path) -> Path:
    destination.mkdir(parents=True, exist_ok=True)
    root_name: str | None = None
    try:
        with tarfile.open(archive_path, mode="r:gz") as archive:
            members = archive.getmembers()
            for member in members:
                relative = PurePosixPath(member.name)
                if relative.is_absolute() or ".." in relative.parts:
                    raise TrajectoryProvisionError(
                        f"Langfuse trajectory plugin archive contains an unsafe path: {member.name}"
                    )
                if member.issym() or member.islnk():
                    raise TrajectoryProvisionError(
                        f"Langfuse trajectory plugin archive contains a link: {member.name}"
                    )
                if not root_name and relative.parts:
                    root_name = relative.parts[0]
                target = destination.joinpath(*relative.parts).resolve()
                if destination.resolve() not in target.parents and target != destination.resolve():
                    raise TrajectoryProvisionError(
                        f"Langfuse trajectory plugin archive escapes its cache: {member.name}"
                    )
            archive.extractall(destination, filter="data")
    except TrajectoryProvisionError:
        raise
    except (OSError, tarfile.TarError) as exc:
        raise TrajectoryProvisionError(
            f"Langfuse trajectory plugin archive is invalid: {exc}"
        ) from exc
    if not root_name:
        raise TrajectoryProvisionError("Langfuse trajectory plugin archive is empty")
    return destination / root_name


def _read_provisioned_plugin(
    cache_dir: Path, agent: str, spec: Mapping[str, str]
) -> TrajectoryProvision:
    metadata_path = cache_dir / "metadata.json"
    plugin_path = cache_dir / "plugin"
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        actual_content_hash = _sha256_tree(plugin_path)
    except (OSError, ValueError, TypeError) as exc:
        raise TrajectoryProvisionError(
            f"Langfuse trajectory plugin cache is incomplete for {agent}: {cache_dir}"
        ) from exc
    if (
        metadata.get("source_ref") != spec["ref"]
        or metadata.get("content_sha256") != actual_content_hash
    ):
        raise TrajectoryProvisionError(
            f"Langfuse trajectory plugin cache integrity check failed for {agent}: {cache_dir}"
        )
    return TrajectoryProvision(
        agent=agent,
        mode=trajectory_mode(agent),
        cache_dir=cache_dir,
        plugin_path=plugin_path,
        source_repo=metadata.get("source_repo"),
        source_ref=metadata.get("source_ref"),
        archive_sha256=metadata.get("archive_sha256"),
        content_sha256=actual_content_hash,
    )


def provision_trajectory_plugin(
    cache_root: Path,
    agent: str,
    *,
    download: Callable[[str, Path], None] | None = None,
) -> TrajectoryProvision:
    """Provision a pinned official plugin without touching user agent config."""
    mode = trajectory_mode(agent)
    if agent not in _OFFICIAL_PLUGIN_SPECS:
        return TrajectoryProvision(agent=agent, mode=mode, cache_dir=cache_root / agent)

    spec = _OFFICIAL_PLUGIN_SPECS[agent]
    cache_dir = cache_root / agent / spec["ref"]
    cache_dir.parent.mkdir(parents=True, exist_ok=True)
    with _provision_lock(cache_dir.parent / ".provision.lock"):
        if (cache_dir / "metadata.json").is_file() and (cache_dir / "plugin").is_dir():
            return _read_provisioned_plugin(cache_dir, agent, spec)

        staging = Path(tempfile.mkdtemp(prefix=f".{agent}-", dir=cache_dir.parent))
        try:
            archive_path = staging / "plugin.tar.gz"
            source_url = f"https://codeload.github.com/{spec['repo']}/tar.gz/{spec['ref']}"
            (download or _download_plugin_archive)(source_url, archive_path)
            archive_hash = _sha256_file(archive_path)
            extracted_root = _safe_extract_archive(archive_path, staging / "extracted")
            required_plugin_path = (
                extracted_root
                if spec["archive_root"] == "."
                else extracted_root / spec["archive_root"]
            )
            if not required_plugin_path.is_dir():
                raise TrajectoryProvisionError(
                    f"Langfuse trajectory plugin path is missing: {spec['archive_root']}"
                )
            plugin_destination = staging / "plugin"
            shutil.copytree(extracted_root, plugin_destination)
            content_hash = _sha256_tree(plugin_destination)
            metadata = {
                "schema": "comet.eval.langfuse-plugin.v1",
                "agent": agent,
                "source_repo": spec["repo"],
                "source_ref": spec["ref"],
                "archive_sha256": archive_hash,
                "content_sha256": content_hash,
                "mode": mode,
            }
            (staging / "metadata.json").write_text(
                json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8"
            )
            if cache_dir.exists():
                shutil.rmtree(cache_dir)
            os.replace(staging, cache_dir)
            staging = None  # type: ignore[assignment]
        except TrajectoryProvisionError:
            raise
        except Exception as exc:
            raise TrajectoryProvisionError(
                f"Langfuse trajectory plugin provisioning failed for {agent}: {exc}"
            ) from exc
        finally:
            if staging is not None and staging.exists():
                shutil.rmtree(staging, ignore_errors=True)
    return _read_provisioned_plugin(cache_dir, agent, spec)


def _bound_value(value: Any, max_chars: int) -> tuple[Any, bool]:
    if isinstance(value, str):
        return (value[:max_chars], len(value) > max_chars)
    serialized = json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)
    if len(serialized) <= max_chars:
        return value, False
    return serialized[:max_chars], True


def _message_content(record: Mapping[str, Any]) -> Any:
    message = record.get("message")
    if isinstance(message, Mapping):
        return message.get("content")
    return record.get("content")


def _session_id(record: Mapping[str, Any]) -> str | None:
    value = record.get("sessionId") or record.get("session_id")
    return str(value) if value else None


def parse_agent_transcript(path: Path, *, max_chars: int = 20_000) -> list[TrajectoryEvent]:
    """Parse Qoder/CodeBuddy transcript JSONL without inferring missing events."""
    events: list[TrajectoryEvent] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise TrajectoryProvisionError(f"Unable to read agent transcript: {path}") from exc

    for line in lines:
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(record, Mapping):
            continue
        record_type = str(record.get("type", ""))
        session_id = _session_id(record)
        if record_type == "session_meta":
            data, truncated = _bound_value(record.get("data", {}), max_chars)
            events.append(
                TrajectoryEvent(
                    "session",
                    "session_meta",
                    output=data,
                    session_id=session_id,
                    truncated=truncated,
                )
            )
            continue

        content = _message_content(record)
        items = content if isinstance(content, list) else [content]
        for item in items:
            if isinstance(item, Mapping):
                item_type = str(item.get("type", ""))
                if item_type == "tool_use":
                    input_value, truncated = _bound_value(item.get("input", {}), max_chars)
                    events.append(
                        TrajectoryEvent(
                            "tool",
                            str(item.get("name") or "tool"),
                            input=input_value,
                            session_id=session_id,
                            truncated=truncated,
                        )
                    )
                    continue
                if item_type == "tool_result":
                    output, truncated = _bound_value(item.get("content", ""), max_chars)
                    events.append(
                        TrajectoryEvent(
                            "tool_result",
                            str(item.get("tool_use_id") or "tool_result"),
                            output=output,
                            session_id=session_id,
                            truncated=truncated,
                        )
                    )
                    continue
                if item_type == "text":
                    value, truncated = _bound_value(item.get("text", ""), max_chars)
                    events.append(
                        TrajectoryEvent(
                            "text",
                            "assistant",
                            output=value,
                            session_id=session_id,
                            truncated=truncated,
                        )
                    )
                    continue
            elif isinstance(item, str) and item:
                value, truncated = _bound_value(item, max_chars)
                events.append(
                    TrajectoryEvent(
                        "user" if record_type == "user" else "text",
                        "user" if record_type == "user" else "assistant",
                        input=value if record_type == "user" else None,
                        output=value if record_type != "user" else None,
                        session_id=session_id,
                        truncated=truncated,
                    )
                )

        if record_type == "progress":
            value, truncated = _bound_value(record.get("data", {}), max_chars)
            events.append(
                TrajectoryEvent(
                    "progress", "progress", output=value, session_id=session_id, truncated=truncated
                )
            )
    return events


def render_transcript_hook_script() -> str:
    """Return the no-credential Stop hook used by Qoder and CodeBuddy."""
    return """#!/usr/bin/env python3
import hashlib
import json
import os
import shutil
import sys
import tempfile


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0
    if payload.get("hook_event_name") != "Stop":
        return 0
    transcript = payload.get("transcript_path")
    cwd = payload.get("cwd") or os.getcwd()
    if not transcript or not os.path.isfile(transcript):
        return 0
    role = os.environ.get("COMET_EVAL_AGENT_ROLE", "subject")
    if role not in {"subject", "simulator", "judge"}:
        role = "subject"
    session_id = payload.get("session_id") or payload.get("sessionId")
    if not session_id:
        session_id = hashlib.sha256(os.path.abspath(transcript).encode()).hexdigest()[:16]
    safe_session = "".join(ch if ch.isalnum() or ch in "._-" else "-" for ch in str(session_id))[:128]
    target_dir = os.path.join(cwd, ".comet", "eval", "langfuse", "trajectories")
    target = os.path.join(target_dir, f"{role}-{safe_session}.jsonl")
    os.makedirs(target_dir, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".trajectory-", dir=os.path.dirname(target))
    os.close(fd)
    try:
        shutil.copyfile(transcript, temporary)
        os.replace(temporary, target)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
"""


def install_transcript_hook(test_dir: Path, agent: str) -> Path | None:
    """Install a project-local, credential-free Stop hook for transcript agents."""
    if agent not in {"qoder", "codebuddy"}:
        return None
    project_dir_name = ".qoder" if agent == "qoder" else ".codebuddy"
    project_dir = test_dir / project_dir_name
    hook_path = project_dir / "hooks" / "langfuse-stop-hook.py"
    hook_path.parent.mkdir(parents=True, exist_ok=True)
    hook_path.write_text(render_transcript_hook_script(), encoding="utf-8")
    settings_path = project_dir / "settings.json"
    settings: dict[str, Any] = {}
    if settings_path.is_file():
        settings = json.loads(settings_path.read_text(encoding="utf-8"))
    hooks = settings.setdefault("hooks", {})
    stop_hooks = hooks.setdefault("Stop", [])
    entry = {
        "hooks": [
            {
                "type": "command",
                "command": f"python3 /workspace/{project_dir_name}/hooks/langfuse-stop-hook.py",
                "timeout": 30,
            }
        ]
    }
    if entry not in stop_hooks:
        stop_hooks.append(entry)
    settings_path.write_text(json.dumps(settings, indent=2) + "\n", encoding="utf-8")
    return test_dir / ".comet" / "eval" / "langfuse" / "trajectories"


def install_codex_plugin_workspace(test_dir: Path, provision: TrajectoryProvision) -> None:
    """Copy the pinned Codex plugin into the isolated project CODEX_HOME."""
    if provision.agent != "codex" or provision.plugin_path is None:
        return
    source = provision.plugin_path / "plugins" / "tracing"
    version = json.loads((source / ".codex-plugin" / "plugin.json").read_text(encoding="utf-8"))[
        "version"
    ]
    target = (
        test_dir
        / ".codex"
        / "plugins"
        / "cache"
        / "codex-observability-plugin"
        / "tracing"
        / version
    )
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, target, dirs_exist_ok=True)
    config_path = test_dir / ".codex" / "config.toml"
    existing = config_path.read_text(encoding="utf-8") if config_path.is_file() else ""
    lines = existing.splitlines(keepends=True)
    feature_header = next(
        (index for index, line in enumerate(lines) if line.strip() == "[features]"),
        None,
    )
    if feature_header is None:
        existing = existing.rstrip() + "\n\n[features]\nhooks = true\n"
    else:
        feature_end = next(
            (
                index
                for index in range(feature_header + 1, len(lines))
                if lines[index].lstrip().startswith("[")
            ),
            len(lines),
        )
        feature_lines = lines[feature_header + 1 : feature_end]
        hooks_line = next(
            (
                index
                for index, line in enumerate(feature_lines)
                if line.strip().startswith("hooks =")
            ),
            None,
        )
        if hooks_line is None:
            lines.insert(feature_header + 1 + len(feature_lines), "hooks = true\n")
        else:
            lines[feature_header + 1 + hooks_line] = "hooks = true\n"
        existing = "".join(lines)
    if '[plugins."tracing@codex-observability-plugin"]' not in existing:
        existing = (
            existing.rstrip()
            + '\n\n[plugins."tracing@codex-observability-plugin"]\nenabled = true\n'
        )
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(existing.lstrip(), encoding="utf-8")


def create_client(
    config: LangfuseConfig | None = None,
    *,
    client_factory: Callable[..., Any] | None = None,
    authenticate: bool = True,
) -> Any:
    """Create and authenticate the SDK client only at the run boundary."""
    resolved = config or LangfuseConfig.from_environment()
    if client_factory is None:
        try:
            from langfuse import Langfuse
        except Exception as exc:  # pragma: no cover - optional dependency
            raise LangfuseConfigurationError(
                "The Langfuse Python SDK is unavailable. Install the eval langfuse extra."
            ) from exc
        client_factory = Langfuse

    kwargs: dict[str, str] = {"public_key": resolved.public_key, "secret_key": resolved.secret_key}
    if resolved.base_url:
        kwargs["base_url"] = resolved.base_url
    if resolved.tracing_environment:
        kwargs["environment"] = resolved.tracing_environment
    try:
        client = client_factory(**kwargs)
        if authenticate and hasattr(client, "auth_check") and not client.auth_check():
            raise LangfuseConfigurationError("Langfuse authentication check failed")
        return client
    except LangfuseConfigurationError:
        raise
    except Exception as exc:
        raise LangfuseConfigurationError(f"Langfuse authentication failed: {exc}") from exc


def enable_trajectory_environment(config: LangfuseConfig, agent: str) -> str:
    """Expose credentials to a selected agent without writing them to artifacts."""
    os.environ["TRACE_TO_LANGFUSE"] = "true"
    os.environ["LANGFUSE_PUBLIC_KEY"] = config.public_key
    os.environ["LANGFUSE_SECRET_KEY"] = config.secret_key
    if config.base_url:
        os.environ["LANGFUSE_BASE_URL"] = config.base_url
    if config.tracing_environment:
        os.environ["LANGFUSE_TRACING_ENVIRONMENT"] = config.tracing_environment
    os.environ["LANGFUSE_TRAJECTORY_MODE"] = trajectory_mode(agent)
    os.environ["LANGFUSE_TRAJECTORY_PROVISIONED"] = "false"
    return trajectory_mode(agent)


def _result_payload(result: Any) -> dict[str, Any]:
    passed = list(getattr(result, "checks_passed", []) or [])
    failed = list(getattr(result, "checks_failed", []) or [])
    summary = dict(getattr(result, "events_summary", {}) or {})
    total_checks = len(passed) + len(failed)
    payload: dict[str, Any] = {
        "run_id": getattr(result, "run_id", ""),
        "passed": bool(getattr(result, "passed", False)),
        "checks_passed": len(passed),
        "checks_failed": len(failed),
        "checks_pass_rate": len(passed) / total_checks if total_checks else 0.0,
        "failure_attribution": summary.get("failure_attribution"),
        "num_turns": summary.get("num_turns"),
        "tool_calls": summary.get("tool_calls"),
        "duration_seconds": summary.get("duration_seconds"),
        "total_tokens": summary.get("total_tokens"),
        "total_cost_usd": summary.get("total_cost_usd"),
        "rubric": _rubric_scores(passed),
    }
    for key in (
        "task",
        "treatment",
        "sample",
        "prompt",
        "skill",
        "profile",
        "final_response",
        "quality_gates",
        "execution_identity",
        "case_manifest",
        "interaction",
        "agent",
        "role_models",
        "role_sessions",
    ):
        value = summary.get(key)
        if value is not None:
            payload[key] = _bound_value(value, 20_000)[0]
    experiment_id = os.environ.get("COMET_EVAL_EXPERIMENT_ID")
    if experiment_id:
        payload["experiment_id"] = experiment_id
    payload["quality_gate"] = _quality_gate_result(payload)
    return payload


def result_payload_from_local_report(report: Mapping[str, Any]) -> dict[str, Any]:
    """Rebuild the canonical case payload from a persisted local report."""
    return _result_payload(
        SimpleNamespace(
            run_id=report.get("run_id", ""),
            passed=bool(report.get("passed")),
            checks_passed=list(report.get("checks_passed") or []),
            checks_failed=list(report.get("checks_failed") or []),
            events_summary=dict(report.get("events_summary") or {}),
        )
    )


def _rubric_scores(checks: list[str]) -> dict[str, float]:
    scores: dict[str, float] = {}
    for check in checks:
        match = _RUBRIC_SCORE_RE.search(check)
        if not match:
            continue
        try:
            scores[match.group(1)] = float(match.group(2))
        except ValueError:
            continue
    return scores


def _quality_gate_result(payload: Mapping[str, Any]) -> dict[str, Any]:
    configured = payload.get("quality_gates")
    if not isinstance(configured, Mapping) or not configured:
        return {"status": "not_applicable", "checks": {}}

    rubric = payload.get("rubric")
    rubric_scores = rubric if isinstance(rubric, Mapping) else {}
    checks: dict[str, bool | None] = {}
    aliases = {
        "minWeightedScore": "weighted_score",
        "minPassRate": "checks_pass_rate",
        "minChecksPassRate": "checks_pass_rate",
    }
    for name, expected in configured.items():
        metric_name = aliases.get(str(name))
        if metric_name is None and str(name).startswith("min"):
            candidate = str(name)[3:]
            metric_name = candidate[:1].lower() + candidate[1:]
        if (
            metric_name is None
            or not isinstance(expected, (int, float))
            or isinstance(expected, bool)
        ):
            checks[str(name)] = None
            continue
        actual = rubric_scores.get(metric_name)
        if metric_name == "checks_pass_rate":
            actual = payload.get("checks_pass_rate")
        checks[str(name)] = (
            isinstance(actual, (int, float))
            and not isinstance(actual, bool)
            and float(actual) >= float(expected)
        )

    applicable = [value for value in checks.values() if value is not None]
    if not applicable:
        status = "unavailable"
    elif any(value is False for value in applicable):
        status = "failed"
    elif any(value is None for value in checks.values()):
        status = "unavailable"
    else:
        status = "passed"
    return {"status": status, "checks": checks}


class LangfuseRunReporter:
    """Write one strict core trace per task/treatment and score its result."""

    def __init__(self, client: Any, *, suite: str = "comet-eval-langfuse"):
        self.client = client
        self.suite = suite
        self.cases: list[dict[str, Any]] = []

    def report_case(
        self,
        task_name: str,
        treatment_name: str,
        run: Callable[[], Any],
        result_loader: Callable[[], Any],
        *,
        metadata: Mapping[str, Any] | None = None,
        trajectory_path: Path | Callable[[], Path | None] | None = None,
        agent: str | None = None,
    ) -> Any:
        input_payload = {
            "task": task_name,
            "treatment": treatment_name,
            "suite": self.suite,
            "experiment_id": os.environ.get("COMET_EVAL_EXPERIMENT_ID"),
            **dict(metadata or {}),
        }
        with self.client.start_as_current_observation(
            as_type="span", name="comet.eval.run", input=input_payload
        ) as observation:
            result = None
            run_error: BaseException | None = None
            try:
                result = run()
            except BaseException as exc:
                run_error = exc
            result_loader_error: BaseException | None = None
            try:
                result = result_loader() or result
            except BaseException as exc:
                result_loader_error = exc
            payload = (
                _result_payload(result)
                if result is not None
                else {
                    "passed": False,
                    "checks_passed": 0,
                    "checks_failed": 0,
                    "checks_pass_rate": 0.0,
                }
            )
            try:
                resolved_trajectory_path = (
                    trajectory_path() if callable(trajectory_path) else trajectory_path
                )
                payload["trajectory"] = self._report_trajectory(
                    resolved_trajectory_path,
                    agent=agent or str(input_payload.get("agent", "")),
                    role_sessions=payload.get("role_sessions") or {},
                )
            except Exception as exc:
                print(f"[langfuse] optional trajectory upload skipped: {exc}", file=os.sys.stderr)
                payload["trajectory"] = {
                    "status": "unavailable",
                    "mode": trajectory_mode(agent or str(input_payload.get("agent", ""))),
                    "reason": str(exc),
                }
            payload["trajectory_status"] = payload["trajectory"].get("status", "unavailable")
            for key in ("prompt", "skill", "profile", "execution_identity", "agent", "sample"):
                if payload.get(key) is not None:
                    input_payload[key] = payload[key]
            core_error: BaseException | None = None
            try:
                observation.update(input=input_payload, output=payload)
                self._score(observation, payload)
            except BaseException as exc:
                core_error = exc
            self.cases.append({"task": task_name, "treatment": treatment_name, **payload})
            if run_error is not None:
                if core_error is not None:
                    print(
                        f"[langfuse] evaluation failed and core upload also failed: {core_error}",
                        file=os.sys.stderr,
                    )
                raise run_error
            if core_error is not None:
                raise core_error
            if result_loader_error is not None:
                raise result_loader_error
            return result

    def _report_trajectory(
        self,
        trajectory_path: Path | None,
        *,
        agent: str,
        role_sessions: Mapping[str, Any],
    ) -> dict[str, Any]:
        mode = trajectory_mode(agent)
        if mode.startswith("official-"):
            if os.environ.get("LANGFUSE_TRAJECTORY_PROVISIONED", "").lower() != "true":
                return {
                    "status": "unavailable",
                    "mode": mode,
                    "reason": "plugin_not_provisioned",
                }
            return {
                "status": "provisioned",
                "mode": mode,
                "role_sessions": dict(role_sessions),
            }
        if not trajectory_path or not trajectory_path.exists():
            return {"status": "unavailable", "mode": mode, "reason": "transcript_not_found"}
        try:
            transcript_paths = (
                sorted(trajectory_path.glob("*.jsonl"))
                if trajectory_path.is_dir()
                else [trajectory_path]
            )
            events = [
                event
                for transcript_path in transcript_paths
                for event in parse_agent_transcript(transcript_path)
            ]
            if not events:
                return {"status": "unavailable", "mode": mode, "reason": "transcript_empty"}
            session_ids = sorted({event.session_id for event in events if event.session_id})
            for index, event in enumerate(events):
                observation_type = "generation" if event.kind == "text" else "span"
                with self.client.start_as_current_observation(
                    as_type=observation_type,
                    name=f"agent.{event.kind}/{event.name}/{index}",
                    input=event.input,
                ) as child:
                    child.update(
                        output=event.output,
                        metadata={
                            "agent": agent,
                            "session_id": event.session_id,
                            "truncated": event.truncated,
                        },
                    )
            return {
                "status": "uploaded",
                "mode": mode,
                "events": len(events),
                "session_ids": session_ids,
                "role_sessions": dict(role_sessions),
                "truncated_events": sum(1 for event in events if event.truncated),
            }
        except Exception as exc:
            print(f"[langfuse] optional trajectory upload skipped: {exc}", file=os.sys.stderr)
            return {"status": "unavailable", "mode": mode, "reason": str(exc)}

    def _score(self, observation: Any, payload: Mapping[str, Any]) -> None:
        trace_id = getattr(observation, "trace_id", None)
        observation_id = getattr(observation, "id", None)
        if not trace_id:
            raise LangfuseReportingError("Langfuse observation did not expose a trace id")
        try:
            for name, value, data_type in (
                ("task_passed", bool(payload.get("passed")), "BOOLEAN"),
                ("checks_pass_rate", float(payload.get("checks_pass_rate", 0.0)), "NUMERIC"),
            ):
                self.client.create_score(
                    name={
                        "task_passed": "comet.passed",
                        "checks_pass_rate": "comet.checks_pass_rate",
                    }[name],
                    value=value,
                    trace_id=trace_id,
                    observation_id=observation_id,
                    data_type=data_type,
                )
            for dimension, value in (payload.get("rubric") or {}).items():
                self.client.create_score(
                    name=f"comet.rubric.{dimension}",
                    value=float(value),
                    trace_id=trace_id,
                    observation_id=observation_id,
                    data_type="NUMERIC",
                )
        except Exception as exc:
            raise LangfuseReportingError(f"Langfuse core score failed: {exc}") from exc

    def report_summary(self) -> None:
        """Write the suite summary as a final core observation."""
        try:
            with self.client.start_as_current_observation(
                as_type="span",
                name="comet.eval.experiment",
                input={
                    "suite": self.suite,
                    "experiment_id": os.environ.get("COMET_EVAL_EXPERIMENT_ID"),
                    "cases": len(self.cases),
                },
            ) as observation:
                passed = sum(1 for case in self.cases if case.get("passed"))
                aggregates = self._aggregates()
                observation.update(
                    output={
                        "cases": len(self.cases),
                        "passed": passed,
                        "failed": len(self.cases) - passed,
                        "aggregates": aggregates,
                    }
                )
                self._score_summary(observation, aggregates)
        except Exception as exc:
            raise LangfuseReportingError(f"Langfuse summary trace failed: {exc}") from exc

    def _aggregates(self) -> dict[str, Any]:
        groups: dict[str, list[dict[str, Any]]] = {}
        for case in self.cases:
            task = str(case.get("task", "unknown"))
            treatment = str(case.get("treatment", "unknown"))
            groups.setdefault(f"{task}/{treatment}", []).append(case)

        aggregates: dict[str, Any] = {}
        for key, cases in groups.items():
            outcomes = [bool(case.get("passed")) for case in cases]
            metrics = {str(k): compute_pass_metrics(outcomes, k) for k in _SUMMARY_K_VALUES}
            gate_statuses = [(case.get("quality_gate") or {}).get("status") for case in cases]
            if gate_statuses and all(status == "not_applicable" for status in gate_statuses):
                quality_gate = "not_applicable"
            elif "failed" in gate_statuses:
                quality_gate = "failed"
            elif "unavailable" in gate_statuses:
                quality_gate = "unavailable"
            else:
                quality_gate = "passed"
            aggregates[key] = {
                "task": key.split("/", 1)[0],
                "treatment": key.split("/", 1)[1],
                "runs": len(cases),
                "pass_at_k": {k: metrics[str(k)]["pass_at_k"] for k in _SUMMARY_K_VALUES},
                "pass_power_k": {k: metrics[str(k)]["pass_pow_k"] for k in _SUMMARY_K_VALUES},
                "quality_gate": quality_gate,
                "agent": (
                    next(iter({str(case.get("agent")) for case in cases}))
                    if len({str(case.get("agent")) for case in cases}) == 1
                    else "mixed"
                ),
            }
        return aggregates

    def _score_summary(self, observation: Any, aggregates: Mapping[str, Any]) -> None:
        trace_id = getattr(observation, "trace_id", None)
        observation_id = getattr(observation, "id", None)
        if not trace_id:
            raise LangfuseReportingError("Langfuse summary observation did not expose a trace id")
        try:
            for aggregate in aggregates.values():
                for k in _SUMMARY_K_VALUES:
                    score_metadata = {
                        "experiment_id": os.environ.get("COMET_EVAL_EXPERIMENT_ID"),
                        "agent": aggregate["agent"],
                        "task": aggregate["task"],
                        "treatment": aggregate["treatment"],
                        "k": k,
                    }
                    self.client.create_score(
                        name="comet.pass_at_k",
                        value=float(aggregate["pass_at_k"][k]),
                        trace_id=trace_id,
                        observation_id=observation_id,
                        data_type="NUMERIC",
                        metadata=score_metadata,
                    )
                    self.client.create_score(
                        name="comet.pass_power_k",
                        value=float(aggregate["pass_power_k"][k]),
                        trace_id=trace_id,
                        observation_id=observation_id,
                        data_type="NUMERIC",
                        metadata=score_metadata,
                    )
                if aggregate["quality_gate"] in {"passed", "failed"}:
                    self.client.create_score(
                        name="comet.quality_gate",
                        value=aggregate["quality_gate"] == "passed",
                        trace_id=trace_id,
                        observation_id=observation_id,
                        data_type="BOOLEAN",
                        metadata={
                            "experiment_id": os.environ.get("COMET_EVAL_EXPERIMENT_ID"),
                            "agent": aggregate["agent"],
                            "task": aggregate["task"],
                            "treatment": aggregate["treatment"],
                        },
                    )
        except Exception as exc:
            raise LangfuseReportingError(f"Langfuse summary score failed: {exc}") from exc

    def flush(self) -> None:
        try:
            self.client.flush()
        except Exception as exc:
            raise LangfuseReportingError(f"Langfuse flush failed: {exc}") from exc
